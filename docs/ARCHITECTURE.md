# ARCHITECTURE.md

Estado real de la arquitectura de `contact-api`. No aspiracional.

## Visión general

Servicio HTTP **interno** (solo loopback, ver `DECISIONS.md` 2026-09-05) con tres propósitos: (1) recibir un mensaje de contacto y notificarlo por dos canales (email y WhatsApp), sin persistencia; (2) desde 2026-08-24, exponer un envío de email genérico para otros servicios del mismo servidor; (3) desde 2026-09-25, ser el conector de WhatsApp de PERLA: le reenvía lo que llega al número de Baileys y le deja responder por `POST /api/whatsapp/send`.

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

PERLA (127.0.0.1:8084)
        │  POST /api/whatsapp/send { jid | phone, text }
        ▼
   contact-api ──► whatsapp.client.js ──► WhatsApp
        ▲                    │ messages.upsert (notify)
        │                    ▼
        │           whatsapp.events.js (INBOUND / OWNER / se ignora)
        │                    │
        └──── perla.client.js ── POST PERLA_EVENTS_URL + X-Perla-Channel-Secret (saliente)
```

## Componentes

- **`src/server.js`** — solo composición y tabla de rutas: crea los clientes, los envuelve en servicios (`emailService`, `gmailService`, `whatsappService`) y se los pasa a los controladores. Define `requireLocalhost` (rechaza con `403` si `req.socket.remoteAddress` no es loopback), que protege todas las rutas salvo `/health`. Crea el cliente de PERLA solo si `PERLA_EVENTS_URL` tiene valor.
- **`src/controllers/`** — una implementación por endpoint, cada una una fábrica que recibe su servicio para poder probarla con un doble:
  - `contact.controller.js` — `POST /api/contact`: valida, escapa el HTML del correo y notifica por email y WhatsApp con `try/catch` independiente por canal (`200`/`207`/`400`).
  - `gmail.controller.js` — `POST /api/send`: reenvía el payload a Gmail (`200`/`400`/`502`).
  - `whatsapp.controller.js` — `POST /api/whatsapp/send` (destino `jid` o `phone`, `200`/`400`/`502`) y `GET /api/whatsapp/status`.
- **`src/clients/resend.client.js`** — wrapper sobre el SDK de Resend, usa `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_TO`. Solo lo usa `/api/contact`. Ojo: el SDK de Resend **no lanza excepción** cuando falla — devuelve `{ data, error }`; el cliente lo traduce a excepción para que el fallo se refleje en el `207`.
- **`src/clients/gmail.client.js`** — wrapper sobre `nodemailer` (transporte `gmail`), usa `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM`. Solo lo usa `/api/send` — se eligió Gmail en vez de Resend para este endpoint porque sus consumidores (`hotel-backend`, `consulting`) no tenían un dominio propio verificado en Resend (ver `docs/DECISIONS.md`).
- **`src/clients/whatsapp.client.js`** — `createWhatsAppClient(...)`: cliente de WhatsApp sobre `@whiskeysockets/baileys`. Mantiene un socket vivo y una máquina de estados (`DISCONNECTED` / `QR_REQUIRED` / `CONNECTED`) con reconexión automática a los 3 s, salvo `loggedOut`. La sesión se guarda en `data/whatsapp/auth/`. Expone `connect()`, `sendMessage({ jid, phone, text })`, `getStatus()`, `isConnected()`.
  - Cada envío genera su ID **antes** de llamar a Baileys y lo registra 15 minutos como "enviado por la API": el eco de ese mensaje puede llegar antes de que el envío resuelva y no debe confundirse con Daniel escribiendo desde el teléfono.
  - En `messages.upsert` de tipo `notify` pasa cada mensaje por `toPerlaEvent` y entrega los reenviables a `onMessage` sin esperar.
  - Es una fábrica (socket y estado de autenticación inyectables) para probar el caso del eco con un doble, sin red ni disco.
- **`src/clients/whatsapp.events.js`** — `toPerlaEvent(message, ...)`: función pura que traduce un mensaje de Baileys al evento del contrato D1 de PERLA, o `null` si se ignora (grupos, difusiones, estados, newsletters, llamadas, reacciones, ediciones y borrados, mensajes sin contenido, el número de `WHATSAPP_TO_NUMBER`, "Mensaje a mí mismo" y los ecos de envíos de la API). Prefiere el JID de teléfono sobre el `@lid`.
- **`src/clients/perla.client.js`** — `createPerlaClient(...)`: `POST` a `PERLA_EVENTS_URL` con `X-Perla-Channel-Secret`. Reintenta `5xx` y la falta de respuesta (timeout de 10 s) a 1 s, 5 s y 30 s, y luego descarta con log; `400`/`401`/`404`/`503` (y cualquier otro `4xx`) no se reintentan. Encola por chat para conservar el orden.
- **`src/utils/escape-html.js`** — `escaparHtml()`, usado por el correo de `/api/contact`.

## Manejo de errores

`/api/contact` — cada canal (email, WhatsApp) puede fallar independientemente del otro:
- Ambos OK → `200`.
- Uno falla → `207` con detalle en `errors.{email|whatsapp}`.
- Faltan campos requeridos → `400`, no se intenta ningún canal.

Todas las rutas de negocio (`/api/contact`, `/api/whatsapp/*`, `/api/send`) responden `403` si la petición no viene de loopback. `/health` es la única sin ese middleware.

`/api/send` — un solo canal (email):
- OK → `200`.
- Faltan `to`/`subject`/`html` → `400`.
- Gmail falla → `502`.
- Request no viene de localhost → `403` (ver "Acceso restringido" en `README.md`).

Los endpoints no tienen reintentos ni cola — si un canal falla, la respuesta al cliente refleja el fallo. La única cola es la del reenvío a PERLA, que es saliente y no afecta a ninguna ruta: vive en memoria, por chat, y se pierde si el proceso se reinicia.

## Estado y persistencia

No hay base de datos ni historial de mensajes de contacto — cada request HTTP es independiente.

Pero el proceso **sí tiene estado**, desde el cambio a Baileys (2026-09-05): la sesión de WhatsApp vive en `data/whatsapp/auth/` (gitignoreada) y el socket se mantiene abierto mientras el proceso corre. Implicaciones: la carpeta debe sobrevivir a los redeploys, es una credencial que hay que respaldar y proteger, y **solo puede correr una instancia** (dos procesos con la misma sesión se desconectan entre sí). Ver `docs/DECISIONS.md`.

Desde el reenvío a PERLA (2026-09-25) hay además dos estados en memoria, que un reinicio vacía: el registro de IDs enviados por la API (15 minutos) y la cola de reintentos hacia PERLA.
