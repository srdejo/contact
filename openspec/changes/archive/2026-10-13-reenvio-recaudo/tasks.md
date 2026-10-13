# Tasks

## 1. Reenvío a recaudo

- [x] 1.1 `createWhatsAppClient` entrega `onMessage(event, message)` y expone `downloadImage(message)` con `downloadMediaMessage` de Baileys (logger y resubida del socket actual). Verificar con `test/whatsapp.client.test.js`: el mensaje crudo llega a `onMessage`; la descarga recibe el socket actual; sin conexión, falla.
- [x] 1.2 `src/clients/recaudo.events.js` con `toRecaudoMessage(event, message)`: solo `INBOUND` con JID de teléfono, sin contenedores de álbum, `IMAGE` con tipo, leyenda y tamaño. Verificar con `test/recaudo.events.test.js`: un caso por escenario de "Qué se reenvía a recaudo y con qué forma".
- [x] 1.3 `src/clients/recaudo.client.js`: cola por chat, descarga dentro de la cola, límite de 10 MB, `UNSUPPORTED` si no se puede, reintentos y log sin secretos ni contenido. Verificar con `test/recaudo.client.test.js`: cuerpo del contrato D2, texto sin descarga, foto grande sin descargar, descarga fallida, `500` y luego `202` con una sola descarga, 4 intentos y descarte, `400`/`401` sin reintento y el orden de dos fotos del mismo chat.
- [x] 1.4 Componer en `src/server.js` con `RECAUDO_EVENTS_URL` y `RECAUDO_CHANNEL_SECRET` (aviso si falta el secreto). Verificar: con las dos variables vacías, `npm test` pasa sin cambios en las pruebas de PERLA.

## 2. Documentación y despliegue

- [x] 2.1 `.env.example`, README ("Reenvío a recaudo"), `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (el número deja de ser solo de PERLA) y `docs/DEPLOYMENT.md` (encendido y rollback).
- [x] 2.2 *(Hecho el 2026-10-13. La sesión estaba cerrada desde el 12/10 y se volvió a vincular con QR. La foto de Daniel, que también es vendedor, llegó a recaudo y se aceptó; después se probaron un duplicado y un lote. Salieron y se corrigieron dos cosas, ya recogidas en la spec: el `@lid` sin número se resuelve con la relación de Baileys, y `WHATSAPP_TO_NUMBER` solo se ignora para PERLA.)* En el VPS, con recaudo desplegado: `PERLA_EVENTS_URL` vacía, `RECAUDO_EVENTS_URL` y `RECAUDO_CHANNEL_SECRET`, reinicio de `nolost-contact`. Verificar con la foto de un recibo desde el teléfono de un vendedor registrado.
