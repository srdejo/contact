# Design

## Context

Ver `proposal.md` para el porqué. El contrato viene de `../perla-ai/openspec/changes/add-whatsapp-profile-channel/design.md`, **D1**, y no se cambia aquí. Estado actual que condiciona el diseño:

- `src/clients/whatsapp.client.js` es un módulo con estado (`socket`, `connectionStatus`) que crea el socket con `makeWASocket` y `useMultiFileAuthState` dentro de `connect()`. No se puede probar con un doble sin tocar disco ni red.
- `handleIncomingMessages` descarta los `fromMe` y solo escribe el `remoteJid` en el log.
- `sendMessage({ phone, text })` normaliza a `<dígitos>@s.whatsapp.net` y devuelve el `WAMessage` de Baileys. El controlador saca `messageId` de `result.key.id`.
- **`src/controllers/whatsapp.controller.js` no es código muerto.** `server.js:11` lo importa y `server.js:65,76,78` lo usan; `test/whatsapp.controller.test.js` lo cubre con 5 pruebas. El refactor del 2026-09-07 (`docs/ROADMAP.md`, "Código muerto resuelto") lo cableó, pero el README (sección de estructura), `docs/ARCHITECTURE.md` y el punto 4 de "Falta para poder desplegar" en `docs/PROGRESS.md` quedaron desactualizados. Por eso **no se borra**: se corrigen los documentos.
- Baileys `7.0.0-rc14`, verificado en `node_modules`:
  - `sendMessage(jid, content, { messageId })` usa ese ID en lugar de generar uno (`lib/Socket/messages-send.js`, `...options` después del `generateMessageIDV2`).
  - `generateMessageIDV2(userId)`, `isJidGroup`, `isJidBroadcast`, `isJidStatusBroadcast`, `isJidNewsletter`, `isLidUser`, `jidNormalizedUser` y `normalizeMessageContent` se exportan desde el paquete.
  - `WAMessageKey` tiene `remoteJidAlt`. `senderPn` no aparece en los tipos de esta versión; se lee igual (`key.senderPn`) por si llega de versiones anteriores del protocolo.
  - Con `emitOwnEvents: true` (por defecto), el eco local de un envío se emite como `upsert` de tipo `append`, que ya se descarta. El eco que importa es el `notify` que llega del servidor o de otro dispositivo vinculado: puede llegar antes de que `sendMessage` resuelva.
- Node con `fetch` y `AbortSignal.timeout` nativos (Node ≥ 18). Sin dependencias nuevas.

## Goals / Non-Goals

**Goals:**
- Cumplir los 6 puntos de D1 más el `404` sin reintento.
- Poder probar el caso del eco con un doble de Baileys que emite el `upsert` antes de resolver `sendMessage`, sin red ni disco.
- Que con `PERLA_EVENTS_URL` vacía el comportamiento sea idéntico al de hoy.

**Non-Goals:**
- Persistir el registro de IDs o la cola de reintentos: todo vive en memoria, igual que la sesión viva de Baileys.
- Recortar el texto o validar el evento del lado de `contact`: PERLA recorta y valida (D1).
- Reenviar contenido multimedia, reacciones o ediciones.
- Rutas nuevas, controladores nuevos o un router aparte.

## Decisions

### 1. `whatsapp.client.js` pasa a una fábrica con dependencias inyectables

`createWhatsAppClient({ makeSocket, loadAuthState, onMessage, isIgnoredNumber, now })` devuelve `{ connect, sendMessage, getStatus, isConnected }`. Los valores por defecto de `makeSocket` y `loadAuthState` son `makeWASocket` y `useMultiFileAuthState(data/whatsapp/auth)`. La instancia la crea `server.js`, que es la raíz de composición y el único que la usa, pasándole `onMessage` e `isIgnoredNumber`. En la implementación se descartó exportar además una instancia por defecto: no tendría el `onMessage` configurado y nadie más la necesita.

- `onMessage(event)` recibe solo los eventos ya clasificados como reenviables, con la forma de D1. El cliente no sabe nada de HTTP ni de PERLA.
- **Por qué:** el test del eco necesita un socket falso (`ev.on`, `sendMessage` que emite `messages.upsert` y después resuelve) y un `authState` falso. Con la fábrica eso es una inyección, no un mock de módulo ES (que `node --test` no trae sin flags experimentales).
- **Alternativa descartada:** exportar un `__setSocketForTests`. Deja un hueco de API en producción y no evita `useMultiFileAuthState` en `connect()`.

### 2. ID propio y registro con vencimiento, dentro del cliente

