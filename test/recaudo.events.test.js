import test from 'node:test';
import assert from 'node:assert/strict';

import { toRecaudoMessage } from '../src/clients/recaudo.events.js';

const CARLOS = '573007046858@s.whatsapp.net';

// Evento ya clasificado por toPerlaEvent.
function evento(overrides = {}) {
  return {
    messageId: 'MSG1',
    direction: 'INBOUND',
    jid: CARLOS,
    pushName: 'Carlos',
    kind: 'UNSUPPORTED',
    text: null,
    timestamp: '2026-10-13T15:00:00.000Z',
    ...overrides,
  };
}

function conImagen(imageMessage) {
  return { key: { id: 'MSG1', remoteJid: CARLOS }, message: { imageMessage } };
}

test('foto con leyenda: IMAGE con el número, la leyenda y el tipo', () => {
  assert.deepEqual(
    toRecaudoMessage(evento(), conImagen({ mimetype: 'image/jpeg', caption: 'recibo de hoy', fileLength: 120000 })),
    {
      messageId: 'MSG1',
      jid: CARLOS,
      phone: '573007046858',
      receivedAt: '2026-10-13T15:00:00.000Z',
      kind: 'IMAGE',
      text: 'recibo de hoy',
      mimeType: 'image/jpeg',
      fileLength: 120000,
    }
  );
});

test('foto sin leyenda ni tipo, con fileLength como Long', () => {
  const resultado = toRecaudoMessage(
    evento(),
    conImagen({ fileLength: { toNumber: () => 2048 } })
  );

  assert.equal(resultado.kind, 'IMAGE');
  assert.equal(resultado.text, null);
  assert.equal(resultado.mimeType, 'image/jpeg');
  assert.equal(resultado.fileLength, 2048);
});

test('foto de "ver una vez": se desenvuelve como cualquier foto', () => {
  const resultado = toRecaudoMessage(evento(), {
    message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/png' } } } },
  });

  assert.equal(resultado.kind, 'IMAGE');
  assert.equal(resultado.mimeType, 'image/png');
});

test('texto: pasa el tipo y el texto del evento', () => {
  const resultado = toRecaudoMessage(
    evento({ kind: 'TEXT', text: 'hola' }),
    { message: { conversation: 'hola' } }
  );

  assert.equal(resultado.kind, 'TEXT');
  assert.equal(resultado.text, 'hola');
  assert.equal(resultado.image, undefined);
});

test('audio u otro contenido: UNSUPPORTED', () => {
  const resultado = toRecaudoMessage(evento(), { message: { audioMessage: { seconds: 3 } } });

  assert.equal(resultado.kind, 'UNSUPPORTED');
});

test('el contenedor de un álbum no se reenvía: llegan sus fotos una a una', () => {
  assert.equal(
    toRecaudoMessage(evento(), { message: { albumMessage: { expectedImageCount: 3 } } }),
    null
  );
});

test('lo que Daniel escribe desde el teléfono (OWNER) no va a recaudo', () => {
  assert.equal(
    toRecaudoMessage(evento({ direction: 'OWNER' }), conImagen({ mimetype: 'image/jpeg' })),
    null
  );
});

test('un @lid sin número de teléfono no se puede asociar a un vendedor', () => {
  assert.equal(
    toRecaudoMessage(evento({ jid: '123456789012345@lid' }), conImagen({ mimetype: 'image/jpeg' })),
    null
  );
});

test('sin evento (ignorado por toPerlaEvent) no hay mensaje', () => {
  assert.equal(toRecaudoMessage(null, conImagen({})), null);
});
