/**
 * Cliente de recaudo: entrega los mensajes de los vendedores en
 * `POST /internal/whatsapp/mensajes` (contrato D2 de recaudo).
 *
 * `forward` no bloquea a quien lo llama: encola el mensaje detras de los del
 * mismo chat y vuelve. La imagen se descarga dentro de la cola, para que dos
 * fotos del mismo vendedor lleguen en el orden en que las mando.
 *
 * Nunca se escribe en el log el secreto, el texto ni la imagen.
 */
const RETRY_DELAYS_MS = [1000, 5000, 30000];

const DEFAULT_TIMEOUT_MS = 10_000;

// Contrato D2: imagenes de hasta 10 MB.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function createRecaudoClient({
  url,
  secret,
  downloadImage,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxImageBytes = MAX_IMAGE_BYTES,
}) {
  const tails = new Map();

  // El mensaje del contrato; una imagen que no se pudo traer va como
  // UNSUPPORTED y recaudo le pide al vendedor que la reenvie.
  async function toBody(pending, rawMessage) {
    const { mimeType, fileLength, ...body } = pending;

    if (body.kind !== 'IMAGE') {
      return body;
    }

    if (fileLength > maxImageBytes) {
      logger.warn(
        `La imagen ${body.messageId} pesa ${fileLength} bytes, más de los ${maxImageBytes} permitidos. Va como UNSUPPORTED.`
      );

      return { ...body, kind: 'UNSUPPORTED' };
    }

    let image;

    try {
      image = await downloadImage(rawMessage);
    } catch (error) {
      logger.error(
        `No se pudo descargar la imagen ${body.messageId}: ${error?.message}. Va como UNSUPPORTED.`
      );

      return { ...body, kind: 'UNSUPPORTED' };
    }

    if (image.length > maxImageBytes) {
      logger.warn(
        `La imagen ${body.messageId} pesa ${image.length} bytes, más de los ${maxImageBytes} permitidos. Va como UNSUPPORTED.`
      );

      return { ...body, kind: 'UNSUPPORTED' };
    }

    return {
      ...body,
      image: { mimeType, base64: Buffer.from(image).toString('base64') },
    };
  }

  async function attempt(body) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaudo-Channel-Secret': secret ?? '',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      await discardBody(response);

      return { status: response.status };
    } catch (error) {
      return {
        failure:
          error?.name === 'TimeoutError'
            ? `sin respuesta en ${timeoutMs / 1000} s`
            : 'sin respuesta',
      };
    }
  }

  async function deliver(pending, rawMessage) {
    const body = await toBody(pending, rawMessage);
    const label = `${body.messageId} (${body.kind})`;

    for (let retry = 0; ; retry++) {
      const { status, failure } = await attempt(body);

      if (status >= 200 && status < 300) {
        return;
      }

      // 400 (cuerpo inválido) y 401 (secreto) no cambian reintentando.
      if (status !== undefined && status < 500) {
        logger.warn(
          `recaudo rechazó el mensaje ${label}: HTTP ${status}. No se reintenta.`
        );
        return;
      }

      const reason = failure ?? `HTTP ${status}`;

      if (retry >= RETRY_DELAYS_MS.length) {
        logger.error(
          `recaudo no recibió el mensaje ${label} tras ${retry + 1} intentos (${reason}). Se descarta.`
        );
        return;
      }

      logger.warn(
        `recaudo falló con el mensaje ${label} (${reason}). Reintento en ${RETRY_DELAYS_MS[retry] / 1000} s.`
      );

      await sleep(RETRY_DELAYS_MS[retry]);
    }
  }

  /** `pending` es el resultado de `toRecaudoMessage`; `rawMessage`, el de Baileys. */
  function forward(pending, rawMessage) {
    const previous = tails.get(pending.jid) ?? Promise.resolve();
    // El catch mantiene viva la cola del chat pase lo que pase con este mensaje.
    const current = previous
      .then(() => deliver(pending, rawMessage))
      .catch((error) => {
        logger.error(
          `Error inesperado reenviando el mensaje ${pending.messageId} a recaudo:`,
          error?.message
        );
      });

    tails.set(pending.jid, current);

    // Se borra la entrada al vaciarse la cola del chat, para no crecer sin
    // limite.
    current.then(() => {
      if (tails.get(pending.jid) === current) {
        tails.delete(pending.jid);
      }
    });

    return current;
  }

  return {
    forward,
    pendingChats: () => tails.size,
  };
}

async function discardBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // El cuerpo no importa: solo el codigo.
  }
}
