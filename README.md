# contact

API de contacto (Node/Express) usada por el frontend de `nolost` (Mi Casa Church). Recibe el formulario de contacto público y lo reenvía por email (Resend) y WhatsApp (Meta Cloud API).

Antes vivía dentro de `nolost/contact/`; se movió a la raíz del workspace porque es un servicio independiente en producción, con su propio proceso y ciclo de deploy, separado del backend de `nolost`.

## Endpoints

- `GET /health` — chequeo de salud, usado por nginx (`location = /contact/health`).
- `POST /api/contact` — recibe `{ name, email, message }`, envía el mensaje por email y WhatsApp. Responde `200` si ambos canales funcionan, `207` si alguno falla (ver `errors` en la respuesta), `400` si faltan campos.

## Variables de entorno

Ver `.env.example`:

| Variable | Uso |
|---|---|
| `PORT` | Puerto HTTP (3000 en prod y en local) |
| `RESEND_API_KEY` | API key de [Resend](https://resend.com) para envío de email |
| `MAIL_FROM` / `MAIL_TO` | Remitente/destinatario del email de contacto |
| `WHATSAPP_TOKEN` | Token de la app de Meta for Developers (WhatsApp Cloud API) |
| `WHATSAPP_PHONE_ID` | ID del número de WhatsApp Business emisor |
| `WHATSAPP_TO_NUMBER` | Número que recibe la notificación de WhatsApp |

## Cómo corre en producción (nolost-vps)

- Proceso: `systemd` unit `nolost-contact.service` — `node src/server.js`, `Restart=on-failure`, variables cargadas desde `.env` en el working directory del servicio.
- nginx expone el servicio bajo `https://micasachurch.co/contact/` (proxy a `127.0.0.1:3000`) y `location = /contact/health` para el health check.
- Deploy: `nolost/deploy.ps1` opción "Deploy Contact API" — sube `src/` y `package.json` por `scp`, corre `npm install --omit=dev` en el servidor y reinicia el servicio.

## Cómo correr en local

```bash
cp .env.example .env   # completar con claves de desarrollo/sandbox
npm install
npm run dev             # node --watch src/server.js — reinicia solo al guardar cambios
```

En el entorno local completo (ver `infra/` en la raíz del workspace), este servicio se levanta junto con `nolost` vía `infra/start.ps1` y queda accesible en `http://nolost.local/contact/`.
