# whatsapp-forwarding Specification

## Purpose

Reenvío a PERLA, por loopback y con un secreto compartido, de los mensajes que llegan al número de WhatsApp dedicado: lo que escribe el interlocutor (`INBOUND`) y lo que Daniel escribe desde el teléfono (`OWNER`), según el contrato D1 de `perla-ai` (`add-whatsapp-profile-channel`).

## Requirements

### Requirement: Reenvío apagado por configuración
El reenvío SHALL estar encendido solo si `PERLA_EVENTS_URL` tiene valor. Con la variable vacía o ausente, `contact` SHALL no hacer ninguna petición a PERLA y SHALL seguir sirviendo todas sus rutas como antes.

Con el reenvío encendido, cada evento SHALL enviarse como `POST <PERLA_EVENTS_URL>` con `Content-Type: application/json` y la cabecera `X-Perla-Channel-Secret` con el valor de `PERLA_CHANNEL_SECRET`.

#### Scenario: URL vacía
- **WHEN** `contact` arranca sin `PERLA_EVENTS_URL` y llega un mensaje de texto de un interlocutor
- **THEN** no se hace ninguna petición a PERLA, y `POST /api/contact` y `POST /api/whatsapp/send` responden igual que antes

#### Scenario: URL configurada
- **WHEN** `PERLA_EVENTS_URL` es `http://127.0.0.1:8084/internal/whatsapp/events`, `PERLA_CHANNEL_SECRET` es `s3cr3t` y llega un mensaje reenviable
- **THEN** `contact` hace `POST` a esa URL con la cabecera `X-Perla-Channel-Secret: s3cr3t` y el evento en JSON

### Requirement: Qué se reenvía y con qué dirección
Solo SHALL considerarse los mensajes que WhatsApp notifica como nuevos (`messages.upsert` de tipo `notify`); los de historial o sincronización SHALL ignorarse.
- Un mensaje que no es `fromMe` SHALL reenviarse con `direction` `INBOUND`.
- Un mensaje `fromMe` cuyo identificador **no** está registrado como enviado por la API SHALL reenviarse con `direction` `OWNER`.
- Un mensaje `fromMe` cuyo identificador **sí** está registrado SHALL ignorarse.

#### Scenario: Mensaje del interlocutor
- **WHEN** 573001234567 escribe "Hola" al número dedicado
- **THEN** PERLA recibe un evento `INBOUND` con ese texto

#### Scenario: Daniel escribe desde el teléfono
- **WHEN** Daniel escribe "Hola Ana, soy Daniel" desde el teléfono del número dedicado en el chat de 573001234567
- **THEN** PERLA recibe un evento `OWNER` con `jid` `573001234567@s.whatsapp.net` y ese texto

#### Scenario: Eco de una respuesta enviada por la API
- **WHEN** PERLA envía una respuesta por `POST /api/whatsapp/send` y WhatsApp notifica el eco como `notify`, antes o después de que el envío resuelva
- **THEN** no se reenvía nada a PERLA

#### Scenario: Mensajes de historial
- **WHEN** WhatsApp sincroniza mensajes antiguos (`messages.upsert` de tipo distinto de `notify`)
- **THEN** no se reenvía ninguno

### Requirement: Forma del evento
Cada evento reenviado SHALL tener exactamente estos campos:
- `messageId`: el identificador de WhatsApp del mensaje.
- `direction`: `INBOUND` u `OWNER`.
- `jid`: el chat del interlocutor, en los dos sentidos.
- `pushName`: el nombre de perfil del interlocutor en `INBOUND` si lo trae, si no `null`; siempre `null` en `OWNER`.
- `kind`: `TEXT` si el mensaje es texto (simple o con formato/enlace), `UNSUPPORTED` para cualquier otro contenido (imagen, audio, nota de voz, video, documento, sticker, ubicación, contacto, encuesta…).
- `text`: el texto completo, sin recortar, si `kind` es `TEXT`; `null` si es `UNSUPPORTED`.
- `timestamp`: la hora del mensaje en WhatsApp, en ISO-8601 UTC.

