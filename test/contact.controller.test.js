import test from 'node:test';
import assert from 'node:assert/strict';

import { createContactController } from '../src/controllers/contact.controller.js';

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

const servicioOk = () => ({ send: async () => ({ id: 'ok' }) });
const servicioCaido = (mensaje) => ({
  send: async () => {
    throw new Error(mensaje);
  },
});

function controlador({ emailService, whatsappService }) {
  return createContactController({
    emailService,
    whatsappService,
    whatsappToNumber: () => '573001112233',
  });
}

test('400 cuando falta algun campo obligatorio', async () => {
  const res = respuestaFalsa();

  await controlador({
    emailService: servicioOk(),
    whatsappService: servicioOk(),
  }).send({ body: { name: 'Ana' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.cuerpo.error, 'name, email y message son requeridos');
});

test('400 cuando el cuerpo viene vacio', async () => {
  const res = respuestaFalsa();

  await controlador({
    emailService: servicioOk(),
    whatsappService: servicioOk(),
  }).send({}, res);

  assert.equal(res.statusCode, 400);
});

test('200 sin clave errors cuando los dos canales responden', async () => {
  const res = respuestaFalsa();

  await controlador({
    emailService: servicioOk(),
    whatsappService: servicioOk(),
  }).send(
    { body: { name: 'Ana', email: 'ana@example.com', message: 'hola' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.cuerpo.errors, undefined);
  assert.deepEqual(res.cuerpo.results, {
    email: { id: 'ok' },
    whatsapp: { id: 'ok' },
  });
});

test('207 y el otro canal sigue enviando cuando el email falla', async () => {
  const res = respuestaFalsa();

  await controlador({
    emailService: servicioCaido('resend caido'),
    whatsappService: servicioOk(),
  }).send(
    { body: { name: 'Ana', email: 'ana@example.com', message: 'hola' } },
    res
  );

  assert.equal(res.statusCode, 207);
  assert.equal(res.cuerpo.errors.email, 'resend caido');
  assert.equal(res.cuerpo.errors.whatsapp, undefined);
  assert.deepEqual(res.cuerpo.results.whatsapp, { id: 'ok' });
});

test('207 con los dos errores cuando ambos canales fallan', async () => {
  const res = respuestaFalsa();

  await controlador({
    emailService: servicioCaido('resend caido'),
    whatsappService: servicioCaido('whatsapp no conectado'),
  }).send(
    { body: { name: 'Ana', email: 'ana@example.com', message: 'hola' } },
    res
  );

  assert.equal(res.statusCode, 207);
  assert.equal(res.cuerpo.errors.email, 'resend caido');
  assert.equal(res.cuerpo.errors.whatsapp, 'whatsapp no conectado');
  assert.equal(res.cuerpo.results.email, null);
});

test('el numero destino de WhatsApp se lee al momento de enviar', async () => {
  const res = respuestaFalsa();
  let recibido = null;

  const controladorConNumero = createContactController({
    emailService: servicioOk(),
    whatsappService: {
      send: async (payload) => {
        recibido = payload;
        return { id: 'ok' };
      },
    },
    whatsappToNumber: () => '573009998877',
  });

  await controladorConNumero.send(
    { body: { name: 'Ana', email: 'ana@example.com', message: 'hola' } },
    res
  );

  assert.equal(recibido.phone, '573009998877');
  assert.match(recibido.text, /Nombre: Ana/);
});
