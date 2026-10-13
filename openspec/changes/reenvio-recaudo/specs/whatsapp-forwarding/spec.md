## ADDED Requirements

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
A recaudo SHALL ir solo lo que el reenvío a PERLA dejaría pasar (los mismos filtros de "Qué se ignora sin reenviar") y, además, solo los mensajes `INBOUND` de un chat con número de teléfono. El contenedor de un álbum SHALL no reenviarse: sus fotos llegan como mensajes separados.

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

#### Scenario: Chat sin número
- **WHEN** llega una foto de un chat `@lid` sin JID de teléfono alternativo
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
