import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_FOLDER = path.resolve(
  __dirname,
  '../../data/whatsapp/auth'
);

let socket = null;
let connectionStatus = 'DISCONNECTED';
let reconnecting = false;

export async function connect() {
  if (socket) {
    return;
  }

  const { state, saveCreds } =
    await useMultiFileAuthState(AUTH_FOLDER);

  socket = makeWASocket({
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

async function handleIncomingMessages(event) {
  if (event.type !== 'notify') {
    return;
  }

  for (const message of event.messages) {
    if (message.key.fromMe) {
      continue;
    }

    console.log(
      'Mensaje recibido:',
      message.key.remoteJid
    );
  }
}

export function isConnected() {
  return connectionStatus === 'CONNECTED';
}

export function getStatus() {
  return {
    status: connectionStatus,
    connected: connectionStatus === 'CONNECTED',
  };
}

export async function sendMessage({ phone, text }) {
  if (!socket || connectionStatus !== 'CONNECTED') {
    throw new Error(
      'WhatsApp no está conectado'
    );
  }

  const normalizedPhone = normalizePhone(phone);

  const jid = `${normalizedPhone}@s.whatsapp.net`;

  return socket.sendMessage(jid, {
    text,
  });
}

function normalizePhone(phone) {
  const normalized = String(phone).replace(/\D/g, '');

  if (!normalized) {
    throw new Error(
      'El número de teléfono es inválido'
    );
  }

  return normalized;
}