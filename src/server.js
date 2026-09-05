import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { sendEmail } from './clients/resend.client.js';
import { sendGmailEmail } from './clients/gmail.client.js';

import * as whatsappClient from './clients/whatsapp.client.js';

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

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
  });
});

app.post('/api/contact', requireLocalhost, async (req, res) => {
  const { name, email, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({
      error: 'name, email y message son requeridos',
    });
  }

  const html = `
    <p><strong>Nombre:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Mensaje:</strong></p>
    <p>${message}</p>
  `;

  const results = { email: null, whatsapp: null };
  const errors = {};

  try {
    const emailResult = await sendEmail({
      subject: `Nuevo contacto de ${name}`,
      html,
    });

    // El SDK de Resend no lanza: devuelve { data, error }.
    if (emailResult?.error) {
      throw new Error(emailResult.error.message);
    }

    results.email = emailResult;
  } catch (err) {
    errors.email = err.message;
  }

  try {
    results.whatsapp =
      await whatsappClient.sendMessage({
        phone: process.env.WHATSAPP_TO_NUMBER,
        text: `Nuevo contacto:\nNombre: ${name}\nEmail: ${email}\nMensaje: ${message}`,
      });
  } catch (err) {
    errors.whatsapp = err.message;
  }

  const hasErrors = Object.keys(errors).length > 0;

  res.status(hasErrors ? 207 : 200).json({
    results,
    errors: hasErrors ? errors : undefined,
  });
});

app.get('/api/whatsapp/status', requireLocalhost, (_req, res) => {
  res.json(
    whatsappClient.getStatus()
  );
});

app.post('/api/whatsapp/send', requireLocalhost, async (req, res) => {
  const { phone, text } = req.body || {};

  if (!phone || !text) {
    return res.status(400).json({
      error: 'phone y text son requeridos',
    });
  }

  try {
    const result =
      await whatsappClient.sendMessage({
        phone,
        text,
      });

    res.json({
      status: 'ok',
      messageId: result?.key?.id,
    });
  } catch (error) {
    res.status(502).json({
      error: error.message,
    });
  }
});

app.post('/api/send', requireLocalhost, async (req, res) => {
  const { to, subject, html, from } = req.body || {};

  if (!to || !subject || !html) {
    return res.status(400).json({
      error: 'to, subject y html son requeridos',
    });
  }

  try {
    await sendGmailEmail({
      to,
      subject,
      html,
      from,
    });

    res.json({
      status: 'ok',
    });
  } catch (error) {
    res.status(502).json({
      error: error.message,
    });
  }
});

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