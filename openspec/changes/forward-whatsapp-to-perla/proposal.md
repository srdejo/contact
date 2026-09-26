# Proposal

## Why

PERLA (`../perla-ai`, change `add-whatsapp-profile-channel`) va a atender el número de WhatsApp dedicado, y para eso necesita que `contact` le reenvíe lo que llega por Baileys y le deje responder a un chat por su JID. El contrato ya está fijado del lado de PERLA en `design.md`, **D1. Contrato entre `contact` y PERLA**, y es la fuente de verdad de este change. Hoy `contact` descarta los `fromMe` y solo escribe el `remoteJid` de los entrantes en el log, así que PERLA no puede ni recibir mensajes ni distinguir el eco de sus propias respuestas de lo que Daniel escribe desde el teléfono.

## What Changes

- `POST /api/whatsapp/send` acepta `{ jid, text }` además de `{ phone, text }`. Si llega `jid`, se usa tal cual y tiene prioridad sobre `phone`. La respuesta no cambia: `200 { status, messageId }`, `400` o `502`.
  - Cambia el texto del `400` (`phone y text son requeridos` → `text y phone o jid son requeridos`). El código sigue siendo `400`.
- Todo envío (desde `/api/whatsapp/send` y desde `/api/contact`) genera el ID del mensaje **antes** de llamar a Baileys, lo registra como "enviado por la API" durante al menos 10 minutos y se lo pasa a `sendMessage`. Así el eco se reconoce aunque el `messages.upsert` llegue antes de que el envío resuelva.
- `messages.upsert` (solo `type: "notify"`) reenvía a PERLA por `POST PERLA_EVENTS_URL` con la cabecera `X-Perla-Channel-Secret`:
  - lo que no es `fromMe`, como `INBOUND`;
  - los `fromMe` cuyo ID no está en el registro, como `OWNER`;
  - con `kind` `TEXT` o `UNSUPPORTED` (imagen, audio, documento, sticker, ubicación y cualquier otro contenido que no sea texto).
- Se ignoran sin reenviar: grupos, `status@broadcast` y demás difusiones, newsletters, llamadas, reacciones, `protocolMessage` (ediciones y borrados), mensajes sin contenido y todo chat cuyo interlocutor sea `WHATSAPP_TO_NUMBER`.
- El `jid` reenviado prefiere el de teléfono (`remoteJidAlt` / `senderPn`) sobre el `@lid`.
- Reintentos según la tabla de D1: `5xx` o sin respuesta → reintenta a 1 s, 5 s y 30 s, luego log y descarte. `400`, `401` y `503` → sin reintento, con log. Se agrega el `404` (PERLA sin el canal desplegado) con el mismo trato que el `503`: este último punto es comportamiento interno de `contact` y no cambia el contrato.
- Variables nuevas: `PERLA_EVENTS_URL` (vacía o ausente = reenvío apagado) y `PERLA_CHANNEL_SECRET` (mismo valor que `WHATSAPP_CHANNEL_SECRET` en PERLA). Se documentan en `.env.example`.
- Documentación: el README, `docs/ARCHITECTURE.md` y `docs/PROGRESS.md` describen `src/controllers/whatsapp.controller.js` como código muerto. **No lo es**: `server.js` lo importa y lo usa desde 2026-09-07, y tiene 5 pruebas. No se borra; se corrigen los documentos.
- Sin rutas nuevas: el reenvío es una llamada **saliente** de `contact` a PERLA por loopback. Nada nuevo pasa por nginx y el servicio sigue escuchando solo en `127.0.0.1`. Sin dependencias nuevas (`fetch` nativo de Node; utilidades de JID de la propia Baileys).
- `POST /api/contact` no cambia su contrato.

## Capabilities

### New Capabilities
- `whatsapp-send`: envío de WhatsApp por la API interna (`POST /api/whatsapp/send`), destino por `phone` o `jid`, y registro de los IDs enviados por la API para reconocer su eco.
- `whatsapp-forwarding`: reenvío a PERLA de los mensajes recibidos por Baileys (qué se reenvía, qué se ignora, forma del evento, autenticación con secreto, reintentos y apagado por configuración).

### Modified Capabilities
<!-- Ninguna: openspec/specs/ está vacío en este repo. -->

## Impact

- **Código:** `src/clients/whatsapp.client.js` (ID propio, registro, clasificación del upsert, inyección del socket para las pruebas), `src/controllers/whatsapp.controller.js` (`jid`), `src/server.js` (composición del reenvío), nuevo `src/clients/perla.client.js` (POST y reintentos), nuevas pruebas en `test/`.
- **API:** `POST /api/whatsapp/send` gana `jid` (retrocompatible). Ninguna ruta nueva.
- **Configuración:** `PERLA_EVENTS_URL`, `PERLA_CHANNEL_SECRET` en `.env.example`, en el `.env` local y en el del VPS.
- **Sistemas:** PERLA (`:8084`, `/internal/whatsapp/events`). Sin la URL configurada, `contact` se comporta como hoy para `nolost`, `hotel-backend`, `consulting` y `micasachurch`.
- **Docs:** README, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/PROGRESS.md`, `docs/DEPLOYMENT.md` (variables nuevas).