Los mensajes que llegan envueltos (efímeros, "ver una vez") SHALL clasificarse por su contenido interior.

#### Scenario: Texto de un interlocutor con nombre de perfil
- **WHEN** "Ana Recruiter" (573001234567) escribe "¿Qué experiencia tiene con Kafka?" con marca de tiempo 1790367303
- **THEN** el evento es `{ messageId, direction: "INBOUND", jid: "573001234567@s.whatsapp.net", pushName: "Ana Recruiter", kind: "TEXT", text: "¿Qué experiencia tiene con Kafka?", timestamp: "2026-09-25T20:15:03.000Z" }` (el formato admite milisegundos)

#### Scenario: Nota de voz
- **WHEN** un interlocutor envía una nota de voz
- **THEN** el evento tiene `kind` `UNSUPPORTED` y `text` `null`

#### Scenario: Texto con enlace
- **WHEN** un interlocutor envía un texto con vista previa de enlace
- **THEN** el evento tiene `kind` `TEXT` y el texto completo

#### Scenario: Texto largo
- **WHEN** un interlocutor envía un texto de 5000 caracteres
- **THEN** el evento lleva los 5000 caracteres; el recorte le corresponde a PERLA

#### Scenario: Mensaje efímero
- **WHEN** un interlocutor con mensajes temporales activados escribe "Hola"
- **THEN** el evento tiene `kind` `TEXT` y `text` `"Hola"`

### Requirement: JID de teléfono antes que @lid
Cuando el mensaje identifica al interlocutor con un JID `@lid` y además trae su JID de teléfono (`remoteJidAlt` o `senderPn`), el evento SHALL llevar el JID de teléfono. Si solo trae el `@lid`, el número SHALL buscarse en la relación `@lid` → número que Baileys guarda en la sesión (`lid-mapping-*`); si la conoce, el evento SHALL llevar ese JID de teléfono, y si no, SHALL llevar el `@lid`.

#### Scenario: @lid con JID de teléfono alternativo
- **WHEN** llega un mensaje con `remoteJid` `123456789012345@lid` y `remoteJidAlt` `573001234567@s.whatsapp.net`
- **THEN** el evento lleva `jid` `573001234567@s.whatsapp.net`, sin consultar la relación de Baileys

#### Scenario: Solo @lid, con el número conocido por Baileys
- **WHEN** llega un mensaje con `remoteJid` `142060388622446@lid` sin JID de teléfono alternativo, y Baileys relaciona ese `@lid` con 573127655754
- **THEN** el evento lleva `jid` `573127655754@s.whatsapp.net`

#### Scenario: Solo @lid
- **WHEN** llega un mensaje con `remoteJid` `123456789012345@lid` sin JID de teléfono alternativo, y Baileys no conoce su número
- **THEN** el evento lleva `jid` `123456789012345@lid`

### Requirement: Qué se ignora sin reenviar
SHALL ignorarse, sin hacer ninguna petición a PERLA:
- Mensajes de grupos (`@g.us`), de `status@broadcast` y de cualquier otra lista de difusión.
- Mensajes de canales (newsletters).
- Llamadas y avisos de llamada.
- Reacciones.
- Ediciones y borrados (`protocolMessage`).
- Mensajes sin contenido (avisos del sistema, claves de cifrado sueltas).
- Cualquier mensaje cuyo interlocutor sea el número de `WHATSAPP_TO_NUMBER`, en los dos sentidos.
- Los mensajes del chat del número dedicado consigo mismo ("Mensaje a mí mismo"), por su JID de teléfono o por su `@lid`.

#### Scenario: Grupo
- **WHEN** llega un mensaje de texto en un chat `@g.us`
- **THEN** no se reenvía

#### Scenario: Estado
- **WHEN** un contacto publica un estado (`status@broadcast`)
- **THEN** no se reenvía

#### Scenario: Reacción
- **WHEN** un interlocutor reacciona con un emoji a un mensaje
- **THEN** no se reenvía

#### Scenario: Edición o borrado
- **WHEN** un interlocutor edita o borra un mensaje ya enviado
- **THEN** no se reenvía

