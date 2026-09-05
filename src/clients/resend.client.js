import { Resend } from 'resend';

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail({ subject, html, to, from }) {
  return resend.emails.send({
    from: from || process.env.MAIL_FROM || 'Acme <onboarding@resend.dev>',
    to: [to || process.env.MAIL_TO],
    subject,
    html,
  });
}
