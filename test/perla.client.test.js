import test from 'node:test';
import assert from 'node:assert/strict';

import { createPerlaClient } from '../src/clients/perla.client.js';

const URL = 'http://127.0.0.1:8084/internal/whatsapp/events';
const SECRET = 's3cr3t-no-debe-salir';
const TEXTO = 'texto privado del interlocutor';

function evento(overrides = {}) {
  return {
    messageId: 'MSG1',
    direction: 'INBOUND',
    jid: '573001234567@s.whatsapp.net',
    pushName: 'Ana Recruiter',
    kind: 'TEXT',
    text: TEXTO,
    timestamp: '2026-09-25T20:15:03.000Z',
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

/**
 * `respuestas` es la secuencia de resultados por intento: un codigo HTTP o
 * `'caida'` para un error de red.
 */
function fetchFalso(respuestas) {
  const llamadas = [];

  const fetch = async (url, init) => {
    llamadas.push({ url, init });
    const siguiente = respuestas.shift();

    if (siguiente === 'caida' || siguiente === undefined) {
      throw new TypeError('fetch failed');
    }

    return { status: siguiente };
  };

  return { fetch, llamadas };
}

function cliente({ respuestas, sleep, logger = loggerFalso() }) {
  const esperas = [];
  const falso = fetchFalso(respuestas);

  const perla = createPerlaClient({
    url: URL,
    secret: SECRET,
    fetch: falso.fetch,
    sleep:
      sleep ??
      (async (ms) => {
        esperas.push(ms);
      }),
    logger,
  });

  return { perla, esperas, llamadas: falso.llamadas, logger };
}

function sinSecretosNiTexto(logger) {
  for (const [, linea] of logger.lineas) {
    assert.ok(!linea.includes(SECRET), `el log incluye el secreto: ${linea}`);
    assert.ok(!linea.includes(TEXTO), `el log incluye el texto: ${linea}`);
  }
}

test('POST con la cabecera del secreto y el evento en JSON', async () => {
  const { perla, llamadas } = cliente({ respuestas: [202] });

  await perla.forward(evento());

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, URL);
  assert.equal(llamadas[0].init.method, 'POST');
  assert.equal(llamadas[0].init.headers['Content-Type'], 'application/json');
  assert.equal(llamadas[0].init.headers['X-Perla-Channel-Secret'], SECRET);
  assert.deepEqual(JSON.parse(llamadas[0].init.body), evento());
  assert.ok(llamadas[0].init.signal, 'cada intento lleva un timeout');
});

test('202: sin reintento ni log', async () => {
  const { perla, llamadas, esperas, logger } = cliente({ respuestas: [202] });

  await perla.forward(evento());

  assert.equal(llamadas.length, 1);
  assert.deepEqual(esperas, []);
  assert.deepEqual(logger.lineas, []);
});

test('500 y luego 202: un solo reintento, al segundo', async () => {
  const { perla, llamadas, esperas } = cliente({ respuestas: [500, 202] });

  await perla.forward(evento());

  assert.equal(llamadas.length, 2);
  assert.deepEqual(esperas, [1000]);
});

test('sin respuesta en los 4 intentos: esperas 1 s, 5 s, 30 s y descarte en el log', async () => {
  const { perla, llamadas, esperas, logger } = cliente({
    respuestas: ['caida', 'caida', 'caida', 'caida'],
  });

  await perla.forward(evento());

  assert.equal(llamadas.length, 4);
  assert.deepEqual(esperas, [1000, 5000, 30000]);

  const [nivel, linea] = logger.lineas.at(-1);
  assert.equal(nivel, 'error');
  assert.match(linea, /MSG1/);
  assert.match(linea, /descarta/);
  sinSecretosNiTexto(logger);
});

test('400, 401, 404 y 503: sin reintento y con log', async () => {
  for (const status of [400, 401, 404, 503]) {
    const { perla, llamadas, esperas, logger } = cliente({ respuestas: [status] });

    await perla.forward(evento());

    assert.equal(llamadas.length, 1, `HTTP ${status} no se reintenta`);
    assert.deepEqual(esperas, []);
    assert.equal(logger.lineas.length, 1);
    assert.match(logger.lineas[0][1], new RegExp(`HTTP ${status}`));
    assert.match(logger.lineas[0][1], /MSG1/);
    sinSecretosNiTexto(logger);
  }
});

test('otro 5xx (502) se reintenta', async () => {
  const { perla, llamadas } = cliente({ respuestas: [502, 202] });

  await perla.forward(evento());

  assert.equal(llamadas.length, 2);
});

test('forward retorna sin esperar la entrega', async () => {
  let liberar;
  const bloqueo = new Promise((resolve) => {
    liberar = resolve;
  });
  const { perla, llamadas } = cliente({
    respuestas: [500, 202],
    sleep: () => bloqueo,
  });

  const entrega = perla.forward(evento());

  assert.ok(entrega instanceof Promise);
  assert.equal(perla.pendingChats(), 1);

  liberar();
  await entrega;

  assert.equal(llamadas.length, 2);
});

test('mismo jid: B sale despues de que A termine sus reintentos', async () => {
  let liberar;
  const bloqueo = new Promise((resolve) => {
    liberar = resolve;
  });
  const { perla, llamadas } = cliente({
    respuestas: [500, 202, 202],
    sleep: () => bloqueo,
  });

  const a = perla.forward(evento({ messageId: 'A' }));
  const b = perla.forward(evento({ messageId: 'B' }));

  // A fallo y espera su reintento; B no debe haber salido.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    llamadas.map((l) => JSON.parse(l.init.body).messageId),
    ['A']
  );

  liberar();
  await Promise.all([a, b]);

  assert.deepEqual(
    llamadas.map((l) => JSON.parse(l.init.body).messageId),
    ['A', 'A', 'B']
  );
  assert.equal(perla.pendingChats(), 0);
});

test('otro jid: B sale sin esperar el reintento de A', async () => {
  let liberar;
  const bloqueo = new Promise((resolve) => {
    liberar = resolve;
  });
  const { perla, llamadas } = cliente({
    respuestas: [500, 202, 202],
    sleep: () => bloqueo,
  });

  const a = perla.forward(evento({ messageId: 'A' }));
  const b = perla.forward(
    evento({ messageId: 'B', jid: '573005556677@s.whatsapp.net' })
  );

  await b;
  assert.deepEqual(
    llamadas.map((l) => JSON.parse(l.init.body).messageId),
    ['A', 'B']
  );

  liberar();
  await a;
  assert.equal(perla.pendingChats(), 0);
});
