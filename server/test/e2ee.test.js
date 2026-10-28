// Сквозное шифрование переписки, что делает сервер: хранит публичные ключи, ключи переписок, запечатанные
// для каждого участника (открыть их он не может), конверты сообщений вместо текста и одноразовый перенос
// ключа на новое устройство. Сами ключи и тексты сервер не видит — проверяем, что он раздаёт только своим
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, connect, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, connect, befriend, reg } = server);
});

after(() => server.stop());

// Похоже на настоящее: публичный ключ P-256 в виде 65 байт, запечатанный ключ и конверт — base64
const b64 = (n, fill = 7) => Buffer.alloc(n, fill).toString('base64');
const PUB = (fill) => Buffer.concat([Buffer.from([4]), Buffer.alloc(64, fill)]).toString('base64');
const sealed = (fill) => JSON.stringify({ epk: PUB(fill), iv: b64(12, fill), ct: b64(48, fill) });
const envelope = (epoch, fill = 1) => ({ v: 1, epoch, iv: b64(12, fill), ct: b64(64, fill) });
const dm = (a, b) => `dm:${Math.min(a.user.id, b.user.id)}-${Math.max(a.user.id, b.user.id)}`;

test('публичный ключ: ставим себе, друзья видят; сменили — старые запечатанные ключи не годятся', async () => {
  const a = await reg('e2_a');
  const b = await reg('e2_b');
  await befriend(a, b);
  assert.equal((await api('PUT', '/me/key', { publicKey: 'мусор' }, a.token)).status, 400);
  assert.equal((await api('PUT', '/me/key', { publicKey: PUB(1) }, a.token)).body.publicKey, PUB(1));
  const seen = (await api('GET', '/contacts', null, b.token)).body.find((c) => c.id === a.user.id);
  assert.equal(seen.publicKey, PUB(1));

  // Ключ переписки для двоих, потом Аня сменила свой ключ — её запечатанная копия пропадает, Борина остаётся
  await api('PUT', '/me/key', { publicKey: PUB(2) }, b.token);
  const conv = dm(a, b);
  assert.equal((await api('POST', `/keys/${conv}`, { epoch: 1, sealed: { [a.user.id]: sealed(1), [b.user.id]: sealed(2) } }, a.token)).status, 200);
  await api('PUT', '/me/key', { publicKey: PUB(3) }, a.token);
  const mineA = (await api('GET', `/keys/${conv}`, null, a.token)).body;
  assert.deepEqual(mineA.mine, {});
  assert.deepEqual(mineA.missing, [a.user.id]);
  const mineB = (await api('GET', `/keys/${conv}`, null, b.token)).body;
  assert.deepEqual(Object.keys(mineB.mine), ['1']);
});

test('ключ переписки: каждому — только своя копия, чужим нельзя, новая версия — одна, поделиться можно только имея ключ', async () => {
  const a = await reg('e3_a');
  const b = await reg('e3_b');
  const stranger = await reg('e3_s');
  await befriend(a, b);
  for (const [u, f] of [[a, 1], [b, 2], [stranger, 3]]) await api('PUT', '/me/key', { publicKey: PUB(f) }, u.token);
  const conv = dm(a, b);
  const cb = connect(b.token);
  await cb.open;

  // Чужой не участвует в переписке двоих
  assert.equal((await api('GET', `/keys/${conv}`, null, stranger.token)).status, 404);
  assert.equal((await api('POST', `/keys/${conv}`, { epoch: 1, sealed: { [stranger.user.id]: sealed(3) } }, stranger.token)).status, 404);
  // Запечатать можно только участникам; первая версия должна быть и для себя
  assert.equal((await api('POST', `/keys/${conv}`, { epoch: 1, sealed: { [stranger.user.id]: sealed(3) } }, a.token)).status, 400);
  assert.equal((await api('POST', `/keys/${conv}`, { epoch: 1, sealed: { [b.user.id]: sealed(2) } }, a.token)).status, 400);
  // Версия 1 — только от себя; Боря узнаёт сразу
  assert.equal((await api('POST', `/keys/${conv}`, { epoch: 1, sealed: { [a.user.id]: sealed(1) } }, a.token)).status, 200);
  assert.deepEqual(await cb.next('keys:updated'), { type: 'keys:updated', conv });
  // Вторую «первую» версию создать нельзя — кто-то уже успел
  assert.equal((await api('POST', `/keys/${conv}`, { epoch: 1, sealed: { [b.user.id]: sealed(2) } }, b.token)).status, 403);
  assert.equal((await api('POST', `/keys/${conv}`, { epoch: 3, sealed: { [b.user.id]: sealed(2) } }, b.token)).status, 409);

  let keys = (await api('GET', `/keys/${conv}`, null, b.token)).body;
  assert.equal(keys.epoch, 1);
  assert.deepEqual(keys.mine, {});
  assert.deepEqual(keys.missing, [b.user.id]);
  // Аня делится ключом с Борей — Боря получает только свою копию
  assert.equal((await api('POST', `/keys/${conv}`, { epoch: 1, sealed: { [b.user.id]: sealed(2) } }, a.token)).status, 200);
  keys = (await api('GET', `/keys/${conv}`, null, b.token)).body;
  assert.deepEqual(keys.mine, { 1: sealed(2) });
  assert.deepEqual(keys.missing, []);
  // Уже выданную копию поверх не перезаписать
  await api('POST', `/keys/${conv}`, { epoch: 1, sealed: { [b.user.id]: sealed(9) } }, a.token);
  assert.deepEqual((await api('GET', `/keys/${conv}`, null, b.token)).body.mine, { 1: sealed(2) });
  cb.ws.close();
});

