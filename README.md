# contact

API de contacto (Node/Express) usada por el frontend principal (Mi Casa Church). Recibe el formulario de contacto público y lo reenvía por email (Resend) y WhatsApp (Meta Cloud API).

Servicio independiente, con su propio proceso y ciclo de deploy, separado del backend principal.

## Endpoints

- `GET /health` — chequeo de salud.
- `POST /api/contact` — recibe `{ name, email, message }`, envía el mensaje por email y WhatsApp. Responde `200` si ambos canales funcionan, `207` si alguno falla (ver `errors` en la respuesta), `400` si faltan campos.

## Variables de entorno

Ver `.env.example`:

| Variable | Uso |
|---|---|
| `PORT` | Puerto HTTP |
| `RESEND_API_KEY` | API key de [Resend](https://resend.com) para envío de email |
| `MAIL_FROM` / `MAIL_TO` | Remitente/destinatario del email de contacto |
| `WHATSAPP_TOKEN` | Token de la app de Meta for Developers (WhatsApp Cloud API) |
| `WHATSAPP_PHONE_ID` | ID del número de WhatsApp Business emisor |
| `WHATSAPP_TO_NUMBER` | Número que recibe la notificación de WhatsApp |

## Cómo correr en local

```bash
cp .env.example .env   # completar con claves de desarrollo/sandbox
npm install
npm run dev             # node --watch src/server.js — reinicia solo al guardar cambios
```
