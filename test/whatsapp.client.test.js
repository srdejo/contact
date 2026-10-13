import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createWhatsAppClient } from '../src/clients/whatsapp.client.js';

const OWN_JID = '573110000000:7@s.whatsapp.net';

/**
 * Doble de Baileys: `ev` emite como el socket real y `sendMessage` registra lo
 * que recibe. `beforeResolve` corre dentro del envio, antes de resolver: es
 * donde el caso del eco emite su `upsert`.
 */
function socketFalso({ beforeResolve } = {}) {
  const ev = new EventEmitter();
  const enviados = [];

  const socket = {
    ev,
    user: { id: OWN_JID },
    enviados,
    async sendMessage(jid, content, options) {
      enviados.push({ jid, content, options });

      if (beforeResolve) {
        await beforeResolve({ jid, content, options });
      }

      return { key: { id: options?.messageId, remoteJid: jid, fromMe: true } };
    },
  };

  return socket;
}

async function clienteConectado(socket, opciones = {}) {
  const cliente = createWhatsAppClient({
    makeSocket: () => socket,
    loadAuthState: async () => ({ state: {}, saveCreds: () => {} }),
    ...opciones,
  });

  await cliente.connect();
  socket.ev.emit('connection.update', { connection: 'open' });

  return cliente;
}

function upsert(socket, type, message) {
  socket.ev.emit('messages.upsert', { type, messages: [message] });
}

function mensajeTexto({ id, fromMe = false, remoteJid, text = 'Hola' }) {
  return {
    key: { id, fromMe, remoteJid },
    message: { conversation: text },
    messageTimestamp: 1790367303,
    pushName: fromMe ? undefined : 'Ana Recruiter',
  };
}

// Silencia el banner de "WhatsApp conectado" en la salida de las pruebas.
test.beforeEach((t) => {
  t.mock.method(console, 'log', () => {});
});

test('sendMessage por jid lo usa tal cual y pasa un messageId propio', async () => {
  const socket = socketFalso();
  const cliente = await clienteConectado(socket);

  const resultado = await cliente.sendMessage({
    jid: '123456789012345@lid',
    phone: '573009998877',
    text: 'Hola',
  });

  assert.equal(socket.enviados.length, 1);
  assert.equal(socket.enviados[0].jid, '123456789012345@lid');
  assert.deepEqual(socket.enviados[0].content, { text: 'Hola' });
  assert.ok(socket.enviados[0].options.messageId);
  assert.equal(resultado.key.id, socket.enviados[0].options.messageId);
});

test('sendMessage por phone sigue normalizando a @s.whatsapp.net', async () => {
  const socket = socketFalso();
  const cliente = await clienteConectado(socket);

  await cliente.sendMessage({ phone: '+57 300 999 8877', text: 'Aviso' });

  assert.equal(socket.enviados[0].jid, '573009998877@s.whatsapp.net');
});

test('sendMessage falla si WhatsApp no esta conectado', async () => {
  const socket = socketFalso();
  const cliente = createWhatsAppClient({
    makeSocket: () => socket,
    loadAuthState: async () => ({ state: {}, saveCreds: () => {} }),
  });

  await cliente.connect();

  await assert.rejects(
    cliente.sendMessage({ phone: '573009998877', text: 'x' }),
    /WhatsApp no está conectado/
  );
});

test('el ID queda registrado antes de que el envio resuelva', async () => {
  const eventos = [];
  let socket;

  socket = socketFalso({
    beforeResolve: ({ jid, options }) => {
      upsert(
        socket,
        'notify',
        mensajeTexto({ id: options.messageId, fromMe: true, remoteJid: jid })
      );
    },
  });

  const cliente = await clienteConectado(socket, {
    onMessage: (evento) => eventos.push(evento),
  });

  const resultado = await cliente.sendMessage({
    jid: '573001234567@s.whatsapp.net',
    text: 'Hola',
  });

  // El eco llego antes de resolver y no se reenvio como OWNER.
  assert.deepEqual(eventos, []);
  assert.equal(resultado.key.id, socket.enviados[0].options.messageId);
});