test('комната: ключ для участников; выгнали — сервер говорит, что ключ пора сменить', async () => {
  const owner = await reg('e4_owner');
  const guest = await reg('e4_guest');
  await befriend(owner, guest);
  for (const [u, f] of [[owner, 1], [guest, 2]]) await api('PUT', '/me/key', { publicKey: PUB(f) }, u.token);
  const room = (await api('POST', '/rooms', { name: 'Тайная', kind: 'text', memberIds: [guest.user.id] }, owner.token)).body;
  const conv = `room:${room.id}`;
  await api('POST', `/keys/${conv}`, { epoch: 1, sealed: { [owner.user.id]: sealed(1), [guest.user.id]: sealed(2) } }, owner.token);
  assert.equal((await api('GET', `/keys/${conv}`, null, owner.token)).body.rotate, false);
  await api('DELETE', `/rooms/${room.id}/members/${guest.user.id}`, null, owner.token);
  const keys = (await api('GET', `/keys/${conv}`, null, owner.token)).body;
  assert.equal(keys.rotate, true);
  // Новая версия — без выгнанного
  assert.equal((await api('POST', `/keys/${conv}`, { epoch: 2, sealed: { [owner.user.id]: sealed(1) } }, owner.token)).status, 200);
  assert.equal((await api('GET', `/keys/${conv}`, null, owner.token)).body.rotate, false);
  assert.equal((await api('GET', `/keys/${conv}`, null, guest.token)).status, 404);
});

test('зашифрованное сообщение: хранится и уходит конвертом, превью сервер не ищет, старым версиям — заглушка', async () => {
  const a = await reg('e5_a');
  const b = await reg('e5_b');
  await befriend(a, b);
  const conv = dm(a, b);
  await api('PUT', '/me/key', { publicKey: PUB(1) }, a.token);
  const cb = connect(b.token);
  await cb.open;

  // Конверт для версии ключа, которой ещё нет, не принимаем; кривой конверт — тоже
  assert.equal((await api('POST', `/messages/${b.user.id}`, { text: '🔒', enc: envelope(1) }, a.token)).status, 400);
  await api('POST', `/keys/${conv}`, { epoch: 1, sealed: { [a.user.id]: sealed(1) } }, a.token);
  assert.equal((await api('POST', `/messages/${b.user.id}`, { text: '🔒', enc: { v: 1, epoch: 1, iv: 'x', ct: 1 } }, a.token)).status, 400);

  const sent = await api('POST', `/messages/${b.user.id}`, { text: '🔒 Зашифрованное сообщение', enc: envelope(1), previewUrl: 'https://example.com' }, a.token);
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.body.enc, envelope(1));
  assert.equal(sent.body.preview, null);
  assert.deepEqual((await cb.next('message')).message.enc, envelope(1));
  assert.deepEqual((await api('GET', `/messages/${a.user.id}`, null, b.token)).body.at(-1).enc, envelope(1));
  // Обычное (старой версией) — без конверта, как раньше
  assert.equal((await api('POST', `/messages/${b.user.id}`, { text: 'открытым текстом' }, a.token)).body.enc, null);
  cb.ws.close();
});

test('перенос ключа на новое устройство: только своему аккаунту, один раз', async () => {
  const a = await reg('e6_a');
  const other = await reg('e6_other');
  const id = 'ab'.repeat(32);
  assert.equal((await api('POST', '/key-transfer', { id: 'короткий', blob: 'x' }, a.token)).status, 400);
  assert.equal((await api('POST', '/key-transfer', { id, blob: b64(200) }, a.token)).status, 200);
  assert.equal((await api('GET', `/key-transfer/${id}`, null, other.token)).status, 404);
  assert.equal((await api('GET', `/key-transfer/${id}`, null, a.token)).body.blob, b64(200));
  assert.equal((await api('GET', `/key-transfer/${id}`, null, a.token)).status, 404);
});
