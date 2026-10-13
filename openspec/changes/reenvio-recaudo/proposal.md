# Proposal

## Why

recaudo (`../recaudo`, change `recaudo-recibos-whatsapp`) recibe por WhatsApp las fotos de los recibos de consignación de los vendedores, las lee y registra los pagos. Daniel decidió (2026-10-11) que esas fotos lleguen a la **sesión actual** de Baileys, la que hoy atiende a PERLA. Mientras recaudo use el número, PERLA queda sin reenvío, y si se reactiva se le configura otro número. El contrato está fijado del lado de recaudo en su `design.md`, **D2. Contrato con `contact`**, y es la fuente de verdad de este change.

Hoy `contact` reenvía solo a PERLA, y una imagen le llega como `UNSUPPORTED`, sin descargar. recaudo necesita la foto.

## What Changes

- Reenvío a recaudo, encendido solo si `RECAUDO_EVENTS_URL` tiene valor: `POST RECAUDO_EVENTS_URL` con la cabecera `X-Recaudo-Channel-Secret` y el cuerpo `{ messageId, jid, phone, receivedAt, kind, text, image? }`.
  - `kind` es `IMAGE` (con `image: { mimeType, base64 }` y la leyenda en `text`), `TEXT` o `UNSUPPORTED`.
  - `contact` descarga la foto con `downloadMediaMessage` de Baileys, dentro de la cola del chat.
  - Una foto de más de 10 MB, o que no se pudo descargar, va como `UNSUPPORTED`.
- Qué va a recaudo: lo mismo que `toPerlaEvent` deja pasar, pero solo los `INBOUND` de un chat con número de teléfono. No van los `OWNER`, los `@lid` sin número ni el contenedor de un álbum (sus fotos llegan una por mensaje).
- Reintentos: los de PERLA (1 s, 5 s, 30 s; `5xx` o sin respuesta en 10 s), con orden por chat. `400` y `401` no se reintentan.
- `createWhatsAppClient` entrega a `onMessage` también el mensaje de Baileys y expone `downloadImage(message)`.
- Variables nuevas: `RECAUDO_EVENTS_URL` (vacía o ausente = apagado) y `RECAUDO_CHANNEL_SECRET` (el mismo valor que en el `.env` de recaudo). Se documentan en `.env.example`.
- Documentación: README, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (el número deja de ser solo de PERLA) y `docs/DEPLOYMENT.md` (orden de encendido y rollback).
- Sin rutas nuevas ni dependencias nuevas. El reenvío a PERLA no cambia.

## Capabilities

### Modified Capabilities

- `whatsapp-forwarding`: se agrega el reenvío a recaudo, con la foto descargada.

## Impact

- `src/server.js`, `src/clients/whatsapp.client.js`, y los nuevos `src/clients/recaudo.events.js` y `src/clients/recaudo.client.js`.
- En el VPS: dos variables en `/home/srdejo/apps/contact/.env`, y `PERLA_EVENTS_URL` vacía mientras recaudo use el número.
- **Rollback:** vaciar `RECAUDO_EVENTS_URL` y reiniciar `nolost-contact`.
