# PROGRESS.md

## Estado actual

Servicio funcional y en producción. Endpoint público `POST /api/contact` (dos canales de notificación: email vía Resend, WhatsApp vía Meta Cloud API), sin persistencia. Desde 2026-08-24, además expone `POST /api/send` — envío de email genérico (`{to, subject, html}`) restringido a peticiones desde localhost, pensado para que otros servicios del mismo servidor (ej. `hotel-backend`, invitaciones de equipo) lo usen como cliente HTTP simple sin exponerlo a internet.

**Nota (2026-08-24)**: `/api/send` se agregó a pedido de `hotel` (proyecto en `../hotel/`), que lo necesita para enviar correos de invitación de equipo (link para crear contraseña). Protegido en dos capas: middleware `requireLocalhost` en `server.js` (chequea `req.socket.remoteAddress`) + `location = /contact/api/send { return 404; }` en el nginx que expone el servicio públicamente.

**Resuelto (2026-08-27, desde una sesión de `consulting`)**: el corte de nginx en producción **no estaba realmente activo** — solo existía en `/etc/nginx/sites-available/micasachurch.co`, archivo que en el VPS nunca se ejecuta (sirve puerto 80, siempre redirige a HTTPS antes de llegar a esa location). El tráfico HTTPS real de `micasachurch.co` lo sirve `/etc/nginx/sites-available/nolost` (`listen 443 ssl`), que no tenía el bloque — `/api/send` quedaba protegido solo por un efecto colateral accidental de la reescritura de `/contact/` en ese archivo (`proxy_pass .../api/contact` sin barra final concatena mal la ruta y termina en 404), no por diseño. Se agregó el mismo `location = /contact/api/send { return 404; }` al archivo real (`nolost`), verificado con `nginx -t` + reload: `https://micasachurch.co/contact/api/send` → 404 (ahora por diseño), sitio y `/contact/health` sin romperse. `consulting` es ahora el segundo consumidor de `/api/send` (además de `hotel-backend`), vía su propio módulo `contact` interno (`ContactApiDiagnosticoNotifier`).

**`/api/send` cambió de proveedor (2026-08-27, desde una sesión de `consulting`)**: al probar el envío real del módulo de `consulting`, el correo llegó desde `Acme <onboarding@resend.dev>` (remitente sandbox de Resend, poco profesional y sin dominio verificado). Verificar un dominio en Resend requiere acceso a su DNS (no automatizable — la `RESEND_API_KEY` del servicio está restringida solo a envío, no a gestión de dominios vía API) y el usuario prefirió no bloquearse en eso. Se agregó `src/gmail.client.js` (`nodemailer`, transporte `gmail`) y `/api/send` ahora envía por ahí en vez de por `resend.client.js` — `/api/contact` (Resend, Mi Casa Church) no cambió. Ver `docs/DECISIONS.md`. Afecta a los dos consumidores actuales de `/api/send`: `hotel-backend` y `consulting`.

## En curso (2026-09-05): WhatsApp por Baileys — **no desplegado**

Se reemplazó el canal de WhatsApp: de la Meta Cloud API a `@whiskeysockets/baileys` (WhatsApp Web multi-dispositivo). Nuevo `src/clients/whatsapp.client.js`, nuevas rutas `GET /api/whatsapp/status` y `POST /api/whatsapp/send`, sesión persistente en `data/whatsapp/auth/`. Ver `docs/DECISIONS.md` para las consecuencias operativas.

**Lo que hay en producción hoy sigue siendo la versión Meta Cloud API** (último commit). Nada de esto está desplegado.

Regresión encontrada y corregida el 2026-09-05: al mover los clientes a `src/clients/` se había perdido `POST /api/contact` del `server.js` — desplegar así habría dejado el formulario público de Mi Casa Church en 404. Restaurado con el mismo contrato (`200`/`207`/`400`, `results`/`errors`), ahora con Baileys como canal de WhatsApp. De paso se corrigió un fallo silencioso: el SDK de Resend no lanza excepción, devuelve `{ data, error }`, así que un fallo de email nunca llegaba a `errors` y el endpoint respondía `200` fingiendo éxito.

Verificado en local contra el servidor corriendo: `/health` → 200; `/api/contact` sin campos → 400 con el mensaje esperado; `/api/contact` completo con ambos canales caídos → 207 con `errors.email` y `errors.whatsapp` poblados; `/api/whatsapp/status` → 200.

