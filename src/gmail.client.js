import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export async function sendGmailEmail({ to, subject, html, from }) {
  return transporter.sendMail({
    from: from || process.env.GMAIL_FROM || process.env.GMAIL_USER,
    to,
    subject,
    html,
  });
}
