# ARCHITECTURE.md

Estado real de la arquitectura de `contact-api`. No aspiracional.

## Visión general

Servicio HTTP **interno** (solo loopback, ver `DECISIONS.md` 2026-09-05) con dos propósitos: (1) recibir un mensaje de contacto y notificarlo por dos canales (email y WhatsApp), en paralelo, sin persistencia; (2) desde 2026-08-24, exponer un envío de email genérico para otros servicios del mismo servidor.

```
Otro servicio del mismo host (127.0.0.1)
        │  POST /api/contact { name, email, message }
        ▼
   contact-api (Express)
        │
        ├── clients/resend.client.js  ──► Resend API (email)
        └── clients/whatsapp.client.js ──► Baileys ──► WhatsApp Web (sesión persistente)

Otro servicio del mismo servidor (ej. hotel-backend, consulting)
        │  POST /api/send { to, subject, html }  — solo desde localhost
        ▼
   contact-api (Express) ──► gmail.client.js ──► Gmail SMTP (email)
```

## Componentes

- **`src/server.js`** — define las rutas (`GET /health`, `POST /api/contact`, `POST /api/send`), valida los campos requeridos, arma el HTML del email y el texto del WhatsApp para `/api/contact`, y llama a ambos clientes en paralelo con `try/catch` independiente por canal. `/api/send` pasa por el middleware `requireLocalhost` (rechaza con `403` si `req.socket.remoteAddress` no es loopback) antes de reenviar el payload tal cual a `sendGmailEmail`.
- **`src/clients/resend.client.js`** — wrapper sobre el SDK de Resend, usa `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_TO`. Solo lo usa `/api/contact` (formulario público de Mi Casa Church). Ojo: el SDK de Resend **no lanza excepción** cuando falla — devuelve `{ data, error }`; `server.js` chequea `error` explícitamente para que el fallo se refleje en el `207`.
- **`src/clients/gmail.client.js`** — wrapper sobre `nodemailer` (transporte `gmail`), usa `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM`. Solo lo usa `/api/send` — se eligió Gmail en vez de Resend para este endpoint porque sus consumidores (`hotel-backend`, `consulting`) no tenían un dominio propio verificado en Resend (`hotel-backend` fue el primer consumidor y ya se implementó así; `consulting` lo confirmó de nuevo al integrarse, ver `docs/DECISIONS.md`).
- **`src/clients/whatsapp.client.js`** — cliente de WhatsApp sobre `@whiskeysockets/baileys` (WhatsApp Web multi-dispositivo). Mantiene un socket vivo y una máquina de estados (`DISCONNECTED` / `QR_REQUIRED` / `CONNECTED`) con reconexión automática a los 3s, salvo `loggedOut`. La sesión se guarda en `data/whatsapp/auth/` vía `useMultiFileAuthState`. Expone `connect()`, `sendMessage({ phone, text })`, `getStatus()`, `isConnected()`. Lo usan `/api/contact` (al número de `WHATSAPP_TO_NUMBER`) y `/api/whatsapp/send` (a un número arbitrario). No aplica a `/api/send` (ese endpoint es solo email).
- **`src/controllers/whatsapp.controller.js`** — **código muerto hoy**: `server.js` no lo importa y espera un `whatsappService` que no existe. Escrito como paso intermedio de un refactor sin terminar. O se cablea o se borra; no describe el comportamiento actual.

## Manejo de errores

`/api/contact` — cada canal (email, WhatsApp) puede fallar independientemente del otro:
- Ambos OK → `200`.
- Uno falla → `207` con detalle en `errors.{email|whatsapp}`.
- Faltan campos requeridos → `400`, no se intenta ningún canal.

Todas las rutas de negocio (`/api/contact`, `/api/whatsapp/*`, `/api/send`) responden `403` si la petición no viene de loopback. `/health` es la única sin ese middleware.

`/api/send` — un solo canal (email):
- OK → `200`.
- Faltan `to`/`subject`/`html` → `400`.
- Resend falla → `502`.
- Request no viene de localhost → `403` (ver "Acceso restringido" en `README.md`).

No hay reintentos ni cola en ningún endpoint — si un canal falla, el request al cliente refleja el fallo y no hay reproceso automático.

## Estado y persistencia

No hay base de datos ni historial de mensajes de contacto — cada request HTTP es independiente.

Pero el proceso **sí tiene estado**, desde el cambio a Baileys (2026-09-05): la sesión de WhatsApp vive en `data/whatsapp/auth/` (gitignoreada) y el socket se mantiene abierto mientras el proceso corre. Implicaciones: la carpeta debe sobrevivir a los redeploys, es una credencial que hay que respaldar y proteger, y **solo puede correr una instancia** (dos procesos con la misma sesión se desconectan entre sí). Ver `docs/DECISIONS.md`.
