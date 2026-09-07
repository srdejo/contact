import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveFrom } from '../src/clients/gmail.client.js';

test('sin datos usa GMAIL_FROM, que es el remitente por defecto del servicio', () => {
  process.env.GMAIL_USER = 'cuenta@example.com';
  process.env.GMAIL_FROM = 'SRDEJO <cuenta@example.com>';

  assert.equal(resolveFrom({}), 'SRDEJO <cuenta@example.com>');
});

test('sin GMAIL_FROM cae a la cuenta autenticada', () => {
  process.env.GMAIL_USER = 'cuenta@example.com';
  delete process.env.GMAIL_FROM;

  assert.equal(resolveFrom({}), 'cuenta@example.com');
});

test('fromName cambia el nombre visible y conserva la dirección de la cuenta', () => {
  process.env.GMAIL_USER = 'cuenta@example.com';
  process.env.GMAIL_FROM = 'SRDEJO <cuenta@example.com>';

  assert.deepEqual(resolveFrom({ fromName: 'Mi Casa Church' }), {
    name: 'Mi Casa Church',
    address: 'cuenta@example.com',
  });
});

test('un from explícito sigue mandando, por compatibilidad', () => {
  assert.equal(
    resolveFrom({ from: 'Otro <otro@example.com>', fromName: 'Ignorado' }),
    'Otro <otro@example.com>'
  );
});

test('un fromName vacío o en blanco no gana sobre el remitente por defecto', () => {
  process.env.GMAIL_USER = 'cuenta@example.com';
  process.env.GMAIL_FROM = 'SRDEJO <cuenta@example.com>';

  assert.equal(resolveFrom({ fromName: '   ' }), 'SRDEJO <cuenta@example.com>');
  assert.equal(resolveFrom({ fromName: 42 }), 'SRDEJO <cuenta@example.com>');
});

test('un fromName con saltos de línea no puede inyectar cabeceras', () => {
  process.env.GMAIL_USER = 'cuenta@example.com';

  const resultado = resolveFrom({
    fromName: 'Hotel\r\nBcc: victima@example.com',
  });

  assert.equal(resultado.name, 'Hotel Bcc: victima@example.com');
  assert.doesNotMatch(resultado.name, /[\r\n]/);
});
