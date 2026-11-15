const test = require('node:test');
const assert = require('node:assert/strict');
const { createState, handshake, rotate, encrypt, decrypt } = require('../renderer/ratchet-dh');

test('dh ratchet bootstraps and decrypts', async () => {
  const root = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const a = await createState(root, 'a');
  const b = await createState(root, 'b');
  await handshake(a, b.local.publicKey);
  await handshake(b, a.local.publicKey);
  const m = await encrypt(a, { text: 'hello' }, 'dm:1-2|1');
  assert.deepEqual(await decrypt(b, m, 'dm:1-2|1'), { text: 'hello' });
});

test('dh ratchet handles rotation', async () => {
  const root = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const a = await createState(root, 'a');
  const b = await createState(root, 'b');
  await handshake(a, b.local.publicKey);
  await handshake(b, a.local.publicKey);
  await encrypt(a, { text: 'one' }, 'dm:1-2|1');
  const pub = await rotate(a);
  const m = await encrypt(a, { text: 'two' }, 'dm:1-2|1');
  assert.equal(m.dh, pub);
  assert.deepEqual(await decrypt(b, m, 'dm:1-2|1'), { text: 'two' });
  await rotate(b);
  const reply = await encrypt(b, { text: 'reply' }, 'dm:1-2|1');
  assert.deepEqual(await decrypt(a, reply, 'dm:1-2|1'), { text: 'reply' });
});