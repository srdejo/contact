/**
 * Traduce un mensaje de Baileys al evento que espera PERLA
 * (`POST /internal/whatsapp/events`, contrato D1 de perla-ai), o `null` si no
 * se reenvia. Funcion pura: todo lo que depende del socket o del entorno llega
 * por parametro, para probarla con mensajes de ejemplo.
 */
import {
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  normalizeMessageContent,
} from '@whiskeysockets/baileys';

// Contenido que no es un mensaje de persona: reacciones, ediciones/borrados y
// llamadas.
const IGNORED_CONTENT = [
  'reactionMessage',
  'protocolMessage',
  'callLogMesssage',
  'bcallMessage',
];

// Campos que acompanan a un mensaje pero no son contenido por si solos.
const NON_CONTENT = new Set([
  'senderKeyDistributionMessage',
  'messageContextInfo',
]);

export function toPerlaEvent(
  message,
  { isSentByApi, isIgnoredNumber, ownJids = [] }
) {
  const key = message?.key;
  const remoteJid = key?.remoteJid;

  if (!message?.message || !remoteJid || !key.id) {
    return null;
  }

  if (
    isJidGroup(remoteJid) ||
    isJidBroadcast(remoteJid) ||
    isJidNewsletter(remoteJid)
  ) {
    return null;
  }

  const content = normalizeMessageContent(message.message);

  if (!content || IGNORED_CONTENT.some((field) => content[field])) {
    return null;
  }

  const hasUserContent = Object.keys(content).some(
    (field) => content[field] != null && !NON_CONTENT.has(field)
  );

  if (!hasUserContent) {
    return null;
  }

  const jid = resolveChatJid(key);
  const chatJids = new Set([jid, jidNormalizedUser(remoteJid)]);

  for (const chatJid of chatJids) {
    if (isPnUser(chatJid) && isIgnoredNumber(phoneDigits(chatJid))) {
      return null;
    }
  }

  // "Mensaje a mi mismo" del numero dedicado.
  if (ownJids.some((ownJid) => chatJids.has(ownJid))) {
    return null;
  }

  if (key.fromMe && isSentByApi(key.id)) {
    return null;
  }

  const text = content.conversation || content.extendedTextMessage?.text;
  const direction = key.fromMe ? 'OWNER' : 'INBOUND';

  return {
    messageId: key.id,
    direction,
    jid,
    pushName: direction === 'INBOUND' ? message.pushName || null : null,
    kind: text ? 'TEXT' : 'UNSUPPORTED',
    text: text || null,
    timestamp: toIsoTimestamp(message.messageTimestamp),
  };
}

// Un mismo numero puede llegar como @lid o como JID de telefono; se prefiere
// el de telefono para que PERLA no abra dos conversaciones.
function resolveChatJid(key) {
  if (isLidUser(key.remoteJid)) {
    const alternative = key.remoteJidAlt || key.senderPn;

    if (alternative && isPnUser(alternative)) {
      return jidNormalizedUser(alternative);
    }
  }

  return key.remoteJid;
}

function phoneDigits(jid) {
  return jid.split('@')[0].split(':')[0];
}

// `messageTimestamp` llega en segundos, como numero o como `Long`.
function toIsoTimestamp(messageTimestamp) {
  const seconds =
    typeof messageTimestamp?.toNumber === 'function'
      ? messageTimestamp.toNumber()
      : Number(messageTimestamp);

  // Sin marca de tiempo valida se usa la hora de recepcion: D1 la exige.
  const date = Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : new Date();

  return date.toISOString();
}
