import test from 'node:test';
import assert from 'node:assert/strict';

import { createRecaudoClient } from '../src/clients/recaudo.client.js';

const URL = 'http://127.0.0.1:8095/internal/whatsapp/mensajes';
const SECRET = 's3cr3t-de-recaudo';
const LEYENDA = 'leyenda privada del vendedor';
const FOTO = Buffer.from('bytes de la foto');

function pendiente(overrides = {}) {
  return {
    messageId: 'MSG1',
    jid: '573007046858@s.whatsapp.net',
    phone: '573007046858',
    receivedAt: '2026-10-13T15:00:00.000Z',
    kind: 'IMAGE',
    text: LEYENDA,
    mimeType: 'image/jpeg',
    fileLength: FOTO.length,
    ...overrides,
  };
}

function loggerFalso() {
  const lineas = [];

  return {
    lineas,
    warn: (...args) => lineas.push(['warn', args.join(' ')]),
    error: (...args) => lineas.push(['error', args.join(' ')]),
  };
}

/** `respuestas`: por intento, un código HTTP o `'caida'` para un error de red. */
function cliente({ respuestas = [202], downloadImage = async () => FOTO, maxImageBytes } = {}) {
  const llamadas = [];
  const esperas = [];
  const descargas = [];
  const logger = loggerFalso();

  const recaudo = createRecaudoClient({
    url: URL,
    secret: SECRET,
    downloadImage: async (mensaje) => {
      descargas.push(mensaje);
      return downloadImage(mensaje);
    },
    fetch: async (url, init) => {
      llamadas.push({ url, init });
      const siguiente = respuestas.shift();

      if (siguiente === 'caida' || siguiente === undefined) {
        throw new TypeError('fetch failed');
      }

      return { status: siguiente };
    },
    sleep: async (ms) => {
      esperas.push(ms);
    },
    logger,
    ...(maxImageBytes ? { maxImageBytes } : {}),
  });

  return { recaudo, llamadas, esperas, descargas, logger };
}

function cuerpo(llamada) {
  return JSON.parse(llamada.init.body);
}

function sinSecretosNiContenido(logger) {
  for (const [, linea] of logger.lineas) {
    assert.ok(!linea.includes(SECRET), `el log incluye el secreto: ${linea}`);
    assert.ok(!linea.includes(LEYENDA), `el log incluye la leyenda: ${linea}`);
    assert.ok(!linea.includes(FOTO.toString('base64')), `el log incluye la imagen: ${linea}`);
  }
}

test('foto: POST con el secreto y la imagen descargada en base64 (contrato D2)', async () => {
  const { recaudo, llamadas, descargas } = cliente();
  const crudo = { key: { id: 'MSG1' } };

  await recaudo.forward(pendiente(), crudo);

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, URL);
  assert.equal(llamadas[0].init.headers['X-Recaudo-Channel-Secret'], SECRET);
  assert.equal(llamadas[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(descargas, [crudo]);
  assert.deepEqual(cuerpo(llamadas[0]), {
    messageId: 'MSG1',
    jid: '573007046858@s.whatsapp.net',
    phone: '573007046858',
    receivedAt: '2026-10-13T15:00:00.000Z',
    kind: 'IMAGE',
    text: LEYENDA,
    image: { mimeType: 'image/jpeg', base64: FOTO.toString('base64') },
  });
});

test('texto: sin descarga ni imagen', async () => {
  const { recaudo, llamadas, descargas } = cliente();

  await recaudo.forward(pendiente({ kind: 'TEXT', text: 'hola', mimeType: undefined, fileLength: undefined }), {});

  assert.deepEqual(descargas, []);
  assert.deepEqual(cuerpo(llamadas[0]), {
    messageId: 'MSG1',
    jid: '573007046858@s.whatsapp.net',
    phone: '573007046858',
    receivedAt: '2026-10-13T15:00:00.000Z',
    kind: 'TEXT',
    text: 'hola',
  });
});

test('imagen de más de 10 MB según WhatsApp: UNSUPPORTED sin descargarla', async () => {
  const { recaudo, llamadas, descargas, logger } = cliente();

  await recaudo.forward(pendiente({ fileLength: 11 * 1024 * 1024 }), {});

  assert.deepEqual(descargas, []);
  assert.equal(cuerpo(llamadas[0]).kind, 'UNSUPPORTED');
  assert.equal(cuerpo(llamadas[0]).image, undefined);
  assert.equal(logger.lineas.length, 1);
  sinSecretosNiContenido(logger);
});

test('imagen que al descargarla pasa del límite: UNSUPPORTED', async () => {
  const { recaudo, llamadas } = cliente({ maxImageBytes: 4, downloadImage: async () => FOTO });

  await recaudo.forward(pendiente({ fileLength: 0 }), {});

  assert.equal(cuerpo(llamadas[0]).kind, 'UNSUPPORTED');
});

test('descarga fallida: UNSUPPORTED, para que recaudo pida reenviarla', async () => {
  const { recaudo, llamadas, logger } = cliente({
    downloadImage: async () => {
      throw new Error('media no disponible');
    },
  });

  await recaudo.forward(pendiente(), {});

  assert.equal(cuerpo(llamadas[0]).kind, 'UNSUPPORTED');
  assert.equal(logger.lineas[0][0], 'error');
  sinSecretosNiContenido(logger);
});

test('500 y luego 202: un reintento al segundo, con la imagen descargada una sola vez', async () => {
  const { recaudo, llamadas, esperas, descargas } = cliente({ respuestas: [500, 202] });

  await recaudo.forward(pendiente(), {});

  assert.equal(llamadas.length, 2);
  assert.deepEqual(esperas, [1000]);
  assert.equal(descargas.length, 1);
});

test('sin respuesta en los 4 intentos: esperas 1 s, 5 s y 30 s, y descarte en el log', async () => {
  const { recaudo, llamadas, esperas, logger } = cliente({ respuestas: ['caida', 'caida', 'caida', 'caida'] });

  await recaudo.forward(pendiente(), {});

  assert.equal(llamadas.length, 4);
  assert.deepEqual(esperas, [1000, 5000, 30000]);
  assert.match(logger.lineas.at(-1)[1], /tras 4 intentos/);
  sinSecretosNiContenido(logger);
});

test('400 y 401 no se reintentan', async () => {
  for (const codigo of [400, 401]) {
    const { recaudo, llamadas, esperas, logger } = cliente({ respuestas: [codigo] });

    await recaudo.forward(pendiente(), {});

    assert.equal(llamadas.length, 1);
    assert.deepEqual(esperas, []);
    assert.match(logger.lineas[0][1], new RegExp(`HTTP ${codigo}`));
    sinSecretosNiContenido(logger);
  }
});

test('dos fotos del mismo chat llegan en orden aunque la primera tarde en descargarse', async () => {
  let soltarPrimera;
  const primera = new Promise((resolve) => {
    soltarPrimera = resolve;
  });
  const { recaudo, llamadas } = cliente({
    respuestas: [202, 202],
    downloadImage: async (mensaje) => (mensaje.id === 'A' ? primera : FOTO),
  });

  const envios = [
    recaudo.forward(pendiente({ messageId: 'A' }), { id: 'A' }),
    recaudo.forward(pendiente({ messageId: 'B' }), { id: 'B' }),
  ];
  soltarPrimera(FOTO);
  await Promise.all(envios);

  assert.deepEqual(llamadas.map((llamada) => cuerpo(llamada).messageId), ['A', 'B']);
  assert.equal(recaudo.pendingChats(), 0);
});
