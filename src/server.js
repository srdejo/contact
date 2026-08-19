import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { sendEmail } from './resend.client.js';
import { sendWhatsAppMessage } from './whatsapp.client.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email y message son requeridos' });
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
    results.email = await sendEmail({ subject: `Nuevo contacto de ${name}`, html });
  } catch (err) {
    errors.email = err.message;
  }

  try {
    results.whatsapp = await sendWhatsAppMessage({
      text: `Nuevo contacto:\nNombre: ${name}\nEmail: ${email}\nMensaje: ${message}`,
    });
  } catch (err) {
    errors.whatsapp = err.message;
  }

  const hasErrors = Object.keys(errors).length > 0;
  res.status(hasErrors ? 207 : 200).json({ results, errors: hasErrors ? errors : undefined });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Contact API escuchando en http://localhost:${port}`);
});