test('el registro dura al menos 10 minutos y vence a los 15', async () => {
  let ahora = 1_000_000;
  const eventos = [];
  const socket = socketFalso();
  const cliente = await clienteConectado(socket, {
    now: () => ahora,
    onMessage: (evento) => eventos.push(evento),
  });

  const { key } = await cliente.sendMessage({
    jid: '573001234567@s.whatsapp.net',
    text: 'Hola',
  });
  const eco = mensajeTexto({
    id: key.id,
    fromMe: true,
    remoteJid: '573001234567@s.whatsapp.net',
  });

  ahora += 10 * 60 * 1000;
  upsert(socket, 'notify', eco);
  assert.equal(eventos.length, 0);

  ahora += 5 * 60 * 1000;
  upsert(socket, 'notify', eco);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].direction, 'OWNER');
});

test('un upsert que no es notify no se reenvia', async () => {
  const eventos = [];
  const socket = socketFalso();

  await clienteConectado(socket, {
    onMessage: (evento) => eventos.push(evento),
  });

  upsert(
    socket,
    'append',
    mensajeTexto({ id: 'A1', remoteJid: '573001234567@s.whatsapp.net' })
  );

  assert.deepEqual(eventos, []);
});

test('un mensaje del interlocutor llega como INBOUND', async () => {
  const eventos = [];
  const socket = socketFalso();

  await clienteConectado(socket, {
    onMessage: (evento) => eventos.push(evento),
  });

  upsert(
    socket,
    'notify',
    mensajeTexto({ id: 'IN1', remoteJid: '573001234567@s.whatsapp.net' })
  );

  assert.deepEqual(eventos, [
    {
      messageId: 'IN1',
      direction: 'INBOUND',
      jid: '573001234567@s.whatsapp.net',
      pushName: 'Ana Recruiter',
      kind: 'TEXT',
      text: 'Hola',
      timestamp: '2026-09-25T20:15:03.000Z',
    },
  ]);
});

test('un fromMe no registrado llega como OWNER', async () => {
  const eventos = [];
  const socket = socketFalso();

  await clienteConectado(socket, {
    onMessage: (evento) => eventos.push(evento),
  });

  upsert(
    socket,
    'notify',
    mensajeTexto({
      id: 'OW1',
      fromMe: true,
      remoteJid: '573001234567@s.whatsapp.net',
      text: 'Hola Ana, soy Daniel',
    })
  );

  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].direction, 'OWNER');
  assert.equal(eventos[0].pushName, null);
  assert.equal(eventos[0].text, 'Hola Ana, soy Daniel');
});

test('"Mensaje a mi mismo" no se reenvia aunque el id del socket traiga dispositivo', async () => {
  const eventos = [];
  const socket = socketFalso();

  await clienteConectado(socket, {
    onMessage: (evento) => eventos.push(evento),
  });

  upsert(
    socket,
    'notify',
    mensajeTexto({ id: 'ME1', fromMe: true, remoteJid: '573110000000@s.whatsapp.net' })
  );

  assert.deepEqual(eventos, []);
});

test('una excepcion de onMessage no corta los demas mensajes del upsert', async (t) => {
  t.mock.method(console, 'error', () => {});
  const recibidos = [];
  const socket = socketFalso();

  await clienteConectado(socket, {
    onMessage: (evento) => {
      recibidos.push(evento.messageId);

      if (evento.messageId === 'X1') {
        throw new Error('boom');
      }
    },
  });

  socket.ev.emit('messages.upsert', {
    type: 'notify',
    messages: [
      mensajeTexto({ id: 'X1', remoteJid: '573001234567@s.whatsapp.net' }),
      mensajeTexto({ id: 'X2', remoteJid: '573001234567@s.whatsapp.net' }),
    ],
  });

  assert.deepEqual(recibidos, ['X1', 'X2']);
});

