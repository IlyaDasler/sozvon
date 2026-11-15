const test = require('node:test');
const assert = require('node:assert/strict');
const { createState, createStaticState, handshake, rotate, encrypt, decrypt, exportState, importState } = require('../renderer/ratchet-dh');

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
test('dh ratchet state survives export/import', async () => {
  const root = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const a = await createState(root, 'a');
  const b = await createState(root, 'b');
  await handshake(a, b.local.publicKey);
  await handshake(b, a.local.publicKey);
  await encrypt(a, { text: 'before' }, 'dm:1-2|1');
  const saved = exportState(b);
  const restored = await importState(JSON.parse(JSON.stringify(saved)));
  const m = await encrypt(a, { text: 'after' }, 'dm:1-2|1');
  assert.deepEqual(await decrypt(restored, m, 'dm:1-2|1'), { text: 'after' });
});

test('static identity ratchet derives matching chains', async () => {
  const root = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const a = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const b = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const aPriv = await crypto.subtle.exportKey('jwk', a.privateKey);
  const bPriv = await crypto.subtle.exportKey('jwk', b.privateKey);
  const aPub = Buffer.from(await crypto.subtle.exportKey('raw', a.publicKey)).toString('base64');
  const bPub = Buffer.from(await crypto.subtle.exportKey('raw', b.publicKey)).toString('base64');
  const sa = await createStaticState(root, 'a', aPriv, aPub, bPub);
  const sb = await createStaticState(root, 'b', bPriv, bPub, aPub);
  const m = await encrypt(sa, { text: 'static' }, 'dm-static');
  assert.deepEqual(await decrypt(sb, m, 'dm-static'), { text: 'static' });
});
