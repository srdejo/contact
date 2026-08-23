# ARCHITECTURE.md

Estado real de la arquitectura de `contact-api`. No aspiracional.

## Visión general

Servicio HTTP de un solo propósito: recibir un formulario de contacto y notificarlo por dos canales (email y WhatsApp), en paralelo, sin persistencia.

```
Cliente (nolost frontend)
        │  POST /api/contact { name, email, message }
        ▼
   contact-api (Express)
        │
        ├── resend.client.js  ──► Resend API (email)
        └── whatsapp.client.js ──► Meta Cloud API (WhatsApp)
```

## Componentes

- **`src/server.js`** — define las dos rutas (`GET /health`, `POST /api/contact`), valida los campos requeridos, arma el HTML del email y el texto del WhatsApp, y llama a ambos clientes en paralelo con `try/catch` independiente por canal.
- **`src/resend.client.js`** — wrapper sobre el SDK de Resend, usa `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_TO`.
- **`src/whatsapp.client.js`** — llamada directa a la Meta Cloud API (fetch/HTTP, sin SDK), usa `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TO_NUMBER`.

## Manejo de errores

Cada canal (email, WhatsApp) puede fallar independientemente del otro:
- Ambos OK → `200`.
- Uno falla → `207` con detalle en `errors.{email|whatsapp}`.
- Faltan campos requeridos → `400`, no se intenta ningún canal.

No hay reintentos ni cola — si un canal falla, el request al cliente refleja el fallo y no hay reproceso automático.

## Estado y persistencia

Ninguno. No hay base de datos. Cada request es independiente; no se guarda historial de mensajes de contacto en este servicio.

## Deploy

Ver `README.md` — sección "Cómo corre en producción". Proceso `systemd` (`nolost-contact.service`), expuesto vía nginx bajo `nolost` (`micasachurch.co/contact/`), deploy manual vía `nolost/deploy.ps1`.