test('sin onMessage no se clasifica ni se reenvia nada', async () => {
  const socket = socketFalso();

  await clienteConectado(socket);

  assert.doesNotThrow(() =>
    upsert(
      socket,
      'notify',
      mensajeTexto({ id: 'N1', remoteJid: '573001234567@s.whatsapp.net' })
    )
  );
});

test('onMessage recibe también el mensaje de Baileys, para descargar su imagen', async () => {
  const socket = socketFalso();
  const recibidos = [];
  await clienteConectado(socket, { onMessage: (...args) => recibidos.push(args) });
  const foto = {
    key: { id: 'FOTO1', fromMe: false, remoteJid: '573007046858@s.whatsapp.net' },
    message: { imageMessage: { mimetype: 'image/jpeg' } },
    messageTimestamp: 1790367303,
  };

  upsert(socket, 'notify', foto);

  assert.equal(recibidos.length, 1);
  assert.equal(recibidos[0][0].messageId, 'FOTO1');
  assert.equal(recibidos[0][1], foto);
});

test('downloadImage descarga con la sesión actual y le deja pedir la resubida', async () => {
  const socket = socketFalso();
  socket.logger = { nombre: 'logger de baileys' };
  socket.updateMediaMessage = async () => {};
  const llamadas = [];
  const cliente = await clienteConectado(socket, {
    downloadMedia: async (...args) => {
      llamadas.push(args);
      return Buffer.from('foto');
    },
  });
  const foto = { key: { id: 'FOTO1' } };

  const imagen = await cliente.downloadImage(foto);

  assert.equal(imagen.toString(), 'foto');
  assert.equal(llamadas[0][0], foto);
  assert.equal(llamadas[0][1], 'buffer');
  assert.equal(llamadas[0][3].logger, socket.logger);
  assert.equal(llamadas[0][3].reuploadRequest, socket.updateMediaMessage);
});

test('downloadImage sin conexión falla', async () => {
  const cliente = createWhatsAppClient({ downloadMedia: async () => Buffer.from('x') });

  await assert.rejects(() => cliente.downloadImage({}), /no está conectado/);
});

test('un chat que llega solo como @lid se reenvia con el numero que Baileys conoce', async () => {
  const socket = socketFalso();
  const consultados = [];
  socket.signalRepository = {
    lidMapping: {
      async getPNForLID(lid) {
        consultados.push(lid);
        return '573127655754:0@s.whatsapp.net';
      },
    },
  };
  const recibidos = [];
  await clienteConectado(socket, { onMessage: (evento) => recibidos.push(evento) });

  upsert(socket, 'notify', mensajeTexto({ id: 'L1', remoteJid: '142060388622446@lid' }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(consultados, ['142060388622446@lid']);
  assert.equal(recibidos.length, 1);
  assert.equal(recibidos[0].jid, '573127655754@s.whatsapp.net');
});

test('un @lid sin numero conocido sigue como @lid', async () => {
  const socket = socketFalso();
  socket.signalRepository = { lidMapping: { getPNForLID: async () => null } };
  const recibidos = [];
  await clienteConectado(socket, { onMessage: (evento) => recibidos.push(evento) });

  upsert(socket, 'notify', mensajeTexto({ id: 'L2', remoteJid: '142060388622446@lid' }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(recibidos.length, 1);
  assert.equal(recibidos[0].jid, '142060388622446@lid');
});

test('un @lid que ya trae el numero no consulta a Baileys', async () => {
  const socket = socketFalso();
  socket.signalRepository = {
    lidMapping: {
      getPNForLID: async () => assert.fail('no debia consultar'),
    },
  };
  const recibidos = [];
  await clienteConectado(socket, { onMessage: (evento) => recibidos.push(evento) });
  const mensaje = mensajeTexto({ id: 'L3', remoteJid: '142060388622446@lid' });
  mensaje.key.remoteJidAlt = '573127655754@s.whatsapp.net';

  upsert(socket, 'notify', mensaje);

  assert.equal(recibidos.length, 1);
  assert.equal(recibidos[0].jid, '573127655754@s.whatsapp.net');
});
