# DECISIONS.md

Decisiones tomadas en este repo y por qué. No incluye decisiones triviales.

## Servicio separado del backend principal, no un módulo del monolito

**Decisión:** `contact-api` es un repo y proceso independiente, no vive dentro del monolito del backend principal.

**Por qué:** el formulario de contacto es público (sin auth) y no depende de ninguna entidad del dominio del backend principal (no toca `person`, `node`, etc.). Aislarlo reduce superficie de ataque del backend principal y permite deployarlo/reiniciarlo sin afectar el resto del sistema.

## Dos canales en paralelo con fallo independiente, sin cola

**Decisión:** enviar por email y WhatsApp en paralelo, cada uno con su propio `try/catch`, devolviendo `207` si uno falla. Sin cola de reintentos.

**Por qué:** el volumen esperado es bajo (formulario de contacto de una iglesia, no un sistema transaccional de alto tráfico). Una cola agregaría complejidad operativa (worker, storage) que no se justifica todavía. Si el volumen crece o los fallos de un canal se vuelven frecuentes, reconsiderar.

## Sin SDK para WhatsApp

**Decisión:** llamar a la Meta Cloud API directamente por HTTP en vez de usar un SDK de terceros.

**Por qué:** la Cloud API de Meta es simple (un POST) y evita atarse a un SDK no oficial con su propio ciclo de vida de versiones.
