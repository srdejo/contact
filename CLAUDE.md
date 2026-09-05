# CLAUDE.md

Reglas de trabajo para este repo (`contact-api`, descrito en `README.md`). Léelo antes de tocar código.

## Qué es este proyecto

Microservicio Node/Express que recibe un mensaje y lo reenvía por email (Resend / Gmail SMTP) y WhatsApp (Baileys / WhatsApp Web). **Es un servicio interno**: escucha solo en `127.0.0.1` y lo consumen otros servicios del mismo host. Proceso y ciclo de deploy propios, separados del backend principal. Ver `docs/DEPLOYMENT.md`.

Para más detalle ver, en este orden:
1. `docs/ARCHITECTURE.md` — cómo está construido hoy.
2. `docs/DECISIONS.md` — decisiones tomadas.
3. `docs/ROADMAP.md` — qué falta, si algo.
4. `docs/PROGRESS.md` — estado actual.
5. `docs/DEPLOYMENT.md` — cómo se instala y despliega en el VPS.

## Stack

- Node.js + Express, ES modules (`"type": "module"`).
- `resend` para email de `/api/contact`, `nodemailer` (Gmail SMTP) para `/api/send`, `@whiskeysockets/baileys` para WhatsApp.
- Sin base de datos y sin build step, pero **ya no es stateless**: Baileys mantiene una sesión de WhatsApp en `data/whatsapp/auth/` y un WebSocket vivo. Ver `docs/DECISIONS.md`.

## Convenciones de código

- Todo el código en `src/`: un archivo por integración externa en `src/clients/` (`resend.client.js`, `gmail.client.js`, `whatsapp.client.js`) más `server.js` con las rutas.
- Sin frameworks de validación — la validación de `POST /api/contact` es manual e intencionalmente mínima (ver `server.js`).
- Español en mensajes de error orientados al usuario final; inglés en nombres de variables/funciones.
- No agregar dependencias ni capas (router separado, controllers, etc.) mientras el servicio siga siendo un solo endpoint — YAGNI.

## Proceso de trabajo

- Antes de cambiar el contrato de `POST /api/contact`, revisar `README.md` — los consumidores dependen del shape exacto de la respuesta (`results`/`errors`, códigos 200/207/400).
- **Ninguna ruta nueva se expone por nginx.** Este servicio es interno por diseño (ver `docs/DECISIONS.md`, 2026-09-05); toda ruta nueva lleva `requireLocalhost`. Si alguna vez hace falta acceso público, va a través de un backend del workspace, no reabriendo este servicio.
- Actualizar `docs/PROGRESS.md` al cerrar una tarea del roadmap.
- Si un ítem del roadmap no tiene criterio de aceptación claro, no lo ejecutes a ciegas — regístralo como bloqueo de definición en `docs/PROGRESS.md` y pregunta al usuario en vez de asumir el alcance.
