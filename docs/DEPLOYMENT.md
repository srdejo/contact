# DEPLOYMENT.md

Cómo se instala y se despliega `contact` en `nolost-vps`.

**Estado (2026-09-05):** el servicio corre en producción desde hace meses, pero lo que está desplegado es la versión anterior (WhatsApp por Meta Cloud API, expuesta públicamente en `/contact/`). La versión con Baileys y con el servicio cerrado a loopback **todavía no se ha desplegado** — este documento describe cómo desplegarla y qué cambia.

## Qué es esto en producción

| | |
|---|---|
| Host | `srdejo@nolost-vps` |
| Directorio | `/home/srdejo/apps/contact` |
| Servicio systemd | `nolost-contact` |
| Puerto | `127.0.0.1:3000` (loopback, ver `PORTS.md` raíz del workspace) |
| Runtime | Node.js (ES modules), sin build step |
| Deploy | `infra\deploy.ps1` -> opcion **9) contact**, o `-Action Contact` |
| Estado persistente | `/home/srdejo/apps/contact/data/whatsapp/auth/` — sesión de WhatsApp |

## Por qué no se expone

`contact` es un **servicio interno**: sus clientes son otros servicios del mismo host (`nolost`, `hotel-backend`, `consulting`, `micasachurch`), que lo llaman directo por `http://127.0.0.1:3000`. No hay proxy de nginx hacia él y no debe volver a haberlo.

Tres razones, en orden de importancia:

1. **Puede enviar WhatsApps desde una cuenta real.** Desde el cambio a Baileys (2026-09-05) el servicio tiene vinculada una cuenta de WhatsApp por QR. Un `POST /api/whatsapp/send` abierto a internet es una cuenta de WhatsApp abierta a internet.
2. **`requireLocalhost` no protege de nginx.** El middleware mira `req.socket.remoteAddress`; una petición proxeada por nginx llega como `127.0.0.1` y pasa el chequeo. Es una segunda capa, no la principal. La protección real es que **el socket escucha solo en `127.0.0.1`** (`app.listen(port, '127.0.0.1')`) y que no exista `location /contact/` en nginx.
3. **El consumidor público ya no existe.** El formulario de la iglesia que llamaba a `/contact/api/contact` desapareció con la migración de dominio del 2026-08-31. Ningún proyecto del workspace llama hoy a esa ruta.

Historial: hasta el 2026-09-05 nginx tenía `location /contact/` -> `127.0.0.1:3000` con un corte puntual (`location = /contact/api/send { return 404; }`) para el único endpoint interno. Ese enfoque —abrir todo y tapar rutas una por una— dejó `/api/whatsapp/send` expuesto en el momento en que se agregó. Ahora es al revés: nada se expone.

### Cambio de nginx pendiente en el VPS

En local ya está aplicado (`infra/nginx/edge.conf`). En el VPS hay que hacer lo mismo en `/etc/nginx/sites-available/nolost` (el archivo que sirve el HTTPS real; **no** `micasachurch.co`, que no se ejecuta — ver `docs/PROGRESS.md`, 2026-08-27):

```nginx
# contact API: servicio interno, no se expone. Ver contact/docs/DEPLOYMENT.md.
location /contact/ {
    return 404;
}
```

reemplazando el `location /contact/`, el `location = /contact/health` y el `location = /contact/api/send` que hay hoy. Después:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Verificación desde fuera del VPS: `https://nolost.micasachurch.co/contact/api/contact` debe dar **404 de nginx** (cuerpo = página de error de nginx, no JSON de Express).

### Directorio viejo `/home/srdejo/contact`

Hasta el 2026-09-05 `infra/deploy.ps1` apuntaba a `/home/srdejo/contact`, mientras que el servicio real vive en `/home/srdejo/apps/contact` (la convención del resto de proyectos). O sea que los últimos deploys pudieron estar subiendo código a un directorio que nadie ejecuta. Al desplegar, verificar en el VPS:

```bash
ls -la /home/srdejo/contact 2>/dev/null && echo "--- directorio huerfano, revisar y borrar ---"
systemctl show nolost-contact -p WorkingDirectory
```

