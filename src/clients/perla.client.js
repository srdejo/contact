/**
 * Cliente de PERLA: entrega los eventos de WhatsApp en
 * `POST /internal/whatsapp/events` (contrato D1 de perla-ai).
 *
 * `forward` no bloquea a quien lo llama: encola el evento detras de los del
 * mismo chat y vuelve. El orden por chat importa (un OWNER seguido de un
 * INBOUND es una toma y luego la respuesta del interlocutor); los chats
 * distintos no se esperan entre si.
 *
 * Nunca se escribe en el log el secreto ni el texto del mensaje.
 */
const RETRY_DELAYS_MS = [1000, 5000, 30000];

const DEFAULT_TIMEOUT_MS = 10_000;

export function createPerlaClient({
  url,
  secret,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const tails = new Map();

  async function attempt(event) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Perla-Channel-Secret': secret ?? '',
        },
        body: JSON.stringify(event),
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

  async function deliver(event) {
    const label = `${event.messageId} (${event.direction})`;

    for (let retry = 0; ; retry++) {
      const { status, failure } = await attempt(event);

      if (status >= 200 && status < 300) {
        return;
      }

      // 4xx (400, 401, 404: PERLA sin el canal desplegado) y 503 (canal sin
      // configurar) no cambian reintentando.
      if (status !== undefined && (status < 500 || status === 503)) {
        logger.warn(
          `PERLA rechazó el evento ${label}: HTTP ${status}. No se reintenta.`
        );
        return;
      }

      const reason = failure ?? `HTTP ${status}`;

      if (retry >= RETRY_DELAYS_MS.length) {
        logger.error(
          `PERLA no recibió el evento ${label} tras ${retry + 1} intentos (${reason}). Se descarta.`
        );
        return;
      }

      logger.warn(
        `PERLA falló con el evento ${label} (${reason}). Reintento en ${RETRY_DELAYS_MS[retry] / 1000} s.`
      );

      await sleep(RETRY_DELAYS_MS[retry]);
    }
  }

  function forward(event) {
    const previous = tails.get(event.jid) ?? Promise.resolve();
    // El catch mantiene viva la cola del chat pase lo que pase con este evento.
    const current = previous
      .then(() => deliver(event))
      .catch((error) => {
        logger.error(
          `Error inesperado reenviando el evento ${event.messageId} a PERLA:`,
          error?.message
        );
      });

    tails.set(event.jid, current);

    // Se borra la entrada al vaciarse la cola del chat, para no crecer sin
    // limite.
    current.then(() => {
      if (tails.get(event.jid) === current) {
        tails.delete(event.jid);
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
