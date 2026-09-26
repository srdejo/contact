# contact

API de notificaciones (Node/Express): recibe un mensaje y lo reenvía por email (Resend o Gmail SMTP) y por WhatsApp (Baileys / WhatsApp Web).

**Servicio interno.** Desde 2026-09-05 escucha solo en `127.0.0.1` y no se expone por nginx: sus clientes son otros servicios del mismo host (`nolost`, `hotel-backend`, `consulting`, `micasachurch`), que lo llaman por `http://127.0.0.1:3000`. Antes `/api/contact` era público (formulario de Mi Casa Church); ese consumidor desapareció con la migración de dominio del 2026-08-31. El porqué y cómo desplegarlo: `docs/DEPLOYMENT.md`.

Proceso y ciclo de deploy propios, separados del backend principal.

## Endpoints

Todos los endpoints salvo `GET /health` pasan por `requireLocalhost` y responden `403` si la petición no viene de loopback.

- `GET /health` — chequeo de salud. Única ruta sin `requireLocalhost`.
- `POST /api/contact` — recibe `{ name, email, message }`, envía el mensaje por email (Resend) y WhatsApp (al número de `WHATSAPP_TO_NUMBER`). Responde `200` si ambos canales funcionan, `207` si alguno falla (ver `errors` en la respuesta), `400` si faltan campos.
- `GET /api/whatsapp/status` — estado de la conexión de WhatsApp: `{ status, connected }`, con `status` en `DISCONNECTED` / `QR_REQUIRED` / `CONNECTED`.
- `POST /api/whatsapp/send` — envía un WhatsApp de texto. El destino es `phone` (dígitos con indicativo; el resto de caracteres se ignora) o `jid` (identificador de chat, por ejemplo `573001234567@s.whatsapp.net` o `123456789012345@lid`, que se usa **tal cual**). Con los dos, gana `jid`. Cuerpo: `{ phone, text }` o `{ jid, text }`. Responde `200 { status: "ok", messageId }`, `400` (`text y phone o jid son requeridos`), `502` si WhatsApp no está conectado o el envío falla. El `messageId` lo fija `contact` antes de enviar y queda registrado 15 minutos como "enviado por la API": así su eco no se reenvía a PERLA como si Daniel hubiera escrito desde el teléfono (ver "Reenvío a PERLA").
- `POST /api/send` — endpoint genérico de envío de email, **de uso interno únicamente** (ver "Acceso restringido" abajo). Recibe `{ to, subject, html, from? }`, envía por **Gmail SMTP** vía `gmail.client.js` (`nodemailer`) — distinto proveedor que `/api/contact` (Resend), porque los consumidores de `/api/send` (`hotel-backend`, `consulting`) no tenían un dominio verificado en Resend cuando se agregó cada uno. Responde `200` en éxito, `400` si faltan `to`/`subject`/`html`, `502` si Gmail falla, `403` si la petición no viene de localhost.

### Acceso restringido

El servicio entero es de acceso restringido, en dos capas:

1. **El socket escucha solo en `127.0.0.1`** (`app.listen(port, '127.0.0.1')`). Nada fuera del VPS puede abrir una conexión.
2. **`requireLocalhost`** en cada ruta de negocio rechaza con `403` si `req.socket.remoteAddress` no es loopback.

La capa 1 es la que realmente protege. `requireLocalhost` **no** protege de un proxy nginx en el mismo host: nginx llegaría como `127.0.0.1` y pasaría el chequeo. Por eso no hay `location /contact/` en nginx y no debe volver a agregarse — ver `docs/DEPLOYMENT.md` > "Por qué no se expone".

## Variables de entorno

Ver `.env.example`:

