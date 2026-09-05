# DECISIONS.md

Decisiones tomadas en este repo y por qué. No incluye decisiones triviales.

## Servicio separado del backend principal, no un módulo del monolito

**Decisión:** `contact-api` es un repo y proceso independiente, no vive dentro del monolito del backend principal.

**Por qué:** el formulario de contacto es público (sin auth) y no depende de ninguna entidad del dominio del backend principal (no toca `person`, `node`, etc.). Aislarlo reduce superficie de ataque del backend principal y permite deployarlo/reiniciarlo sin afectar el resto del sistema.

## Dos canales en paralelo con fallo independiente, sin cola

**Decisión:** enviar por email y WhatsApp en paralelo, cada uno con su propio `try/catch`, devolviendo `207` si uno falla. Sin cola de reintentos.

**Por qué:** el volumen esperado es bajo (formulario de contacto de una iglesia, no un sistema transaccional de alto tráfico). Una cola agregaría complejidad operativa (worker, storage) que no se justifica todavía. Si el volumen crece o los fallos de un canal se vuelven frecuentes, reconsiderar.

## `/api/send` usa Gmail SMTP, no Resend (2026-08-27)

**Decisión:** `/api/send` (el endpoint interno de uso server-to-server) envía por Gmail SMTP (`nodemailer` + contraseña de aplicación) vía `gmail.client.js`, en vez de reusar `resend.client.js` como al principio. `/api/contact` (el formulario público de Mi Casa Church) sigue con Resend, sin cambios.

**Por qué:** los dos consumidores de `/api/send` hasta ahora (`hotel-backend`, y luego `consulting` al integrarse) no tienen un dominio propio verificado en la cuenta de Resend — los correos salían con el remitente sandbox `Acme <onboarding@resend.dev>`, lo cual se ve poco profesional y además Resend limita el uso real del sandbox. Verificar un dominio en Resend requiere acceso a su DNS, que no está automatizable desde aquí (la API key del servicio está restringida solo a envío, no a gestión de dominios) y el usuario prefirió no bloquear el envío de correos reales en eso. Gmail SMTP con contraseña de aplicación funciona de inmediato con cualquier cuenta Gmail existente, sin verificación de dominio — suficiente para el volumen bajo de estos formularios (~500 correos/día de límite en Gmail).

**Trade-off aceptado:** el remitente visible es una cuenta Gmail real, no un dominio propio (`notificaciones@srdejo.com.co`); si más adelante se verifica un dominio en Resend, se puede volver a cambiar `/api/send` sin tocar a los consumidores (el contrato `{to, subject, html, from?}` no cambia).

## Sin SDK para WhatsApp (superada 2026-09-05, ver abajo)

**Decisión:** llamar a la Meta Cloud API directamente por HTTP en vez de usar un SDK de terceros.

**Por qué:** la Cloud API de Meta es simple (un POST) y evita atarse a un SDK no oficial con su propio ciclo de vida de versiones.

**Estado:** superada por la decisión siguiente. El canal de WhatsApp ya no usa la Meta Cloud API.

## WhatsApp por Baileys (WhatsApp Web multi-dispositivo) en vez de Meta Cloud API (2026-09-05)

**Decisión:** el canal de WhatsApp pasa de la Meta Cloud API (llamada HTTP con `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID`) a `@whiskeysockets/baileys`, que se conecta como un dispositivo vinculado de WhatsApp Web. Un solo cliente (`src/clients/whatsapp.client.js`) sirve tanto a `/api/contact` como al nuevo `POST /api/whatsapp/send`.

**Por qué:** _pendiente de confirmar con el usuario_ — la motivación no quedó registrada al hacer el cambio. Ver `docs/PROGRESS.md` > "Bloqueos".

**Consecuencias operativas (esto es lo importante):**
- **El servicio deja de ser stateless.** Mantiene un WebSocket vivo contra WhatsApp y una sesión persistente en `data/whatsapp/auth/` (gitignoreada). Esa carpeta es una credencial: quien la tenga puede enviar mensajes como esa cuenta de WhatsApp.
- **Bootstrap manual.** La primera vez en cada entorno hay que escanear un QR, que se imprime en la salida estándar del proceso (`qrcode-terminal`).
- **Una sola instancia.** Dos procesos compartiendo la misma sesión se desconectan mutuamente. Descarta correr varias réplicas.
- **La carpeta de auth debe sobrevivir a los redeploys** y estar respaldada; si se pierde, hay que volver a escanear el QR.
- **Es una integración no oficial.** WhatsApp puede desconectar o banear la cuenta; no hay SLA. La Meta Cloud API sigue siendo la opción soportada si esto se vuelve crítico.

**Ya no se usan:** `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` (eliminadas de `.env.example`). `WHATSAPP_TO_NUMBER` sí sigue en uso: es el destinatario de la notificación de `/api/contact`.

## `contact` es un servicio interno: solo loopback, sin proxy publico (2026-09-05)

**Decisión:** el servicio escucha solo en `127.0.0.1` (`app.listen(port, '127.0.0.1')`), todas las rutas de negocio pasan por `requireLocalhost`, y nginx deja de proxear `/contact/`. Los consumidores son otros servicios del mismo host, que lo llaman por `http://127.0.0.1:3000`.

**Por qué:** desde el cambio a Baileys el servicio tiene vinculada una cuenta de WhatsApp real; `POST /api/whatsapp/send` abierto a internet es esa cuenta abierta a internet. Y el consumidor público que justificaba la exposición (el formulario de Mi Casa Church, `/contact/api/contact`) desapareció con la migración de dominio del 2026-08-31 — ningún proyecto del workspace llama hoy a esa ruta.

**Por qué así y no tapando rutas:** el esquema anterior era exponer `/contact/` entero y cortar rutas puntuales en nginx (`location = /contact/api/send { return 404; }`). Ese default —abierto salvo excepción— falló exactamente como se esperaría: al agregar `/api/whatsapp/send` quedó público sin que nadie lo decidiera. El default correcto es el inverso.

**Nota sobre `requireLocalhost`:** es la segunda capa, no la primera. No protege de un nginx corriendo en el mismo host (nginx llega como `127.0.0.1` y pasa el chequeo). Lo que protege es el bind a loopback más la ausencia del `location`.

**Trade-off aceptado:** si algún día vuelve a hacer falta un formulario público, no se reabre este servicio — el frontend llama a un backend del workspace y ese backend llama a `contact` por loopback.
