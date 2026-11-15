const test = require('node:test');
const assert = require('node:assert/strict');
const { initState, encrypt, decrypt } = require('../renderer/ratchet-core');

test('symmetric ratchet encrypts/decrypts in order', async () => {
  const root = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const a = await initState(root, 'a');
  const b = await initState(root, 'b');
  const m1 = await encrypt(a, { text: 'one' }, 'dm:1-2|1');
  const m2 = await encrypt(a, { text: 'two' }, 'dm:1-2|1');
  assert.deepEqual(await decrypt(b, m1, 'dm:1-2|1'), { text: 'one' });
  assert.deepEqual(await decrypt(b, m2, 'dm:1-2|1'), { text: 'two' });
});

test('symmetric ratchet handles out-of-order messages', async () => {
  const root = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const a = await initState(root, 'a');
  const b = await initState(root, 'b');
  const m1 = await encrypt(a, { text: 'one' }, 'dm:1-2|1');
  const m2 = await encrypt(a, { text: 'two' }, 'dm:1-2|1');
  assert.deepEqual(await decrypt(b, m2, 'dm:1-2|1'), { text: 'two' });
  assert.deepEqual(await decrypt(b, m1, 'dm:1-2|1'), { text: 'one' });
});

test('symmetric ratchet rejects changed aad', async () => {
  const root = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const a = await initState(root, 'a');
  const b = await initState(root, 'b');
  const m1 = await encrypt(a, { text: 'one' }, 'dm:1-2|1');
  await assert.rejects(() => decrypt(b, m1, 'dm:1-3|1'));
});