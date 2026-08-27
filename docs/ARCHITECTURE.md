# ARCHITECTURE.md

Estado real de la arquitectura de `contact-api`. No aspiracional.

## Visión general

Servicio HTTP con dos propósitos: (1) recibir el formulario de contacto público y notificarlo por dos canales (email y WhatsApp), en paralelo, sin persistencia; (2) desde 2026-08-24, exponer un envío de email genérico para uso interno de otros servicios del mismo servidor.

```
Cliente (frontend público)
        │  POST /api/contact { name, email, message }
        ▼
   contact-api (Express)
        │
        ├── resend.client.js  ──► Resend API (email)
        └── whatsapp.client.js ──► Meta Cloud API (WhatsApp)

Otro servicio del mismo servidor (ej. hotel-backend, consulting)
        │  POST /api/send { to, subject, html }  — solo desde localhost
        ▼
   contact-api (Express) ──► gmail.client.js ──► Gmail SMTP (email)
```

## Componentes

- **`src/server.js`** — define las rutas (`GET /health`, `POST /api/contact`, `POST /api/send`), valida los campos requeridos, arma el HTML del email y el texto del WhatsApp para `/api/contact`, y llama a ambos clientes en paralelo con `try/catch` independiente por canal. `/api/send` pasa por el middleware `requireLocalhost` (rechaza con `403` si `req.socket.remoteAddress` no es loopback) antes de reenviar el payload tal cual a `sendGmailEmail`.
- **`src/resend.client.js`** — wrapper sobre el SDK de Resend, usa `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_TO`. Solo lo usa `/api/contact` (formulario público de Mi Casa Church).
- **`src/gmail.client.js`** — wrapper sobre `nodemailer` (transporte `gmail`), usa `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM`. Solo lo usa `/api/send` — se eligió Gmail en vez de Resend para este endpoint porque sus consumidores (`hotel-backend`, `consulting`) no tenían un dominio propio verificado en Resend (`hotel-backend` fue el primer consumidor y ya se implementó así; `consulting` lo confirmó de nuevo al integrarse, ver `docs/DECISIONS.md`).
- **`src/whatsapp.client.js`** — llamada directa a la Meta Cloud API (fetch/HTTP, sin SDK), usa `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TO_NUMBER`. No aplica a `/api/send` (ese endpoint es solo email).

## Manejo de errores

`/api/contact` — cada canal (email, WhatsApp) puede fallar independientemente del otro:
- Ambos OK → `200`.
- Uno falla → `207` con detalle en `errors.{email|whatsapp}`.
- Faltan campos requeridos → `400`, no se intenta ningún canal.

`/api/send` — un solo canal (email):
- OK → `200`.
- Faltan `to`/`subject`/`html` → `400`.
- Resend falla → `502`.
- Request no viene de localhost → `403` (ver "Acceso restringido" en `README.md`).

No hay reintentos ni cola en ningún endpoint — si un canal falla, el request al cliente refleja el fallo y no hay reproceso automático.

## Estado y persistencia

Ninguno. No hay base de datos. Cada request es independiente; no se guarda historial de mensajes de contacto en este servicio.
