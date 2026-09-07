import test from 'node:test';
import assert from 'node:assert/strict';

import { createGmailController } from '../src/controllers/gmail.controller.js';

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

test('400 cuando falta to, subject o html', async () => {
  const res = respuestaFalsa();

  await createGmailController({
    gmailService: { send: async () => ({}) },
  }).send({ body: { to: 'a@example.com', subject: 'hola' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.cuerpo.error, 'to, subject y html son requeridos');
});

test('200 y el from opcional se pasa tal cual al servicio', async () => {
  const res = respuestaFalsa();
  let recibido = null;

  await createGmailController({
    gmailService: {
      send: async (payload) => {
        recibido = payload;
      },
    },
  }).send(
    {
      body: {
        to: 'a@example.com',
        subject: 'hola',
        html: '<p>x</p>',
        from: 'Equipo <no-reply@example.com>',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.cuerpo, { status: 'ok' });
  assert.equal(recibido.from, 'Equipo <no-reply@example.com>');
});

test('502 cuando el envio falla', async () => {
  const res = respuestaFalsa();

  await createGmailController({
    gmailService: {
      send: async () => {
        throw new Error('SMTP caido');
      },
    },
  }).send(
    { body: { to: 'a@example.com', subject: 'hola', html: '<p>x</p>' } },
    res
  );

  assert.equal(res.statusCode, 502);
  assert.equal(res.cuerpo.error, 'SMTP caido');
});