Si `WorkingDirectory` es `/home/srdejo/apps/contact` y existe además `/home/srdejo/contact`, ese segundo es basura de deploys anteriores: confirmar que no tiene un `data/whatsapp/auth/` con la sesión buena y borrarlo.

## Instalación desde cero

Solo la primera vez, o si hay que rehacer el servicio.

### 1. Requisitos en el VPS

```bash
node --version    # Baileys 7 requiere Node >= 20
npm --version
```

### 2. Crear (o refrescar) el servicio systemd

Es idempotente: se puede volver a correr sobre un servicio ya instalado para regenerar el unit. **Hay que correrlo al desplegar la versión con Baileys**, aunque el servicio ya exista, porque el unit cambió (`Restart=always` en vez de `on-failure`, y el `WorkingDirectory` correcto).

Desde Windows, en la raíz del workspace:

```powershell
.\infra\deploy.ps1 -Action SetupContact
```

Escribe el unit, lo mueve a `/etc/systemd/system/nolost-contact.service` y hace `enable` (pide la contraseña de `sudo`). El unit queda así:

```ini
[Unit]
Description=Contact API (email + WhatsApp, servicio interno de nolost-vps)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=srdejo
WorkingDirectory=/home/srdejo/apps/contact
ExecStart=/usr/bin/env node src/server.js
EnvironmentFile=/home/srdejo/apps/contact/.env
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

`Restart=always` (antes `on-failure`) porque Baileys mantiene un WebSocket vivo: si el proceso muere de forma limpia igual hay que levantarlo.

### 3. El `.env` en el servidor

Ya existe en `/home/srdejo/apps/contact/.env` y **nunca se sube desde el repo** (el deploy no lo toca). Lo que hay que hacer es actualizarlo para la versión con Baileys:

```bash
nano /home/srdejo/apps/contact/.env
chmod 600 /home/srdejo/apps/contact/.env
```

- **Agregar `WHATSAPP_TO_NUMBER`** si no está o está vacío — sin él, el canal de WhatsApp de `/api/contact` falla con "El número de teléfono es inválido".
- **`WHATSAPP_TOKEN` y `WHATSAPP_PHONE_ID` ya no se usan** (eran de la Meta Cloud API). Se pueden borrar; dejarlas no rompe nada.

Contenido esperado (ver `.env.example`):

```
PORT=3000
RESEND_API_KEY=...
MAIL_FROM=...
MAIL_TO=...
GMAIL_USER=...
GMAIL_APP_PASSWORD=...
GMAIL_FROM=...
WHATSAPP_TO_NUMBER=573001234567
```

`WHATSAPP_TO_NUMBER` va **solo con dígitos e indicativo**, sin `+` ni espacios. Si queda vacío, el canal de WhatsApp de `/api/contact` falla con "El número de teléfono es inválido" y el endpoint responde 207.

### 4. Primer deploy

```powershell
.\infra\deploy.ps1 -Action Contact
```

### 5. Vincular WhatsApp (escanear el QR)

Al arrancar sin sesión válida, Baileys imprime un QR ASCII en el journal:

```powershell
.\infra\deploy.ps1 -Action ContactLogs
```

(equivale a `journalctl -u nolost-contact -f`). En el teléfono: **WhatsApp -> Dispositivos vinculados -> Vincular un dispositivo**, y escanear.

El QR caduca en ~20 segundos y Baileys genera uno nuevo; si se pasa, esperar al siguiente. La ventana de terminal tiene que ser lo bastante ancha para que el QR no se corte.

Confirmar desde el VPS:

```bash
curl -s http://127.0.0.1:3000/api/whatsapp/status
# {"status":"CONNECTED","connected":true}
```

A partir de ahí la sesión queda en `data/whatsapp/auth/` y el servicio reconecta solo en cada reinicio.

## Deploy de un cambio

Desde el menú:

```powershell
.\infra\deploy.ps1        # y elegir la opcion 9) contact
```

o directo:

```powershell
.\infra\deploy.ps1 -Action Contact
```

`contact` aparece en el menú como un proyecto más (`Kind = "contact"` en `$projectsCfg`), pero su flujo es distinto al de los demás: sin build de Gradle, sin frontend, sin base de datos. `-Action Restart` y `-Action Logs` también funcionan sobre él (apuntan al servicio `nolost-contact`); `-Action Backup` y `-Action Frontend` se omiten con un aviso.

Qué hace, en orden:

1. `mkdir -p` de `src/` y `data/whatsapp/auth/`, `chmod 700 data/`.
2. **Borra `src/` remoto** y lo vuelve a subir. Necesario desde que los clientes se movieron a `src/clients/`: si no, los archivos viejos (`src/resend.client.js`, `src/whatsapp.client.js`...) quedarían huérfanos en el VPS.
3. Sube `package.json` y `package-lock.json`.
4. Avisa si falta el `.env` o si `WHATSAPP_TO_NUMBER` está vacío.
5. `npm ci --omit=dev`.
6. `sudo systemctl restart nolost-contact`.
7. Verifica: `systemctl is-active`, `GET /health`, `GET /api/whatsapp/status`.

**`data/` y `.env` no se tocan nunca.** Es lo que permite redesplegar sin volver a escanear el QR.

## La carpeta `data/whatsapp/auth/`

Es la parte frágil de este servicio. Tratarla como una credencial:

- **Quien la tenga puede enviar mensajes como esa cuenta de WhatsApp.** `chmod 700`, no commitearla (ya está en `.gitignore`), no copiarla por canales inseguros.
- **Debe sobrevivir a los redeploys.** Vive dentro de `/home/srdejo/apps/contact/`, fuera de `src/`, que es lo único que el deploy borra.
- **Respaldarla.** Si se pierde, no se rompe nada permanente, pero hay que volver a escanear el QR con el teléfono a mano.
- **Una sola instancia.** Dos procesos compartiendo la misma sesión se desconectan mutuamente. No escalar a réplicas ni dejar corriendo el servicio en local contra la misma sesión mientras el VPS la usa.

Backup manual:

```bash
tar czf ~/contact-wa-auth-$(date +%F).tar.gz -C /home/srdejo/apps/contact data/whatsapp/auth
```

## Operación

```bash
sudo systemctl status nolost-contact
sudo systemctl restart nolost-contact
journalctl -u nolost-contact -f          # aquí sale el QR
journalctl -u nolost-contact -n 200 --no-pager
```

Chequeo rápido desde el VPS:

```bash
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/api/whatsapp/status
curl -s -X POST http://127.0.0.1:3000/api/whatsapp/send \
  -H 'Content-Type: application/json' \
  -d '{"phone":"573001234567","text":"prueba desde el VPS"}'
