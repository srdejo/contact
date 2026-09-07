# ROADMAP.md

`contact-api` es el servicio de notificaciones del workspace: recibe el formulario
público de contacto y expone un envío de correo genérico para los demás proyectos
del mismo servidor. Es pequeño y ya corre en producción, así que este roadmap se
escribió **hacia atrás** (2026-09-07): registra las etapas que el servicio ya
recorrió — con la evidencia que las respalda en [`PROGRESS.md`](PROGRESS.md) — y lo
que falta para cerrar la migración a Baileys.

Convención (la misma del resto de los repos): un `[x]` se marca **sólo cuando la
tarea fue verificada**, no cuando el código existe. Cada línea dice con qué se
verificó y cuándo. Las secciones de "mejoras futuras" son backlog declarado y no
cuentan para el porcentaje.

## Etapa 1 — Formulario público de contacto ✅

**Criterio de cierre**: `POST /api/contact` acepta el formulario, notifica por los
dos canales y responde con el contrato que consumen los frontends
(`200` / `207` con `results` y `errors`, `400` si falta un campo).

- [x] `POST /api/contact` con validación de `name`, `email` y `message` — verificado
      contra el servicio corriendo (`400` con el mensaje esperado ante cuerpo vacío).
- [x] Canal de email vía Resend (`src/clients/resend.client.js`).
- [x] Canal de WhatsApp vía Meta Cloud API — sustituido en la Etapa 3.
- [x] Un canal caído no tumba al otro: respuesta `207` con `errors` por canal —
      verificado 2026-09-05 y de nuevo 2026-09-07 con los dos canales sin credenciales.
- [x] Servicio desplegado en el VPS detrás de nginx.

## Etapa 2 — `POST /api/send`: correo interno para los demás proyectos ✅

**Criterio de cierre**: los otros servicios del servidor pueden mandar correo por
loopback y ese endpoint **no** es alcanzable desde internet.

- [x] `POST /api/send` (`{to, subject, html}`) restringido a loopback — agregado
      2026-08-24 a pedido de `hotel` (invitaciones de equipo).
- [x] Corte en nginx (`location = /contact/api/send { return 404; }`) en el archivo
      que realmente sirve el tráfico HTTPS — corregido 2026-08-27 (estaba en un vhost
      que nunca se ejecuta) y verificado 2026-09-02 desde fuera del VPS con tres
      peticiones que se controlan entre sí. Ver `PROGRESS.md`.
- [x] Cambio de proveedor a Gmail SMTP (`src/clients/gmail.client.js`), porque el
      remitente sandbox de Resend no era presentable y verificar un dominio exige
      acceso al DNS — decidido 2026-08-27, ver `DECISIONS.md`.
- [x] Credenciales de Gmail cargadas en el `.env` del VPS y envío real confirmado
      por el usuario — 2026-09-02.
- [x] Segundo consumidor en producción: el módulo `contact` de `consulting`
      (`ContactApiDiagnosticoNotifier`), además de `hotel-backend`.
- [x] `fromName` opcional en `POST /api/send`, para que cada servicio firme con su
      propio nombre — 2026-09-07. Antes todos los correos salían con el `GMAIL_FROM`
      del `.env` ("Leo Pura Distribución"), así que una invitación de Mi Casa Church
      llegaba firmada por otro proyecto. La dirección se sigue resolviendo aquí, que es
      el único que conoce la cuenta que envía; el llamador sólo declara quién es.
      Verificado con 6 pruebas sobre `resolveFrom` (incluida la de inyección de
      cabeceras por saltos de línea) y con el endpoint corriendo.

## Etapa 3 — WhatsApp por Baileys y cierre del servicio 🟡

**Criterio de cierre**: el servicio corre en el VPS con la sesión de WhatsApp
vinculada, sin proxy público hacia él, y `POST /api/contact` vuelve a notificar por
los dos canales. **Nada de esta etapa está desplegado**: producción sigue con la
versión de Meta Cloud API.

- [x] Cliente Baileys con sesión persistente en `data/whatsapp/auth/`, reconexión
      automática y QR por consola (`src/clients/whatsapp.client.js`).
- [x] `GET /api/whatsapp/status` y `POST /api/whatsapp/send` — verificados contra el
      servicio corriendo (`200`, `400` sin campos, `502` con WhatsApp desconectado).
- [x] Regresión corregida: al mover los clientes a `src/clients/` se había perdido
      `POST /api/contact` — restaurado 2026-09-05 con el mismo contrato.
- [x] Fallo silencioso de Resend corregido: el SDK no lanza, devuelve
      `{ data, error }`; la traducción a excepción quedó en el cliente (2026-09-07),
      así que ningún llamador futuro puede volver a responder `200` fingiendo éxito.
- [x] El servicio pasa a ser interno: bind a `127.0.0.1`, `requireLocalhost` en todas
      las rutas salvo `/health`, y `location /contact/ { return 404; }` en
      `infra/nginx/edge.conf` — hecho y verificado en local 2026-09-05.
- [x] Deploy documentado: `contact` como opción 9 del menú de `infra/deploy.ps1`,
      `-Action ContactLogs` para ver el QR, y `docs/DEPLOYMENT.md` con la guía
      completa — 2026-09-05.
- [x] Código muerto resuelto: los controladores de `src/controllers/` estaban
      escritos pero nunca importados, y `server.js` repetía la misma lógica en línea.
      Ahora `server.js` es sólo composición y tabla de rutas; cada endpoint tiene una
      única implementación, en su controlador. Verificado 2026-09-07 con `npm test`
      (14 pruebas sobre los tres controladores) y con las ocho peticiones de contrato
      contra el servicio corriendo.
- [ ] Quitar el `location /contact/` del nginx del VPS y dejarlo en `return 404`
      (en local ya está hecho; falta el servidor). Ver `DEPLOYMENT.md`.
- [ ] Llenar `WHATSAPP_TO_NUMBER` en el `.env` local y en el del VPS: hoy está vacío,
      así que el canal de WhatsApp de `/api/contact` falla por número inválido.
- [ ] Escanear el QR en el VPS después del primer deploy (`-Action ContactLogs`).

## Etapa 4 — Por qué Baileys en vez de Meta Cloud API

El cambio de proveedor de WhatsApp se hizo sin registrar la motivación. Importa
porque Baileys es una integración no oficial y con estado: si el motivo era evitar
el trámite de Meta (verificación de negocio, plantillas aprobadas), la decisión se
sostiene; si era otra cosa, conviene reevaluarla antes de depender de esto en
producción. Sin esa respuesta no hay criterio con el cual dar la etapa por cerrada.

- [ ] Registrar el motivo en `DECISIONS.md` y confirmar (o revertir) la decisión.

## Posibles mejoras futuras (no priorizadas)

- [ ] Rate limiting en `POST /api/contact` para evitar abuso del formulario público.
- [ ] Cola de reintentos si el volumen de fallos de un canal se vuelve frecuente.
- [ ] Logging estructurado si el servicio empieza a atender más de un frontend/tenant.

Ninguna de estas está agendada. Agregar aquí cuando surja una necesidad real, no de
forma especulativa.