#### Scenario: Número personal de Daniel
- **WHEN** `WHATSAPP_TO_NUMBER` es `573009998877` y ese número escribe al número dedicado, o Daniel le escribe desde el teléfono del número dedicado
- **THEN** no se reenvía nada

#### Scenario: Número personal detrás de un @lid
- **WHEN** el número personal escribe con `remoteJid` `@lid` y `remoteJidAlt` `573009998877@s.whatsapp.net`
- **THEN** no se reenvía nada

#### Scenario: Mensaje a mí mismo
- **WHEN** Daniel escribe una nota en el chat "Mensaje a mí mismo" del número dedicado, ya sea que el chat llegue con el JID de teléfono del número dedicado o con su `@lid`
- **THEN** no se reenvía nada

### Requirement: Respuestas de PERLA y reintentos
`contact` SHALL tratar la respuesta de PERLA así:
- `2xx`: evento entregado; no hace nada más.
- `400`, `401`, `404` o `503`: no reintenta y lo registra en el log con el código y el `messageId`.
- Cualquier otro `5xx`, o ninguna respuesta (error de red o sin respuesta en 10 segundos): reintenta hasta 3 veces, con esperas de 1 s, 5 s y 30 s. Si el último intento falla, lo registra en el log y descarta el evento.

Los eventos de un mismo `jid` SHALL entregarse a PERLA en el orden en que llegaron a `contact`, incluso mientras uno de ellos espera un reintento. Los de `jid` distintos no se esperan entre sí.

El reenvío SHALL no bloquear ni hacer fallar la recepción de WhatsApp ni ninguna ruta de `contact`, y SHALL no registrar en el log el secreto ni el texto del mensaje.

#### Scenario: PERLA acepta
- **WHEN** PERLA responde `202 {"status":"accepted"}`
- **THEN** no hay reintento

#### Scenario: Falla transitoria
- **WHEN** PERLA responde `500` y luego `202`
- **THEN** `contact` reintenta una vez, 1 segundo después, y no hay más intentos

#### Scenario: PERLA caída
- **WHEN** PERLA no responde en ningún intento
- **THEN** `contact` intenta 4 veces en total (a los 0, 1, 6 y 36 segundos aproximadamente), registra en el log el descarte con el `messageId` y sigue funcionando

#### Scenario: Secreto incorrecto
- **WHEN** PERLA responde `401`
- **THEN** `contact` no reintenta y registra en el log el `401`

#### Scenario: PERLA sin el canal desplegado
- **WHEN** PERLA responde `404` porque la ruta todavía no existe
- **THEN** `contact` no reintenta y registra en el log el `404`

#### Scenario: Orden por chat durante un reintento
- **WHEN** el evento A de un `jid` está esperando su reintento de 5 s y llega el evento B del mismo `jid`
- **THEN** PERLA recibe B solo después de que A se entregó o se descartó

#### Scenario: Chats independientes
- **WHEN** el evento A del chat X está esperando un reintento y llega el evento B del chat Y
- **THEN** B se envía sin esperar a A

### Requirement: Reenvío a recaudo apagado por configuración
El reenvío a recaudo SHALL estar encendido solo si `RECAUDO_EVENTS_URL` tiene valor. Con la variable vacía o ausente, `contact` SHALL no hacer ninguna petición a recaudo y SHALL comportarse como antes.

Con el reenvío encendido, cada mensaje SHALL enviarse como `POST <RECAUDO_EVENTS_URL>` con `Content-Type: application/json` y la cabecera `X-Recaudo-Channel-Secret` con el valor de `RECAUDO_CHANNEL_SECRET`, según el contrato D2 de recaudo.

#### Scenario: URL vacía
- **WHEN** `contact` arranca sin `RECAUDO_EVENTS_URL` y llega la foto de un vendedor
- **THEN** no se hace ninguna petición a recaudo ni se descarga la foto

#### Scenario: URL configurada
- **WHEN** `RECAUDO_EVENTS_URL` es `http://127.0.0.1:8095/internal/whatsapp/mensajes`, `RECAUDO_CHANNEL_SECRET` es `s3cr3t` y 573007046858 manda una foto
- **THEN** `contact` hace `POST` a esa URL con la cabecera `X-Recaudo-Channel-Secret: s3cr3t`

