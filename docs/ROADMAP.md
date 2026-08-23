# ROADMAP.md

`contact-api` es un servicio pequeño y ya funcional en producción. No tiene fases de desarrollo pendientes — este roadmap registra mejoras futuras posibles, no un plan de construcción.

Estado: 🟢 en producción, funcionalmente completo para su alcance actual.

## Posibles mejoras futuras (no priorizadas)

- [ ] Rate limiting en `POST /api/contact` para evitar abuso del formulario público.
- [ ] Cola de reintentos si el volumen de fallos de un canal (email o WhatsApp) se vuelve frecuente (ver `docs/DECISIONS.md`).
- [ ] Logging estructurado si el servicio empieza a atender más de un frontend/tenant.

Ninguna de estas está agendada. Agregar aquí cuando surja una necesidad real, no de forma especulativa.