- `sendMessage({ jid, phone, text })`: si hay `jid` se usa tal cual; si no, `normalizePhone(phone)@s.whatsapp.net`. Genera `id = generateMessageIDV2(socket.user?.id)`, lo registra y llama `socket.sendMessage(jid, { text }, { messageId: id })`. Devuelve el resultado de Baileys (su `key.id` es el mismo `id`).
- El registro es un `Map<id, expiresAt>` con TTL de 15 minutos (el mínimo de D1 es 10; el margen cubre relojes y reintentos del servidor de WhatsApp). La limpieza es perezosa: al registrar se barren los vencidos. Sin temporizadores que mantengan vivo el proceso ni que haya que cerrar en las pruebas.
- El registro vive en el cliente porque lo escriben el envío y lo lee el `upsert` del mismo socket. Cubre también los envíos de `/api/contact`.
- Si `sendMessage` falla, el ID se queda en el registro hasta vencer: quitarlo abriría la posibilidad de que un envío que sí salió (timeout del lado de Baileys) vuelva como `OWNER`.
- **Alternativa descartada:** registrar el `key.id` que devuelve `sendMessage`. Es justo la carrera que D1 quiere evitar.

### 3. Clasificación del `upsert` como función pura

`toPerlaEvent(message, { isSentByApi, isIgnoredNumber, ownJids })` devuelve el evento D1 o `null`. Vive en `src/clients/whatsapp.events.js`, junto al cliente, porque es traducción del formato de Baileys, y se prueba sin socket.

Orden de filtros (cada uno devuelve `null`):
1. Sin `message` o sin `key.remoteJid` (stubs, avisos de sistema).
2. `remoteJid` de grupo, difusión o `status@broadcast`, o newsletter.
3. Contenido normalizado (`normalizeMessageContent`, que desenvuelve efímeros y "ver una vez") con `reactionMessage`, `protocolMessage`, `callLogMesssage`/`bcallMessage` (llamadas), o solo `senderKeyDistributionMessage`/`messageContextInfo` (claves, sin contenido de usuario).
4. Se resuelve el `jid` del interlocutor: `key.remoteJidAlt` o `key.senderPn` si `remoteJid` es `@lid` y el alternativo es de teléfono; si no, `remoteJid`.
5. Los dígitos del `jid` resuelto (y, si difiere, del `remoteJid`) coinciden con `WHATSAPP_TO_NUMBER` → `null`.
6. El `jid` resuelto o el `remoteJid` es el propio número dedicado ("Mensaje a mí mismo") → `null`. `ownJids` son `jidNormalizedUser(socket.user.id)` y `jidNormalizedUser(socket.user.lid)` (este último si existe); se comparan normalizados, porque `socket.user.id` trae el sufijo de dispositivo (`573…:12@s.whatsapp.net`). El cliente los lee del socket en cada `upsert`, así que valen tras una reconexión.
7. `fromMe` con ID registrado → `null`.

Luego: `direction = fromMe ? 'OWNER' : 'INBOUND'`; `kind = 'TEXT'` si hay `conversation` o `extendedTextMessage.text`, si no `'UNSUPPORTED'`; `pushName` solo en `INBOUND`; `timestamp = new Date(Number(messageTimestamp) * 1000).toISOString()` (`messageTimestamp` puede venir como `Long`).

- **Por qué `UNSUPPORTED` es "todo lo demás" y no una lista cerrada:** D1 nombra ejemplos (imagen, audio, documento, sticker, ubicación). Con una lista cerrada, un tipo nuevo de WhatsApp desaparecería en silencio; así PERLA al menos contesta "solo leo texto".
- **Por qué `WHATSAPP_TO_NUMBER` se lee en cada mensaje** (vía `isIgnoredNumber`): igual que `whatsappToNumber()` en el controlador de contacto; el `.env` hoy lo tiene vacío y se llenará sin redeploy de código.

### 4. `perla.client.js`: POST, política de reintentos y cola por chat

Nuevo `src/clients/perla.client.js` con `createPerlaClient({ url, secret, fetch, sleep, logger })` → `{ forward(event) }`.

- `forward` no devuelve una promesa que el llamador tenga que esperar para seguir: encadena el envío en `tails: Map<jid, Promise>` y retorna. La recepción de Baileys nunca espera a PERLA.
- Cada intento: `fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) })`.
- Política:

  | Resultado | Acción |
  |---|---|
  | `2xx` | fin |
  | `400`, `401`, `404`, `503` | log `warn` con código y `messageId`; fin |
  | otro `4xx` | igual que `400` (no se reintenta lo que no va a cambiar) |
  | otro `5xx`, error de red, timeout | espera `[1000, 5000, 30000][i]` y reintenta; tras el 4.º intento, log `error` y descarte |

- **Cola por `jid`:** la orden de llegada importa (un `OWNER` seguido de un `INBOUND` es una toma y luego una respuesta del interlocutor). Un evento en reintento retiene solo a su chat, como mucho 36 s. La entrada de `tails` se borra cuando la cadena termina, para no crecer sin límite.
- `sleep` y `fetch` se inyectan para que las pruebas no esperen 36 s reales.
- Con `url` vacía, `server.js` no crea el cliente y pasa `onMessage: undefined`: no hay ni clasificación con efecto ni peticiones.
- Log: `messageId`, `direction`, código. **Nunca** el secreto ni el texto del mensaje.
- **Alternativas descartadas:**
  - **Cola global única:** un chat en reintento bloquearía a todos.
  - **Reintento sin orden (fire-and-forget por evento):** puede entregar el `INBOUND` antes del `OWNER` que lo precede.
  - **`axios`/`got`:** dependencia nueva para lo que `fetch` ya hace.

