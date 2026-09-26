# whatsapp-send Specification

## Purpose

Envío de mensajes de WhatsApp desde los servicios internos del mismo host a través de `POST /api/whatsapp/send`, a un número o a un chat identificado por su JID, dejando registrado cada mensaje enviado por la API para que su eco no se confunda con lo que Daniel escribe desde el teléfono.

## Requirements

### Requirement: Envío por número o por JID
`POST /api/whatsapp/send` SHALL aceptar un cuerpo con `text` y un destino, que puede ser:
- `phone`: dígitos con indicativo (se ignora cualquier otro carácter), que se envía al chat de persona de ese número.
- `jid`: el identificador de chat de WhatsApp, que se usa **tal cual**, sin normalizarlo (por ejemplo `573001234567@s.whatsapp.net` o `123456789@lid`).

Si llegan los dos, SHALL usarse `jid`.

El sistema SHALL responder:
- `200 { "status": "ok", "messageId": "<id>" }` cuando WhatsApp acepta el envío.
- `400 { "error": "text y phone o jid son requeridos" }` cuando falta `text` o faltan los dos destinos.
- `502 { "error": "<motivo>" }` cuando WhatsApp no está conectado o el envío falla.

La ruta SHALL seguir rechazando con `403` toda petición que no llegue por loopback.

#### Scenario: Respuesta de PERLA a un chat por JID
- **WHEN** un servicio local envía `{ "jid": "573001234567@s.whatsapp.net", "text": "Hola" }` con WhatsApp conectado
- **THEN** el mensaje sale a ese chat y la respuesta es `200` con `status` `ok` y el `messageId` del mensaje

#### Scenario: JID de tipo @lid
- **WHEN** un servicio local envía `{ "jid": "123456789012345@lid", "text": "Hola" }`
- **THEN** el mensaje sale a exactamente ese JID, sin convertirlo a número

#### Scenario: Envío por número, contrato anterior
- **WHEN** un servicio local envía `{ "phone": "+57 300 999 8877", "text": "Aviso" }`
- **THEN** el mensaje sale a `573009998877@s.whatsapp.net` y la respuesta es `200` con el `messageId`

#### Scenario: JID y número a la vez
- **WHEN** llega `{ "jid": "573001234567@s.whatsapp.net", "phone": "573009998877", "text": "Hola" }`
- **THEN** el mensaje sale al JID y no al número

#### Scenario: Sin destino
- **WHEN** llega `{ "text": "Hola" }`
- **THEN** la respuesta es `400` con el error `text y phone o jid son requeridos` y no se envía nada

#### Scenario: WhatsApp desconectado
- **WHEN** llega un envío válido y WhatsApp no está conectado
- **THEN** la respuesta es `502` con `WhatsApp no está conectado`

### Requirement: Registro de los mensajes enviados por la API
Todo mensaje que `contact` envía (por `POST /api/whatsapp/send` o como notificación de `POST /api/contact`) SHALL tener su identificador fijado por `contact` **antes** de entregarlo a WhatsApp, y ese identificador SHALL quedar registrado como "enviado por la API" antes del envío y durante al menos 10 minutos. El `messageId` de la respuesta SHALL ser ese mismo identificador.

El registro SHALL reconocer el eco de un envío aunque WhatsApp lo notifique antes de que el envío termine.

El registro vive en memoria: un reinicio de `contact` lo vacía.

#### Scenario: El eco llega antes de que el envío resuelva
- **WHEN** `contact` envía un mensaje y WhatsApp notifica su eco (`fromMe`) antes de confirmar el envío
- **THEN** el eco se reconoce como enviado por la API y no se reenvía a PERLA como `OWNER`

#### Scenario: El messageId de la respuesta coincide con el del eco
- **WHEN** `POST /api/whatsapp/send` responde `200` con `messageId` `X`
- **THEN** el eco de ese mensaje en WhatsApp trae el identificador `X`

#### Scenario: El registro dura al menos 10 minutos
- **WHEN** el eco de un mensaje enviado por la API llega 9 minutos después del envío
- **THEN** se sigue reconociendo como enviado por la API

#### Scenario: Envío fallido
- **WHEN** el envío falla después de registrar el identificador
- **THEN** la respuesta es `502` y el identificador puede quedar registrado hasta que venza, sin efecto visible
