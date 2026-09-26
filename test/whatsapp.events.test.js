import test from 'node:test';
import assert from 'node:assert/strict';

import { toPerlaEvent } from '../src/clients/whatsapp.events.js';

const ANA = '573001234567@s.whatsapp.net';
const PERSONAL = '573009998877';
const OWN_PN = '573110000000@s.whatsapp.net';
const OWN_LID = '999888777666555@lid';

// Mensaje con la forma de Baileys; `overrides` pisa campos sueltos.
function mensaje({ key = {}, message = { conversation: 'Hola' }, ...rest } = {}) {
  return {
    key: { id: 'MSG1', fromMe: false, remoteJid: ANA, ...key },
    message,
    messageTimestamp: 1790367303,
    pushName: 'Ana Recruiter',
    ...rest,
  };
}

function clasificar(m, opciones = {}) {
  return toPerlaEvent(m, {
    isSentByApi: () => false,
    isIgnoredNumber: (digits) => digits === PERSONAL,
    ownJids: [OWN_PN, OWN_LID],
    ...opciones,
  });
}

// --- Forma del evento -------------------------------------------------------

test('texto de un interlocutor con nombre de perfil', () => {
  assert.deepEqual(
    clasificar(mensaje({ message: { conversation: '¿Qué experiencia tiene con Kafka?' } })),
    {
      messageId: 'MSG1',
      direction: 'INBOUND',
      jid: ANA,
      pushName: 'Ana Recruiter',
      kind: 'TEXT',
      text: '¿Qué experiencia tiene con Kafka?',
      timestamp: '2026-09-25T20:15:03.000Z',
    }
  );
});

test('sin nombre de perfil, pushName es null', () => {
  assert.equal(clasificar(mensaje({ pushName: undefined })).pushName, null);
});

test('nota de voz: UNSUPPORTED sin texto', () => {
  const evento = clasificar(
    mensaje({ message: { audioMessage: { ptt: true, seconds: 4 } } })
  );

  assert.equal(evento.kind, 'UNSUPPORTED');
  assert.equal(evento.text, null);
});

test('imagen, documento, sticker y ubicacion: UNSUPPORTED', () => {
  for (const message of [
    { imageMessage: { caption: 'mi cv' } },
    { documentMessage: { fileName: 'cv.pdf' } },
    { stickerMessage: {} },
    { locationMessage: { degreesLatitude: 4.6 } },
  ]) {
    assert.equal(clasificar(mensaje({ message })).kind, 'UNSUPPORTED');
  }
});

test('texto con enlace: TEXT con el texto completo', () => {
  const evento = clasificar(
    mensaje({
      message: {
        extendedTextMessage: {
          text: 'Mira la vacante https://example.com/job',
          matchedText: 'https://example.com/job',
        },
      },
    })
  );

  assert.equal(evento.kind, 'TEXT');
  assert.equal(evento.text, 'Mira la vacante https://example.com/job');
});

test('texto de 5000 caracteres: va entero, sin recortar', () => {
  const largo = 'a'.repeat(5000);

  assert.equal(
    clasificar(mensaje({ message: { conversation: largo } })).text.length,
    5000
  );
});

test('mensaje efimero: se clasifica por su contenido interior', () => {
  const evento = clasificar(
    mensaje({
      message: { ephemeralMessage: { message: { conversation: 'Hola' } } },
    })
  );

  assert.equal(evento.kind, 'TEXT');
  assert.equal(evento.text, 'Hola');
});

test('messageTimestamp como Long', () => {
  const long = { low: 1790367303, high: 0, toNumber: () => 1790367303 };

  assert.equal(
    clasificar(mensaje({ messageTimestamp: long })).timestamp,
    '2026-09-25T20:15:03.000Z'
  );
});

test('fromMe no registrado: OWNER sin pushName', () => {
  const evento = clasificar(
    mensaje({ key: { fromMe: true }, message: { conversation: 'Hola Ana, soy Daniel' } })
  );

  assert.equal(evento.direction, 'OWNER');
  assert.equal(evento.jid, ANA);
  assert.equal(evento.pushName, null);
});

test('fromMe registrado como enviado por la API: se ignora', () => {
  assert.equal(
    clasificar(mensaje({ key: { fromMe: true } }), {
      isSentByApi: (id) => id === 'MSG1',
    }),
    null
  );
});