| Variable | Uso |
|---|---|
| `PORT` | Puerto HTTP |
| `RESEND_API_KEY` | API key de [Resend](https://resend.com) para envío de email de `/api/contact` |
| `MAIL_FROM` / `MAIL_TO` | Remitente/destinatario del email de contacto (`/api/contact`) |
| `GMAIL_USER` | Cuenta de Gmail que envía por `/api/send` |
| `GMAIL_APP_PASSWORD` | [Contraseña de aplicación](https://myaccount.google.com/apppasswords) de esa cuenta (no la clave normal) |
| `GMAIL_FROM` | Remitente que se muestra en `/api/send` (opcional, por defecto `GMAIL_USER`) |
| `WHATSAPP_TO_NUMBER` | Número que recibe la notificación de WhatsApp de `/api/contact` (solo dígitos, con indicativo: `573001234567`). Sus chats nunca se reenvían a PERLA |
| `PERLA_EVENTS_URL` | URL de eventos de PERLA (`http://127.0.0.1:8084/internal/whatsapp/events` en el VPS). Vacía = reenvío apagado |
| `PERLA_CHANNEL_SECRET` | Secreto compartido con PERLA: el mismo valor que `WHATSAPP_CHANNEL_SECRET` en su `.env` |

## Cómo correr en local

```bash
cp .env.example .env   # completar con claves de desarrollo/sandbox
npm install
npm run dev             # node --watch src/server.js — reinicia solo al guardar cambios
```

## WhatsApp (Baileys)

El canal de WhatsApp **no usa la Meta Cloud API**: usa `@whiskeysockets/baileys`, que se conecta como un dispositivo vinculado de WhatsApp Web. No hay token ni API key; hay una **sesión** que se crea escaneando un QR.

### Vincular por primera vez (en cualquier entorno)

1. Arranca el servicio. Si no hay sesión válida, el QR se imprime en la salida estándar:
   - en local: se ve directo en la terminal de `npm run dev`;
   - en el VPS: `journalctl -u <servicio> -f` (el QR ASCII se ve bien en una terminal de ancho normal).
2. En el teléfono: WhatsApp → **Dispositivos vinculados** → Vincular dispositivo → escanear.
3. Confirmar con `curl localhost:$PORT/api/whatsapp/status` → `{"status":"CONNECTED","connected":true}`.

La sesión queda en `data/whatsapp/auth/` (gitignoreada). A partir de ahí el servicio reconecta solo al reiniciar.

### Reglas de operación

- **`data/whatsapp/auth/` es una credencial.** Quien la tenga puede enviar mensajes como esa cuenta. No commitearla, no copiarla a canales inseguros, respaldarla.
- **Debe sobrevivir a los redeploys.** Si el deploy borra o reemplaza el directorio de la app, la carpeta de auth tiene que vivir fuera (o montarse), o habrá que reescanear el QR en cada deploy.
- **Una sola instancia.** Dos procesos con la misma sesión se desconectan mutuamente. No escalar a réplicas.
- **Si la sesión se cierra desde el teléfono** (`loggedOut`), el cliente deja de reconectar a propósito: hay que borrar `data/whatsapp/auth/` y volver al paso 1.
- Es una integración **no oficial**: WhatsApp puede desconectar o bloquear la cuenta. Si el canal se vuelve crítico, la Meta Cloud API es la opción soportada.

## Reenvío a PERLA

El número de Baileys es **solo de PERLA** (el asistente del perfil profesional, `../perla-ai`). Con `PERLA_EVENTS_URL` configurada, `contact` le reenvía lo que llega a ese número; PERLA responde por `POST /api/whatsapp/send` con el `jid` del chat. El contrato es el D1 de `perla-ai/openspec/changes/add-whatsapp-profile-channel/design.md`.

- Es una llamada **saliente** por loopback, con la cabecera `X-Perla-Channel-Secret`. No hay ninguna ruta nueva en `contact` y nada pasa por nginx.
- Solo se reenvían los mensajes nuevos (`messages.upsert` de tipo `notify`):
  - `INBOUND`: lo que escribe el interlocutor.
  - `OWNER`: lo que Daniel escribe desde el teléfono del número dedicado. El eco de un envío de la API **no** cuenta como `OWNER`.
  - `kind`: `TEXT`, o `UNSUPPORTED` para todo lo demás (imagen, audio, documento, sticker, ubicación…).
- Se ignoran grupos, estados, difusiones, newsletters, llamadas, reacciones, ediciones y borrados, el chat con `WHATSAPP_TO_NUMBER` y "Mensaje a mí mismo".
- Reintentos: `5xx` o sin respuesta en 10 s → a 1 s, 5 s y 30 s, y luego se descarta con un log. `400`, `401`, `404` (PERLA sin el canal desplegado) y `503` no se reintentan.
- **Consecuencia:** cualquier persona que escriba a este número le llega a PERLA y el bot le contesta. Un servicio que quiera escribirle a terceros necesita otro número (ver `docs/DECISIONS.md`).

## Deploy

Ver `docs/DEPLOYMENT.md`. Resumen: `infra\deploy.ps1 -Action Contact` desde la raíz del workspace; el servicio en el VPS es `nolost-contact` y corre en `127.0.0.1:3000`.

## Pendiente

- Quitar el `location /contact/` del nginx del VPS (en local ya está hecho) — ver `docs/DEPLOYMENT.md`.
