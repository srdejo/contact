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

## Sin SDK para WhatsApp

**Decisión:** llamar a la Meta Cloud API directamente por HTTP en vez de usar un SDK de terceros.

**Por qué:** la Cloud API de Meta es simple (un POST) y evita atarse a un SDK no oficial con su propio ciclo de vida de versiones.
