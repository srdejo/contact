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
