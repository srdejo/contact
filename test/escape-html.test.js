import test from 'node:test';
import assert from 'node:assert/strict';

import { escaparHtml } from '../src/utils/escape-html.js';

test('escapa los cinco caracteres con significado en HTML', () => {
  assert.equal(
    escaparHtml(`<>&"'`),
    '&lt;&gt;&amp;&quot;&#39;'
  );
});

test('el ampersand se escapa una sola vez (no doble escape)', () => {
  assert.equal(escaparHtml('Tom & Jerry'), 'Tom &amp; Jerry');
  assert.equal(escaparHtml('&lt;'), '&amp;lt;');
});

test('el texto sin caracteres especiales queda igual', () => {
  assert.equal(escaparHtml('Ana Pérez, 3 años'), 'Ana Pérez, 3 años');
});

test('null y undefined dan cadena vacia en vez de "null"', () => {
  assert.equal(escaparHtml(null), '');
  assert.equal(escaparHtml(undefined), '');
});

test('un valor no string se convierte antes de escapar', () => {
  assert.equal(escaparHtml(42), '42');
});
