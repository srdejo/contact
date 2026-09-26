import test from 'node:test';
import assert from 'node:assert/strict';

import { createWhatsAppController } from '../src/controllers/whatsapp.controller.js';

function respuestaFalsa() {
  return {
    statusCode: 200,
    cuerpo: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.cuerpo = payload;
      return this;
    },
  };
}

test('400 cuando falta text', async () => {
  const res = respuestaFalsa();

  await createWhatsAppController({
    whatsappService: { send: async () => ({}), status: () => ({}) },
  }).send({ body: { phone: '573001112233' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.cuerpo.error, 'text y phone o jid son requeridos');
});

test('400 cuando no hay ni phone ni jid', async () => {
  const res = respuestaFalsa();
  let enviado = false;

  await createWhatsAppController({
    whatsappService: {
      send: async () => {
        enviado = true;
      },
      status: () => ({}),
    },
  }).send({ body: { text: 'Hola' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.cuerpo.error, 'text y phone o jid son requeridos');
  assert.equal(enviado, false);
});

test('200 con envio por jid', async () => {
  const res = respuestaFalsa();
  let recibido = null;

  await createWhatsAppController({
    whatsappService: {
      send: async (payload) => {
        recibido = payload;
        return { key: { id: 'JID1' } };
      },
      status: () => ({}),
    },
  }).send(
    { body: { jid: '573001234567@s.whatsapp.net', text: 'Hola' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.cuerpo, { status: 'ok', messageId: 'JID1' });
  assert.deepEqual(recibido, {
    jid: '573001234567@s.whatsapp.net',
    text: 'Hola',
  });
});

test('jid gana sobre phone', async () => {
  const res = respuestaFalsa();
  let recibido = null;

  await createWhatsAppController({
    whatsappService: {
      send: async (payload) => {
        recibido = payload;
        return { key: { id: 'JID2' } };
      },
      status: () => ({}),
    },
  }).send(
    {
      body: {
        jid: '123456789012345@lid',
        phone: '573009998877',
        text: 'Hola',
      },
    },
    res
  );

  assert.deepEqual(recibido, { jid: '123456789012345@lid', text: 'Hola' });
});

test('200 con el messageId del envio', async () => {
  const res = respuestaFalsa();
  let recibido = null;

  await createWhatsAppController({
    whatsappService: {
      send: async (payload) => {
        recibido = payload;
        return { key: { id: 'ABC123' } };
      },
      status: () => ({}),
    },
  }).send({ body: { phone: '573001112233', text: 'hola' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.cuerpo, { status: 'ok', messageId: 'ABC123' });
  assert.deepEqual(recibido, { phone: '573001112233', text: 'hola' });
});

test('messageId es null si el proveedor no devuelve key', async () => {
  const res = respuestaFalsa();

  await createWhatsAppController({
    whatsappService: { send: async () => undefined, status: () => ({}) },
  }).send({ body: { phone: '573001112233', text: 'hola' } }, res);

  assert.equal(res.cuerpo.messageId, null);
});

test('502 cuando el cliente de WhatsApp falla', async () => {
  const res = respuestaFalsa();

  await createWhatsAppController({
    whatsappService: {
      send: async () => {
        throw new Error('WhatsApp no está conectado');
      },
      status: () => ({}),
    },
  }).send({ body: { phone: '573001112233', text: 'hola' } }, res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.cuerpo.error, 'WhatsApp no está conectado');
});

test('status devuelve lo que reporta el cliente', () => {
  const res = respuestaFalsa();

  createWhatsAppController({
    whatsappService: {
      send: async () => ({}),
      status: () => ({ status: 'QR_REQUIRED', connected: false }),
    },
  }).status({}, res);

  assert.deepEqual(res.cuerpo, { status: 'QR_REQUIRED', connected: false });
});
