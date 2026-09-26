# CLAUDE.md

Reglas de trabajo para este repo (`contact-api`, descrito en `README.md`). Léelo antes de tocar código.

## Qué es este proyecto

Microservicio Node/Express con dos funciones:
- Recibe un mensaje y lo reenvía por email (Resend / Gmail SMTP) y WhatsApp (Baileys / WhatsApp Web).
- Es el conector de WhatsApp de PERLA (`../perla-ai`): le reenvía lo que llega al número de Baileys y le deja responder por `POST /api/whatsapp/send`.

**Es un servicio interno**: escucha solo en `127.0.0.1` y lo consumen otros servicios del mismo host. Proceso y ciclo de deploy propios, separados del backend principal. Ver `docs/DEPLOYMENT.md`.

Para más detalle ver, en este orden:
1. `docs/ARCHITECTURE.md` — cómo está construido hoy.
2. `docs/DECISIONS.md` — decisiones tomadas.
3. `docs/ROADMAP.md` — qué falta, si algo.
4. `docs/PROGRESS.md` — estado actual.
5. `docs/DEPLOYMENT.md` — cómo se instala y despliega en el VPS.
6. `openspec/changes/` — changes en curso (OpenSpec, esquema `spec-driven`).

## Stack

- Node.js + Express, ES modules (`"type": "module"`).
- `resend` para el email de `/api/contact`, `nodemailer` (Gmail SMTP) para `/api/send`, `@whiskeysockets/baileys` para WhatsApp, `fetch` nativo de Node para el reenvío a PERLA.
- Pruebas con `node --test` (`npm test`), sin frameworks de pruebas ni de mocks.
- Sin base de datos y sin build step, pero **no es stateless**:
  - Baileys mantiene una sesión de WhatsApp en `data/whatsapp/auth/` y un WebSocket vivo. Solo puede correr **una instancia** con esa sesión. Ver `docs/DECISIONS.md`.
  - En memoria viven el registro de IDs enviados por la API (15 minutos) y la cola de reintentos hacia PERLA. Un reinicio los vacía.

## Convenciones de código

- Todo el código en `src/`:
  - `server.js`: solo composición y tabla de rutas. Crea los clientes, los envuelve en servicios y se los pasa a los controladores.
  - `src/controllers/`: un controlador por grupo de rutas (`contact`, `gmail`, `whatsapp`). Cada uno es una fábrica que recibe su servicio.
  - `src/clients/`: un archivo por integración externa (`resend.client.js`, `gmail.client.js`, `whatsapp.client.js`, `perla.client.js`), más `whatsapp.events.js`, la función pura que traduce un mensaje de Baileys al evento de PERLA.
  - `src/utils/`: utilidades puras (`escape-html.js`).
- Las dependencias externas se **inyectan** (fábricas `createX({ ... })`) para poder probar con dobles, sin red ni disco. Así se prueba el caso del eco de Baileys.
- Sin frameworks de validación: la validación de cada ruta es manual e intencionalmente mínima (ver el controlador de cada ruta).
- Español en mensajes de error orientados al usuario final y en los logs; inglés en nombres de variables/funciones.
- No agregar dependencias ni capas nuevas (router separado, capa de servicios, repositorios, etc.) mientras la estructura actual alcance: YAGNI.

## Proceso de trabajo

- **Contratos que otros consumen:**
  - Antes de cambiar el contrato de `POST /api/contact`, revisar `README.md`: los consumidores dependen del shape exacto de la respuesta (`results`/`errors`, códigos 200/207/400).
  - El contrato con PERLA (el evento reenviado y `POST /api/whatsapp/send`) lo define el **D1** del change `add-whatsapp-profile-channel` en `../perla-ai`, y esa es la fuente de verdad. No se cambia desde aquí; si algo no cierra, se anota como pregunta para ese repo.
- **Ninguna ruta nueva se expone por nginx.** Este servicio es interno por diseño (ver `docs/DECISIONS.md`, 2026-09-05); toda ruta nueva lleva `requireLocalhost`. Si alguna vez hace falta acceso público, va a través de un backend del workspace, no reabriendo este servicio.
- **El número de Baileys es solo de PERLA** (`docs/DECISIONS.md`, 2026-09-25): todo el que le escribe llega a PERLA y el bot le contesta. Un servicio que quiera escribirle a terceros necesita otro número.
- **No arrancar el servicio con la sesión real de `data/whatsapp/auth/`** para probar algo: si la misma sesión corre en el VPS, se desplazan mutuamente. Para verificar el arranque, usar una copia sin esa carpeta; para la lógica de WhatsApp, un doble del socket.
- Actualizar `docs/PROGRESS.md` al cerrar una tarea del roadmap.
- Si un ítem del roadmap no tiene criterio de aceptación claro, no lo ejecutes a ciegas: regístralo como bloqueo de definición en `docs/PROGRESS.md` y pregunta al usuario en vez de asumir el alcance.