```

## Problemas conocidos

**`status` se queda en `QR_REQUIRED`** — nadie escaneó el QR, o caducó. Ver el journal y escanear.

**`status` en `DISCONNECTED` y el journal repite "WhatsApp desconectado / Reconnect: true"** — no hay salida a internet hacia `web.whatsapp.com`, o WhatsApp está rechazando la conexión. Verificar egress del VPS.

**El journal dice "La sesión fue cerrada"** (`loggedOut`) — alguien cerró la sesión desde el teléfono. El cliente deja de reconectar a propósito. Hay que borrar la sesión y volver a vincular:

```bash
sudo systemctl stop nolost-contact
rm -rf /home/srdejo/apps/contact/data/whatsapp/auth/*
sudo systemctl start nolost-contact
# y escanear el QR de nuevo
```

**`/api/contact` responde 207 con `errors.whatsapp`** — el canal de email sí salió; WhatsApp no. Mirar `status`. Es el comportamiento diseñado: un canal caído no tumba el otro.

**`npm ci` falla con "lock file out of sync"** — `package-lock.json` no corresponde a `package.json`. Correr `npm install` en local, commitear el lock, y redesplegar.

**Un servicio cliente recibe 403** — está llamando desde una IP que no es loopback. Los clientes tienen que usar `http://127.0.0.1:3000`, no el dominio público ni la IP del VPS.

## Riesgo aceptado

Baileys es una integración **no oficial** con WhatsApp Web. WhatsApp puede desconectar la sesión o bloquear la cuenta sin aviso, y no hay SLA. Es aceptable para notificaciones internas de bajo volumen; si el canal se vuelve crítico para el negocio, la Meta Cloud API es la opción soportada (ver `docs/DECISIONS.md`).
