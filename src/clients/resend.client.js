import { Resend } from 'resend';

export const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * El SDK de Resend NO lanza ante un fallo de envío: devuelve `{ data, error }`.
 * Eso ya provocó una vez que `/api/contact` respondiera 200 fingiendo éxito, así
 * que la traducción a excepción vive aquí, en la frontera con el proveedor, y no
 * en cada llamador.
 */
export async function sendEmail({ subject, html, to, from }) {
  const response = await resend.emails.send({
    from: from || process.env.MAIL_FROM || 'Acme <onboarding@resend.dev>',
    to: [to || process.env.MAIL_TO],
    subject,
    html,
  });

  if (response?.error) {
    throw new Error(response.error.message);
  }

  return response;
}
