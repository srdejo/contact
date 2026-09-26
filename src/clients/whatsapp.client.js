import makeWASocket, {
  DisconnectReason,
  generateMessageIDV2,
  jidNormalizedUser,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { toPerlaEvent } from './whatsapp.events.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_FOLDER = path.resolve(
  __dirname,
  '../../data/whatsapp/auth'
);

// D1 de PERLA pide al menos 10 minutos; el margen cubre reintentos del
// servidor de WhatsApp al entregar el eco.
const SENT_ID_TTL_MS = 15 * 60 * 1000;

/**
 * Cliente de WhatsApp sobre Baileys.
 *
 * Es una fabrica para que las pruebas puedan inyectar un socket falso (el caso
 * del eco necesita que el `upsert` llegue antes de que `sendMessage` resuelva)
 * sin tocar disco ni red. `onMessage` recibe solo los eventos ya clasificados
 * como reenviables a PERLA; el cliente no sabe nada de HTTP.
 */
export function createWhatsAppClient({
  makeSocket = makeWASocket,
  loadAuthState = () => useMultiFileAuthState(AUTH_FOLDER),
  onMessage,
  isIgnoredNumber = () => false,
  now = () => Date.now(),
} = {}) {
  let socket = null;
  let connectionStatus = 'DISCONNECTED';
  let reconnecting = false;

  // IDs de los mensajes que salieron por la API: su eco no es Daniel
  // escribiendo desde el telefono.
  const sentIds = new Map();

  function registerSentId(id) {
    const current = now();

    for (const [sentId, expiresAt] of sentIds) {
      if (expiresAt <= current) {
        sentIds.delete(sentId);
      }
    }

    sentIds.set(id, current + SENT_ID_TTL_MS);
  }

  function isSentByApi(id) {
    const expiresAt = sentIds.get(id);

    return expiresAt !== undefined && expiresAt > now();
  }

  async function connect() {
    if (socket) {
      return;
    }

    const { state, saveCreds } = await loadAuthState();

    socket = makeSocket({
      auth: state,
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', handleConnectionUpdate);

    socket.ev.on('messages.upsert', handleIncomingMessages);
  }

  async function handleConnectionUpdate(update) {
    const {
      connection,
      lastDisconnect,
      qr,
    } = update;

    if (qr) {
      connectionStatus = 'QR_REQUIRED';

      console.log('');
      console.log('======================================');
      console.log(' WhatsApp requiere autenticación');
      console.log('======================================');
      console.log('');

      qrcode.generate(qr, { small: true });

      console.log('');
      console.log(
        'Escanea el QR desde WhatsApp > Dispositivos vinculados'
      );
      console.log('');
    }

    if (connection === 'open') {
      connectionStatus = 'CONNECTED';
      reconnecting = false;

      console.log('');
      console.log('======================================');
      console.log(' WhatsApp conectado');
      console.log('======================================');
      console.log('');
    }

    if (connection === 'close') {
      connectionStatus = 'DISCONNECTED';

      const statusCode =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : undefined;

      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut;

      console.log('');
      console.log('WhatsApp desconectado');
      console.log('Status:', statusCode);
      console.log('Reconnect:', shouldReconnect);
      console.log('');

      socket = null;

      if (shouldReconnect && !reconnecting) {
        reconnecting = true;

        setTimeout(async () => {
          try {
            await connect();
          } catch (error) {
            reconnecting = false;

            console.error(
              'Error reconectando WhatsApp:',
              error
            );
          }
        }, 3000);
      } else if (!shouldReconnect) {
        console.log(
          'La sesión fue cerrada. Debes eliminar las credenciales y volver a vincular WhatsApp.'
        );
      }
    }
  }

  function handleIncomingMessages(event) {
    if (event.type !== 'notify' || !onMessage) {
      return;
    }

    // Se leen en cada upsert: tras una reconexion el socket es otro.
    const ownJids = [socket?.user?.id, socket?.user?.lid]
      .filter(Boolean)
      .map((jid) => jidNormalizedUser(jid));

    for (const message of event.messages) {
      const perlaEvent = toPerlaEvent(message, {
        isSentByApi,
        isIgnoredNumber,
        ownJids,
      });

      if (!perlaEvent) {
        continue;
      }

      // El reenvio no debe cortar la recepcion de los demas mensajes.
      try {
        onMessage(perlaEvent);
      } catch (error) {
        console.error(
          'Error reenviando mensaje de WhatsApp:',
          perlaEvent.messageId,
          error.message
        );
      }
    }
  }

  function isConnected() {
    return connectionStatus === 'CONNECTED';
  }

  function getStatus() {
    return {
      status: connectionStatus,
      connected: connectionStatus === 'CONNECTED',
    };
  }

  async function sendMessage({ jid, phone, text }) {
    if (!socket || connectionStatus !== 'CONNECTED') {
      throw new Error(
        'WhatsApp no está conectado'
      );
    }

    const to = jid || `${normalizePhone(phone)}@s.whatsapp.net`;

    // El ID se fija y se registra ANTES de enviar: el eco (`upsert` notify con
    // fromMe) puede llegar antes de que `sendMessage` resuelva.
    const messageId = generateMessageIDV2(socket.user?.id);

    registerSentId(messageId);

    return socket.sendMessage(to, { text }, { messageId });
  }

  return {
    connect,
    sendMessage,
    getStatus,
    isConnected,
  };
}

function normalizePhone(phone) {
  const normalized = String(phone ?? '').replace(/\D/g, '');

  if (!normalized) {
    throw new Error(
      'El número de teléfono es inválido'
    );
  }

  return normalized;
}
