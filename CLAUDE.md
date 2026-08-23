# CLAUDE.md

Reglas de trabajo para este repo (`contact-api`, descrito en `README.md`). Léelo antes de tocar código.

## Qué es este proyecto

Microservicio Node/Express que recibe el formulario público de contacto del frontend principal (Mi Casa Church) y lo reenvía por email (Resend) y WhatsApp (Meta Cloud API). Es un servicio independiente, con su propio proceso y ciclo de deploy en producción, separado del backend principal.

Para más detalle ver, en este orden:
1. `docs/ARCHITECTURE.md` — cómo está construido hoy.
2. `docs/DECISIONS.md` — decisiones tomadas.
3. `docs/ROADMAP.md` — qué falta, si algo.
4. `docs/PROGRESS.md` — estado actual.

## Stack

- Node.js + Express, ES modules (`"type": "module"`).
- `resend` para email, llamada directa a la Meta Cloud API (WhatsApp) sin SDK.
- Sin base de datos, sin build step — es un servicio stateless de un solo endpoint.

## Convenciones de código

- Todo el código en `src/`, un archivo por integración externa (`resend.client.js`, `whatsapp.client.js`) más `server.js` con las rutas.
- Sin frameworks de validación — la validación de `POST /api/contact` es manual e intencionalmente mínima (ver `server.js`).
- Español en mensajes de error orientados al usuario final; inglés en nombres de variables/funciones.
- No agregar dependencias ni capas (router separado, controllers, etc.) mientras el servicio siga siendo un solo endpoint — YAGNI.

## Proceso de trabajo

- Antes de cambiar el contrato de `POST /api/contact`, revisar `README.md` — el frontend depende del shape exacto de la respuesta (`results`/`errors`, códigos 200/207/400).
- Actualizar `docs/PROGRESS.md` al cerrar una tarea del roadmap.
