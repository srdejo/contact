# PROGRESS.md

## Estado actual

Servicio funcional y en producción. Endpoint público `POST /api/contact` (dos canales de notificación: email vía Resend, WhatsApp vía Meta Cloud API), sin persistencia. Desde 2026-08-24, además expone `POST /api/send` — envío de email genérico (`{to, subject, html}`) restringido a peticiones desde localhost, pensado para que otros servicios del mismo servidor (ej. `hotel-backend`, invitaciones de equipo) lo usen como cliente HTTP simple sin exponerlo a internet.

**Nota (2026-08-24)**: `/api/send` se agregó a pedido de `hotel` (proyecto en `../hotel/`), que lo necesita para enviar correos de invitación de equipo (link para crear contraseña). Protegido en dos capas: middleware `requireLocalhost` en `server.js` (chequea `req.socket.remoteAddress`) + `location = /contact/api/send { return 404; }` en el nginx que expone el servicio públicamente (agregado en `infra/nginx/edge.conf` para el entorno local; **pendiente replicar el mismo corte en el nginx de producción del VPS antes de que `hotel-backend` dependa de este endpoint contra `https://` real** — sin ese corte, nginx reenviaría como `127.0.0.1` y el chequeo de loopback quedaría inútil).

## Próximo paso recomendado

1. Antes de que `hotel-backend` use `/api/send` en producción: confirmar/replicar en el nginx del VPS el mismo bloque que corta `/contact/api/send` del proxy público (ver nota arriba) — sin esto el endpoint queda accesible desde internet a pesar del chequeo de loopback.
2. Fuera de eso, ninguno pendiente. Revisar `docs/ROADMAP.md` si surge una necesidad concreta (rate limiting, reintentos, logging) antes de agregar trabajo especulativo.

## Bloqueos o problemas conocidos

_Convención: prefijar cada bloqueo con `[definición]` (el roadmap no da criterio de aceptación claro) o `[externo]` (credenciales, infraestructura, dependencia de otro equipo) para distinguir el origen._

Ninguno registrado en esta revisión.