### Requirement: Qué se reenvía a recaudo y con qué forma
A recaudo SHALL ir solo lo que el reenvío a PERLA dejaría pasar (los mismos filtros de "Qué se ignora sin reenviar"), salvo el número de `WHATSAPP_TO_NUMBER`, y, además, solo los mensajes `INBOUND` de un chat con número de teléfono. El número personal SHALL seguir ignorándose para PERLA, pero SHALL llegar a recaudo: Daniel también puede ser vendedor, y recaudo atiende solo a los vendedores registrados. El contenedor de un álbum SHALL no reenviarse: sus fotos llegan como mensajes separados.

El cuerpo SHALL ser `{ messageId, jid, phone, receivedAt, kind, text, image? }`:
- `phone`: los dígitos del JID de teléfono del chat;
- `receivedAt`: la marca de tiempo del mensaje, en ISO-8601 UTC;
- `kind`: `IMAGE` para una foto, `TEXT` para un texto, `UNSUPPORTED` para lo demás;
- `text`: el texto, o la leyenda de la foto, o `null`;
- `image`: solo con `IMAGE`, `{ mimeType, base64 }` con la foto descargada.

Una foto de más de 10 MB, o que no se pudo descargar, SHALL enviarse como `UNSUPPORTED` y sin `image`, para que recaudo le pida al vendedor reenviarla.

#### Scenario: Foto con leyenda
- **WHEN** 573007046858 manda una foto JPEG con la leyenda "recibo de hoy"
- **THEN** recaudo recibe `kind` `IMAGE`, `phone` `573007046858`, `text` "recibo de hoy" e `image` con `mimeType` `image/jpeg` y la foto en base64

#### Scenario: Álbum de tres fotos
- **WHEN** un vendedor manda un álbum de tres fotos
- **THEN** recaudo recibe tres mensajes `IMAGE`, uno por foto, y ninguno por el contenedor del álbum

#### Scenario: Foto demasiado grande
- **WHEN** llega una foto de 11 MB
- **THEN** recaudo recibe un mensaje `UNSUPPORTED` sin `image`, y la foto no se descarga

#### Scenario: Lo que Daniel escribe desde el teléfono
- **WHEN** Daniel escribe desde el teléfono del número a un chat
- **THEN** no se reenvía nada a recaudo

#### Scenario: Foto desde el número personal
- **WHEN** `WHATSAPP_TO_NUMBER` es 573127655754 y ese número manda una foto
- **THEN** recaudo recibe el mensaje `IMAGE` con `phone` `573127655754`, y PERLA no recibe nada

#### Scenario: Chat sin número
- **WHEN** llega una foto de un chat `@lid` sin JID de teléfono alternativo y Baileys no conoce el número de ese `@lid`
- **THEN** no se reenvía nada a recaudo

### Requirement: Respuestas de recaudo y reintentos
`contact` SHALL tratar la respuesta de recaudo así:
- `2xx`: entregado.
- Cualquier `4xx` (`400` cuerpo inválido, `401` secreto): no reintenta y lo registra en el log con el código y el `messageId`.
- `5xx` o ninguna respuesta (error de red o sin respuesta en 10 segundos): reintenta hasta 3 veces, a 1 s, 5 s y 30 s; si el último falla, lo registra y descarta el mensaje.

La foto SHALL descargarse una sola vez por mensaje, aunque haya reintentos. Los mensajes de un mismo chat SHALL entregarse en el orden en que llegaron, incluida la descarga. El log SHALL no incluir el secreto, el texto, la leyenda ni la imagen.

#### Scenario: Falla transitoria
- **WHEN** recaudo responde `500` y luego `202`
- **THEN** `contact` reintenta una vez, 1 segundo después, sin volver a descargar la foto

#### Scenario: Dos fotos seguidas
- **WHEN** un vendedor manda la foto A y luego la B, y la descarga de A tarda más
- **THEN** recaudo recibe A antes que B