### 5. Controlador de envío

`createWhatsAppController` acepta `{ jid, phone, text }`, exige `text` y al menos uno de los dos destinos, y pasa `{ jid, phone, text }` al servicio. La respuesta sigue siendo `messageId: result?.key?.id ?? null`. Cambia el texto del `400` a `text y phone o jid son requeridos`: los consumidores miran el código, no el texto (verificado: el único test que lo comprueba es el del propio repo).

### 6. Configuración

```
# Reenvío a PERLA. Vacío = apagado. Valor en el VPS:
# PERLA_EVENTS_URL=http://127.0.0.1:8084/internal/whatsapp/events
PERLA_EVENTS_URL=
# Mismo valor que WHATSAPP_CHANNEL_SECRET en el .env de PERLA.
PERLA_CHANNEL_SECRET=
```

- D1 dice "por defecto `http://127.0.0.1:8084/...`" y a la vez "con la URL vacía el reenvío queda apagado", y su Migration Plan despliega `contact` con la URL vacía. Se interpreta así: la URL de D1 es el valor a configurar, **no** un valor por defecto en el código. Ausente o vacía = apagado. Así, copiar `.env.example` no enciende nada.
- Con URL y sin secreto, `contact` arranca y registra una advertencia: PERLA contestará `401`, que ya se trata sin reintento. No se hace fallar el arranque para no tumbar a los otros consumidores por una variable del canal nuevo.

## Risks / Trade-offs

- **[Reinicio de `contact` con envíos en vuelo: el eco llega tras el reinicio y el registro está vacío → `OWNER` falso]** → La ventana es de segundos. PERLA descarta un `OWNER` cuyo `messageId` coincide con un `whatsapp_message_id` que ya envió (defensa en profundidad de D1).
- **[Interlocutor solo con `@lid` que resulta ser `WHATSAPP_TO_NUMBER`]** → No se puede detectar sin el JID de teléfono; se reenvía. PERLA compara dígitos contra `WHATSAPP_NOTIFY_NUMBER` y tampoco lo detectaría. Se revisa con datos reales (tarea 14.2 de PERLA).
- **[Un servicio futuro usa `/api/whatsapp/send` para escribirle a terceros desde este número]** → Confirmado por Daniel (2026-09-25): el número de Baileys es **solo de PERLA**. El único otro envío es el aviso de `/api/contact` al número de `WHATSAPP_TO_NUMBER`, que ya se ignora en los dos sentidos. Como restricción futura, se registra en `docs/DECISIONS.md`: todo chat de persona que escriba a este número llega a PERLA y el bot le contesta, así que otro servicio que quiera escribir a terceros necesita otro número.
- **[Eventos perdidos si PERLA está caída más de ~36 s o si `contact` se reinicia con eventos en cola]** → Aceptado por D1 ("después lo registra en el log y lo descarta"). El mensaje sigue en el teléfono.
- **[Cambios de formato de Baileys en una versión `rc`]** → `toPerlaEvent` está aislada y probada con mensajes de ejemplo; una subida de versión se revisa contra esas pruebas.
- **[Un chat con PERLA en reintentos retiene hasta 36 s sus eventos siguientes]** → Deliberado para conservar el orden.
- **[El filtro de "Mensaje a mí mismo" va más allá de la lista de D1]** → Decidido por Daniel (2026-09-25). Es un filtro extra del lado de `contact`: no cambia el contrato, solo evita que PERLA reciba un `OWNER` sobre el propio número. Sugerencia para `perla-ai`: mencionarlo en el punto 4 de D1.

## Migration Plan

Sigue el paso 3 del Migration Plan de PERLA:
1. Desplegar `contact` con `PERLA_EVENTS_URL` vacía: nada cambia para los consumidores actuales. Verificar `/api/contact` y `/api/whatsapp/send` como hoy.
2. Cuando PERLA tenga V3 y el canal desplegado, poner `PERLA_EVENTS_URL` y `PERLA_CHANNEL_SECRET` en el `.env` del VPS (y `WHATSAPP_TO_NUMBER`, que sigue vacío) y reiniciar `contact`.
3. **Rollback:** vaciar `PERLA_EVENTS_URL` y reiniciar. No hay datos que migrar.

## Notas para `perla-ai`

- **`404` en la tabla de D1:** este change lo trata como el `503` a pedido de Daniel. Sugerencia: agregar la fila a la tabla de D1 para que los dos lados digan lo mismo. No cambia el contrato de PERLA.