test('un INBOUND no se ignora aunque su ID coincida con uno registrado', () => {
  assert.equal(
    clasificar(mensaje(), { isSentByApi: () => true }).direction,
    'INBOUND'
  );
});

// --- JID de telefono antes que @lid -----------------------------------------

test('@lid con remoteJidAlt de telefono: va el de telefono', () => {
  assert.equal(
    clasificar(
      mensaje({ key: { remoteJid: '123456789012345@lid', remoteJidAlt: ANA } })
    ).jid,
    ANA
  );
});

test('@lid con senderPn de telefono: va el de telefono', () => {
  assert.equal(
    clasificar(
      mensaje({ key: { remoteJid: '123456789012345@lid', senderPn: ANA } })
    ).jid,
    ANA
  );
});

test('solo @lid: va el @lid', () => {
  assert.equal(
    clasificar(mensaje({ key: { remoteJid: '123456789012345@lid' } })).jid,
    '123456789012345@lid'
  );
});

// --- Que se ignora sin reenviar ---------------------------------------------

test('grupo', () => {
  assert.equal(
    clasificar(mensaje({ key: { remoteJid: '120363000000000000@g.us' } })),
    null
  );
});

test('estado (status@broadcast) y listas de difusion', () => {
  assert.equal(clasificar(mensaje({ key: { remoteJid: 'status@broadcast' } })), null);
  assert.equal(clasificar(mensaje({ key: { remoteJid: '1234567890@broadcast' } })), null);
});

test('newsletter', () => {
  assert.equal(
    clasificar(mensaje({ key: { remoteJid: '120363111111111111@newsletter' } })),
    null
  );
});

test('llamadas', () => {
  assert.equal(clasificar(mensaje({ message: { callLogMesssage: { isVideo: false } } })), null);
  assert.equal(clasificar(mensaje({ message: { bcallMessage: { sessionId: 'x' } } })), null);
});

test('reaccion', () => {
  assert.equal(
    clasificar(mensaje({ message: { reactionMessage: { text: '👍', key: { id: 'X' } } } })),
    null
  );
});

test('edicion o borrado (protocolMessage)', () => {
  assert.equal(
    clasificar(mensaje({ message: { protocolMessage: { type: 0, key: { id: 'X' } } } })),
    null
  );
  assert.equal(
    clasificar(
      mensaje({
        message: {
          protocolMessage: {
            type: 14,
            editedMessage: { conversation: 'editado' },
          },
        },
      })
    ),
    null
  );
});

test('mensajes sin contenido: stub, solo claves o sin ID', () => {
  assert.equal(clasificar(mensaje({ message: null })), null);
  assert.equal(
    clasificar(
      mensaje({
        message: {
          senderKeyDistributionMessage: { groupId: 'x' },
          messageContextInfo: {},
        },
      })
    ),
    null
  );
  assert.equal(clasificar(mensaje({ key: { id: undefined } })), null);
});

test('numero personal de Daniel, en los dos sentidos', () => {
  const personal = `${PERSONAL}@s.whatsapp.net`;

  assert.equal(clasificar(mensaje({ key: { remoteJid: personal } })), null);
  assert.equal(
    clasificar(mensaje({ key: { remoteJid: personal, fromMe: true } })),
    null
  );
});

test('numero personal detras de un @lid', () => {
  assert.equal(
    clasificar(
      mensaje({
        key: {
          remoteJid: '123456789012345@lid',
          remoteJidAlt: `${PERSONAL}@s.whatsapp.net`,
        },
      })
    ),
    null
  );
});

test('sin numero personal configurado no se ignora a nadie', () => {
  assert.ok(
    clasificar(mensaje({ key: { remoteJid: `${PERSONAL}@s.whatsapp.net` } }), {
      isIgnoredNumber: () => false,
    })
  );
});

test('"Mensaje a mi mismo" por JID de telefono', () => {
  assert.equal(
    clasificar(mensaje({ key: { remoteJid: OWN_PN, fromMe: true } })),
    null
  );
});

test('"Mensaje a mi mismo" por @lid', () => {
  assert.equal(
    clasificar(mensaje({ key: { remoteJid: OWN_LID, fromMe: true } })),
    null
  );
});
