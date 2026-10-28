// Шифрование переписки на устройстве: ключи людей, ключи переписок, сообщения, файлы и перенос ключа кодом
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../renderer/e2ee-crypto');

test('ключ переписки запечатывается публичным ключом и открывается только своим закрытым', async () => {
  const anya = await E.generateIdentity();
  const borya = await E.generateIdentity();
  assert.equal(Buffer.from(anya.publicKey, 'base64').length, 65);
  const convKey = E.newConvKey();
  const sealed = await E.seal(convKey, borya.publicKey);
  assert.equal(await E.open(sealed, await E.importPrivate(borya.privateJwk)), convKey);
  await assert.rejects(E.open(sealed, await E.importPrivate(anya.privateJwk)));
});

test('сообщение: туда и обратно; другая переписка, версия или отправитель — не расшифровать', async () => {
  const key = E.newConvKey();
  const aad = { conv: 'dm:1-2', epoch: 1, from: 1 };
  const payload = { text: 'Привет! **секрет**', files: [{ id: 'abc', name: 'план.txt' }], preview: null };
  const env = await E.encryptMessage(key, payload, aad);
  assert.equal(env.v, 1);
  assert.equal(env.epoch, 1);
  assert.ok(!env.ct.includes('Привет'));
  assert.deepEqual(await E.decryptMessage(key, env, aad), payload);
  await assert.rejects(E.decryptMessage(key, env, { ...aad, conv: 'dm:1-3' }));
  await assert.rejects(E.decryptMessage(key, env, { ...aad, from: 2 }));
  await assert.rejects(E.decryptMessage(E.newConvKey(), env, aad));
});

test('файл: зашифрованные байты не похожи на исходные и расшифровываются своим ключом', async () => {
  const data = new TextEncoder().encode('секретный файл '.repeat(50));
  const { data: enc, key, iv } = await E.encryptFile(data.buffer);
  assert.notDeepEqual(new Uint8Array(enc).slice(0, 16), data.slice(0, 16));
  assert.deepEqual(new Uint8Array(await E.decryptFile(enc, key, iv)), data);
  await assert.rejects(E.decryptFile(enc, E.newConvKey(), iv));
});

test('перенос ключа кодом: код читаемый, регистр и дефисы не важны, чужой код не подходит', async () => {
  const me = await E.generateIdentity();
  const code = E.makeTransferCode();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const id = await E.transferId(code);
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(await E.transferId(code.toLowerCase().replaceAll('-', ' ')), id);
  const blob = await E.wrapIdentity(me, code);
  assert.ok(!blob.includes(me.privateJwk.d));
  assert.deepEqual(await E.unwrapIdentity(blob, code.toLowerCase()), me);
  await assert.rejects(E.unwrapIdentity(blob, E.makeTransferCode()));
});

test('код проверки ключей: у обоих одинаковый, у другой пары — другой', async () => {
  const [a, b, c] = await Promise.all([E.generateIdentity(), E.generateIdentity(), E.generateIdentity()]);
  const ab = await E.keyCode(a.publicKey, b.publicKey);
  assert.deepEqual(await E.keyCode(b.publicKey, a.publicKey), ab);
  assert.notDeepEqual(await E.keyCode(a.publicKey, c.publicKey), ab);
});
