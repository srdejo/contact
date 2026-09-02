# PROGRESS.md

## Estado actual

Servicio funcional y en producción. Endpoint público `POST /api/contact` (dos canales de notificación: email vía Resend, WhatsApp vía Meta Cloud API), sin persistencia. Desde 2026-08-24, además expone `POST /api/send` — envío de email genérico (`{to, subject, html}`) restringido a peticiones desde localhost, pensado para que otros servicios del mismo servidor (ej. `hotel-backend`, invitaciones de equipo) lo usen como cliente HTTP simple sin exponerlo a internet.

**Nota (2026-08-24)**: `/api/send` se agregó a pedido de `hotel` (proyecto en `../hotel/`), que lo necesita para enviar correos de invitación de equipo (link para crear contraseña). Protegido en dos capas: middleware `requireLocalhost` en `server.js` (chequea `req.socket.remoteAddress`) + `location = /contact/api/send { return 404; }` en el nginx que expone el servicio públicamente.

**Resuelto (2026-08-27, desde una sesión de `consulting`)**: el corte de nginx en producción **no estaba realmente activo** — solo existía en `/etc/nginx/sites-available/micasachurch.co`, archivo que en el VPS nunca se ejecuta (sirve puerto 80, siempre redirige a HTTPS antes de llegar a esa location). El tráfico HTTPS real de `micasachurch.co` lo sirve `/etc/nginx/sites-available/nolost` (`listen 443 ssl`), que no tenía el bloque — `/api/send` quedaba protegido solo por un efecto colateral accidental de la reescritura de `/contact/` en ese archivo (`proxy_pass .../api/contact` sin barra final concatena mal la ruta y termina en 404), no por diseño. Se agregó el mismo `location = /contact/api/send { return 404; }` al archivo real (`nolost`), verificado con `nginx -t` + reload: `https://micasachurch.co/contact/api/send` → 404 (ahora por diseño), sitio y `/contact/health` sin romperse. `consulting` es ahora el segundo consumidor de `/api/send` (además de `hotel-backend`), vía su propio módulo `contact` interno (`ContactApiDiagnosticoNotifier`).

**`/api/send` cambió de proveedor (2026-08-27, desde una sesión de `consulting`)**: al probar el envío real del módulo de `consulting`, el correo llegó desde `Acme <onboarding@resend.dev>` (remitente sandbox de Resend, poco profesional y sin dominio verificado). Verificar un dominio en Resend requiere acceso a su DNS (no automatizable — la `RESEND_API_KEY` del servicio está restringida solo a envío, no a gestión de dominios vía API) y el usuario prefirió no bloquearse en eso. Se agregó `src/gmail.client.js` (`nodemailer`, transporte `gmail`) y `/api/send` ahora envía por ahí en vez de por `resend.client.js` — `/api/contact` (Resend, Mi Casa Church) no cambió. Ver `docs/DECISIONS.md`. Afecta a los dos consumidores actuales de `/api/send`: `hotel-backend` y `consulting`.

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
- ~~`[externo]` Sin verificar: el corte de nginx para `/contact/api/send`~~ — **verificado 2026-09-02**, sigue activo tras la migración. Ver punto 2 de "Próximo paso recomendado". No quedan bloqueos abiertos en este servicio.
