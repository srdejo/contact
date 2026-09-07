import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { sendEmail } from './clients/resend.client.js';
import { sendGmailEmail } from './clients/gmail.client.js';
import * as whatsappClient from './clients/whatsapp.client.js';

import { createContactController } from './controllers/contact.controller.js';
import { createGmailController } from './controllers/gmail.controller.js';
import { createWhatsAppController } from './controllers/whatsapp.controller.js';

const app = express();

app.use(cors());
app.use(express.json());

const LOOPBACK_ADDRESSES = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);

// Segunda capa: aunque el socket ya escucha solo en loopback, cada ruta de
// negocio revalida el origen. Ojo: esto NO protege de un proxy nginx corriendo
// en el mismo host — nginx llegaria como 127.0.0.1 y pasaria. La proteccion
// real contra exposicion publica es no tener ese proxy (ver docs/DEPLOYMENT.md).
function requireLocalhost(req, res, next) {
  const ip = req.socket.remoteAddress;

  if (!LOOPBACK_ADDRESSES.has(ip)) {
    return res.status(403).json({
      error: 'forbidden',
    });
  }

  next();
}

// --- composicion: los clientes son el transporte, los servicios el contrato ---
// Los controladores dependen de estos objetos, no de los modulos cliente, para
// que la ruta se pueda probar con un doble y para que cambiar de proveedor
// (Resend -> Gmail, Meta -> Baileys) no obligue a tocar la capa web.
const emailService = {
  send: (payload) => sendEmail(payload),
};

const gmailService = {
  send: (payload) => sendGmailEmail(payload),
};

const whatsappService = {
  send: (payload) => whatsappClient.sendMessage(payload),
  status: () => whatsappClient.getStatus(),
};

const contactController = createContactController({
  emailService,
  whatsappService,
  whatsappToNumber: () => process.env.WHATSAPP_TO_NUMBER,
});

const gmailController = createGmailController({ gmailService });

const whatsappController = createWhatsAppController({ whatsappService });

// --- rutas ---------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
  });
});

app.post('/api/contact', requireLocalhost, contactController.send);

app.get('/api/whatsapp/status', requireLocalhost, whatsappController.status);

app.post('/api/whatsapp/send', requireLocalhost, whatsappController.send);

app.post('/api/send', requireLocalhost, gmailController.send);

const port = process.env.PORT || 3000;

// Servicio interno: escucha SOLO en loopback. Los consumidores son otros
// servicios del mismo servidor (nolost, hotel-backend, consulting, micasachurch),
// que lo llaman por http://127.0.0.1:PORT. No debe haber proxy publico hacia aca
// — ver docs/DEPLOYMENT.md > "Por que no se expone".
const host = process.env.HOST || '127.0.0.1';

app.listen(port, host, async () => {
  console.log(
    `Contact API escuchando en http://${host}:${port} (solo loopback)`
  );

  try {
    await whatsappClient.connect();
  } catch (error) {
    console.error(
      'No se pudo iniciar WhatsApp:',
      error
    );
  }
});
