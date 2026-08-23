# PROGRESS.md

## Estado actual

Servicio funcional y en producción. Un solo endpoint (`POST /api/contact`), dos canales de notificación (email vía Resend, WhatsApp vía Meta Cloud API), sin persistencia. Deploy vía `nolost/deploy.ps1` a `nolost-contact.service` (systemd) detrás de nginx.

## Próximo paso recomendado

Ninguno pendiente — el servicio cubre su alcance actual. Revisar `docs/ROADMAP.md` si surge una necesidad concreta (rate limiting, reintentos, logging) antes de agregar trabajo especulativo.
