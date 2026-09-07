import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

/**
 * La identidad del remitente se arma aquí, no en el llamador. `contact` es el único
 * que conoce la cuenta que envía, así que los demás servicios sólo declaran QUIÉN
 * son (`fromName`) y no repiten la dirección en tres `.env` distintos.
 *
 * Gmail sólo acepta como dirección la cuenta autenticada o un alias verificado en
 * "Enviar como"; cualquier otra la reescribe. Por eso `fromName` cambia el nombre
 * visible y la dirección sigue siendo `GMAIL_USER`.
 */
export function resolveFrom({ from, fromName }) {
  // Compatibilidad: quien mande la cabecera completa manda.
  if (from) {
    return from;
  }

  const address = process.env.GMAIL_USER;
  const name = sanitizeName(fromName);

  if (name) {
    // Objeto en vez de string: nodemailer se encarga de escapar y codificar el
    // nombre (tildes, comas), que a mano es justo donde se rompe la cabecera.
    return { name, address };
  }

  return process.env.GMAIL_FROM || address;
}

/** Un CR/LF en el nombre permitiría inyectar cabeceras; no hay nombre legítimo con saltos. */
function sanitizeName(fromName) {
  if (typeof fromName !== 'string') {
    return '';
  }
  return fromName.replace(/\s+/g, ' ').trim();
}

export async function sendGmailEmail({ to, subject, html, from, fromName }) {
  return transporter.sendMail({
    from: resolveFrom({ from, fromName }),
    to,
    subject,
    html,
  });
}
