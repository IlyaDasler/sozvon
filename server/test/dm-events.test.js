// События личной переписки: каждая сторона видит чат со своей стороны — собеседник в peerId, «моё» про себя
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, connect, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, connect, befriend, reg } = server);
});

after(() => server.stop());

async function pair(prefix) {
  const a = await reg(`${prefix}_a`);
  const b = await reg(`${prefix}_b`);
  await befriend(a, b);
  const message = (await api('POST', `/messages/${b.user.id}`, { text: 'привет' }, a.token)).body;
  return { a, b, message };
}

test('реакция: получатель видит чат с автором реакции и не считает её своей', async () => {
  const { a, b, message } = await pair('react');
  const cb = connect(b.token);
  await cb.open;
  await api('POST', `/messages/${b.user.id}/${message.id}/reactions`, { emoji: '👍' }, a.token);
  const event = await cb.next('message:reactions');
  assert.equal(event.peerId, a.user.id);
  assert.equal(event.reactions[0].count, 1);
  assert.equal(event.reactions[0].mine, false);
});

test('закреп: виден обоим, у получателя событие про чат с тем, кто закрепил', async () => {
  const { a, b, message } = await pair('pin');
  const cb = connect(b.token);
  await cb.open;
  await api('PUT', `/messages/${b.user.id}/${message.id}/pin`, null, a.token);
  assert.equal((await cb.next('message:pinned')).peerId, a.user.id);
  assert.deepEqual((await api('GET', `/messages/${b.user.id}/pins`, null, a.token)).body.map((m) => m.id), [message.id]);
  assert.deepEqual((await api('GET', `/messages/${a.user.id}/pins`, null, b.token)).body.map((m) => m.id), [message.id]);
  // В истории закреп отмечен у обоих
  for (const [peer, token] of [[b, a.token], [a, b.token]]) assert.equal((await api('GET', `/messages/${peer.user.id}`, null, token)).body[0].pinned, true);
  await api('DELETE', `/messages/${a.user.id}/${message.id}/pin`, null, b.token);
  assert.equal((await cb.next('message:pinned')).pinned, false);
  assert.deepEqual((await api('GET', `/messages/${b.user.id}/pins`, null, a.token)).body, []);
});

test('ответ в комнате: номер совпадает с личным сообщением — отвечаем на сообщение комнаты', async () => {
  const a = await reg('rep_a');
  const b = await reg('rep_b');
  await befriend(a, b);
  const room = (await api('POST', '/rooms', { name: 'общая', kind: 'text', memberIds: [b.user.id] }, a.token)).body;
  // Счётчики сообщений у личных чатов и комнат свои: дожимаем личные, пока в них не появится такой же номер
  const target = (await api('POST', `/rooms/${room.id}/messages`, { text: 'в комнате' }, a.token)).body;
  let dm;
  do dm = (await api('POST', `/messages/${b.user.id}`, { text: 'личное' }, a.token)).body;
  while (dm.id < target.id);

  const reply = await api('POST', `/rooms/${room.id}/messages`, { text: 'ответ', replyToId: target.id }, b.token);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.replyTo, target.id);
  assert.equal((await api('POST', `/rooms/${room.id}/messages`, { text: 'чужое', replyToId: dm.id + 1000 }, b.token)).status, 400);
});