**Resuelto en la misma sesión (2026-09-05): el servicio pasa a ser interno.** `POST /api/whatsapp/send` no tenía ningún control y el proxy lo habría expuesto públicamente (`/contact/api/whatsapp/send`): cualquiera con la URL podría haber enviado WhatsApps desde la cuenta vinculada. Se verificó que ningún proyecto del workspace llama ya a `/api/contact` (el consumidor público murió con la migración de dominio del 2026-08-31), así que se cerró entero: bind a `127.0.0.1`, `requireLocalhost` en todas las rutas menos `/health`, y `location /contact/ { return 404; }` en `infra/nginx/edge.conf`. Ver `docs/DECISIONS.md`.

**Deploy documentado (2026-09-05):** la config sí existía, pero fuera del repo — `infra/deploy.ps1` ya tenía `-Action Contact` y `-Action SetupContact`, pero no aparecía en el menú interactivo. Se agregó `contact` como opción 9 del menú (`Kind = "contact"`, sin renumerar las 1-8) y se actualizó (limpia `src/` remoto antes de subir, crea y preserva `data/whatsapp/auth/`, `npm ci`, verificación post-restart, nuevo `-Action ContactLogs` para ver el QR) y se escribió `docs/DEPLOYMENT.md` con la guía de instalación completa.

**Falta para poder desplegar:**
1. Quitar el `location /contact/` del nginx del VPS (`/etc/nginx/sites-available/nolost`) y dejar `return 404`. En local ya está hecho. Ver `docs/DEPLOYMENT.md`.
2. Llenar `WHATSAPP_TO_NUMBER` en el `.env` (local y VPS): hoy está vacío en local, así que el canal de WhatsApp de `/api/contact` falla por número inválido.
3. Escanear el QR en el VPS después del primer deploy (`-Action ContactLogs`).
4. Resolver el código muerto de `src/controllers/whatsapp.controller.js` (cablearlo o borrarlo).

## Próximo paso recomendado

1. **Resuelto (2026-09-02)**: credenciales de Gmail cargadas en el `.env` del VPS, `contact` envía correo por Gmail en producción. El usuario confirma que `/api/send` funciona por loopback y que el acceso público (`/api/contact`) también responde correctamente.
2. **Verificado (2026-09-02)**: el corte de nginx sobrevivió la migración de dominio del 2026-08-31. Comprobado desde fuera del VPS contra el vhost nuevo (`nolost.micasachurch.co`), con tres peticiones que se controlan entre sí:
   - `POST /contact/api/send` -> **404 servido por nginx** (cuerpo = página de error de nginx). El corte está activo y la petición nunca llega a Node.
   - `POST /contact/health` -> 404 servido por **Express** (`Cannot POST /health`). Prueba que el proxy sí reenvía a Node en las demás rutas, es decir que el 404 anterior es el bloque `location`, no una caída del proxy.
   - `POST /contact/api/contact` -> 400 con `{"error":"name, email y message son requeridos"}`. El endpoint público responde correctamente.
   Además, el dominio viejo (`micasachurch.co/contact/...`) ya no proxya a este servicio en absoluto: nginx responde 405 en todas esas rutas porque ahora sirve estáticos del proyecto `micasachurch`. No quedó ruta huérfana.
3. Fuera de eso, ninguno pendiente. Revisar `docs/ROADMAP.md` si surge una necesidad concreta (rate limiting, reintentos, logging) antes de agregar trabajo especulativo.

## Bloqueos o problemas conocidos

_Convención: prefijar cada bloqueo con `[definición]` (el roadmap no da criterio de aceptación claro) o `[externo]` (credenciales, infraestructura, dependencia de otro equipo) para distinguir el origen._

- ~~`[externo]` `GMAIL_USER`/`GMAIL_APP_PASSWORD` no cargados en producción~~ — **resuelto 2026-09-02**, ver "Próximo paso recomendado".
- ~~`[externo]` Sin verificar: el corte de nginx para `/contact/api/send`~~ — **verificado 2026-09-02**, sigue activo tras la migración. Ver punto 2 de "Próximo paso recomendado".
- `[definición]` **Por qué se cambió de Meta Cloud API a Baileys.** El cambio se hizo sin registrar la motivación. Importa porque Baileys es una integración no oficial y con estado: si el motivo era evitar el trámite de Meta (verificación de negocio, plantillas aprobadas), la decisión se sostiene; si era otra cosa, conviene reevaluarla antes de depender de esto en producción. Preguntado al usuario, pendiente de respuesta — `docs/DECISIONS.md` lo tiene marcado como pendiente.
- ~~`[definición]` Cómo se protege `POST /api/whatsapp/send`~~ — **resuelto 2026-09-05**: el servicio entero pasó a ser interno (loopback + sin proxy). Ver `docs/DECISIONS.md`.
