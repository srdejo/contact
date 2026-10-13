/**
 * Traduce un mensaje de Baileys al mensaje que espera recaudo
 * (`POST /internal/whatsapp/mensajes`, contrato D2 de
 * `recaudo/openspec/changes/recaudo-recibos-whatsapp/design.md`), o `null` si
 * no se reenvia.
 *
 * Parte del evento ya clasificado por `toPerlaEvent`: los mismos filtros
 * (grupos, difusiones, estados, reacciones, ecos de la API...) valen para
 * recaudo. Funcion pura: la imagen se descarga despues, en la cola del chat.
 */
import { isPnUser, normalizeMessageContent } from '@whiskeysockets/baileys';

export function toRecaudoMessage(event, message) {
  // Lo que Daniel escribe desde el telefono no es un vendedor mandando un recibo.
  if (!event || event.direction !== 'INBOUND') {
    return null;
  }

  // recaudo identifica al vendedor por su numero: un @lid sin numero de
  // telefono alternativo no se puede asociar a nadie.
  if (!isPnUser(event.jid)) {
    return null;
  }

  const content = normalizeMessageContent(message?.message) ?? {};

  // En un album llega primero un mensaje "contenedor" sin imagen y luego un
  // mensaje por foto: el contenedor no es un recibo.
  if (content.albumMessage) {
    return null;
  }

  const image = content.imageMessage;
  const base = {
    messageId: event.messageId,
    jid: event.jid,
    phone: event.jid.split('@')[0].split(':')[0],
    receivedAt: event.timestamp,
  };

  if (image) {
    return {
      ...base,
      kind: 'IMAGE',
      text: image.caption || null,
      mimeType: image.mimetype || 'image/jpeg',
      fileLength: toNumber(image.fileLength),
    };
  }

  return { ...base, kind: event.kind, text: event.text };
}

// `fileLength` llega como numero o como `Long`; sin el dato, 0 (se mide al descargar).
function toNumber(value) {
  const number =
    typeof value?.toNumber === 'function' ? value.toNumber() : Number(value);

  return Number.isFinite(number) && number > 0 ? number : 0;
}
