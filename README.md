# contact

API de contacto (Node/Express) usada por el frontend principal (Mi Casa Church). Recibe el formulario de contacto público y lo reenvía por email (Resend) y WhatsApp (Meta Cloud API).

Servicio independiente, con su propio proceso y ciclo de deploy, separado del backend principal.

## Endpoints

- `GET /health` — chequeo de salud.
- `POST /api/contact` — recibe `{ name, email, message }`, envía el mensaje por email y WhatsApp. Responde `200` si ambos canales funcionan, `207` si alguno falla (ver `errors` en la respuesta), `400` si faltan campos.
- `POST /api/send` — endpoint genérico de envío de email, **de uso interno únicamente** (ver "Acceso restringido" abajo). Recibe `{ to, subject, html, from? }`, envía por **Gmail SMTP** vía `gmail.client.js` (`nodemailer`) — distinto proveedor que `/api/contact` (Resend), porque los consumidores de `/api/send` (`hotel-backend`, `consulting`) no tenían un dominio verificado en Resend cuando se agregó cada uno. Responde `200` en éxito, `400` si faltan `to`/`subject`/`html`, `502` si Gmail falla, `403` si la petición no viene de localhost.

### Acceso restringido a `/api/send`

A diferencia de `/api/contact` (público, para el formulario de contacto), `/api/send` está pensado para que otros servicios del mismo servidor (ej. `hotel-backend`, `consulting`) lo consuman como cliente HTTP simple, sin exponerlo a internet. Se protege en dos capas:
- `server.js` rechaza con `403` cualquier request cuyo `req.socket.remoteAddress` no sea loopback (`127.0.0.1`/`::1`/`::ffff:127.0.0.1`).
- El proxy nginx que expone `contact` públicamente (`location /contact/` en `infra/nginx/edge.conf` en local, y el nginx del VPS en producción) **no debe reenviar** `/contact/api/send` — si lo hiciera, nginx llegaría a `contact` desde `127.0.0.1` y burlaría el chequeo del punto anterior. Ver el bloque `location = /contact/api/send { return 404; }` en `edge.conf` como referencia; replicar el mismo corte en la config de nginx de producción antes de depender de este endpoint desde un servicio remoto.

## Variables de entorno

Ver `.env.example`:

| Variable | Uso |
|---|---|
| `PORT` | Puerto HTTP |
| `RESEND_API_KEY` | API key de [Resend](https://resend.com) para envío de email de `/api/contact` |
| `MAIL_FROM` / `MAIL_TO` | Remitente/destinatario del email de contacto (`/api/contact`) |
| `GMAIL_USER` | Cuenta de Gmail que envía por `/api/send` |
| `GMAIL_APP_PASSWORD` | [Contraseña de aplicación](https://myaccount.google.com/apppasswords) de esa cuenta (no la clave normal) |
| `GMAIL_FROM` | Remitente que se muestra en `/api/send` (opcional, por defecto `GMAIL_USER`) |
| `WHATSAPP_TOKEN` | Token de la app de Meta for Developers (WhatsApp Cloud API) |
| `WHATSAPP_PHONE_ID` | ID del número de WhatsApp Business emisor |
| `WHATSAPP_TO_NUMBER` | Número que recibe la notificación de WhatsApp |

## Cómo correr en local

```bash
cp .env.example .env   # completar con claves de desarrollo/sandbox
npm install
npm run dev             # node --watch src/server.js — reinicia solo al guardar cambios
```
