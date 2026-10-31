// Кто поставил реакцию: в личном чате видно всегда, в канале — пока это не выключили в настройках
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, befriend, reg } = server);
});

after(() => server.stop());

async function roomWith(tag) {
  const owner = await reg(`rw_o${tag}`);
  const member = await reg(`rw_m${tag}`);
  const stranger = await reg(`rw_s${tag}`);
  await befriend(owner, member);
  const hub = (await api('POST', '/hubs', { name: 'Реакции' }, owner.token)).body;
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [member.user.id] }, owner.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, member.token);
  const room = (await api('POST', '/rooms', { name: 'чат', kind: 'text', hubId: hub.id }, owner.token)).body;
  const message = (await api('POST', `/rooms/${room.id}/messages`, { text: 'привет' }, owner.token)).body;
  const path = `/rooms/${room.id}/messages/${message.id}/reactions`;
  return { owner, member, stranger, hub, path };
}

test('по умолчанию в канале видно, кто поставил реакцию', async () => {
  const { owner, member, stranger, hub, path } = await roomWith(1);
  assert.equal(hub.reactionsVisible, true);
  await api('POST', path, { emoji: '👍' }, owner.token);
  await api('POST', path, { emoji: '👍' }, member.token);
  await api('POST', path, { emoji: '😂' }, member.token);
  const { status, body } = await api('GET', path, null, member.token);
  assert.equal(status, 200);
  const thumbs = body.find((r) => r.emoji === '👍');
  assert.deepEqual(thumbs.users.map((u) => u.id).sort(), [owner.user.id, member.user.id].sort());
  assert.ok(thumbs.users[0].displayName);
  assert.equal(body.find((r) => r.emoji === '😂').users.length, 1);
  assert.notEqual((await api('GET', path, null, stranger.token)).status, 200, 'посторонний не видит');
});

test('управляющий выключает просмотр: сервер отказывает всем, счётчики остаются', async () => {
  const { owner, member, hub, path } = await roomWith(2);
  await api('POST', path, { emoji: '👍' }, member.token);
  assert.equal((await api('PATCH', `/hubs/${hub.id}`, { reactionsVisible: false }, member.token)).status, 403);
  const off = await api('PATCH', `/hubs/${hub.id}`, { reactionsVisible: false }, owner.token);
  assert.equal(off.body.reactionsVisible, false);
  assert.equal((await api('GET', path, null, member.token)).status, 403);
  assert.equal((await api('GET', path, null, owner.token)).status, 403);
  // Реакции при этом работают
  assert.equal((await api('POST', path, { emoji: '👍' }, owner.token)).body[0].count, 2);

  const on = await api('PATCH', `/hubs/${hub.id}`, { reactionsVisible: true }, owner.token);
  assert.equal(on.body.reactionsVisible, true);
  assert.equal((await api('GET', path, null, member.token)).status, 200);
});

test('сохранение названия не меняет настройку', async () => {
  const { owner, hub } = await roomWith(3);
  await api('PATCH', `/hubs/${hub.id}`, { reactionsVisible: false }, owner.token);
  const saved = await api('PATCH', `/hubs/${hub.id}`, { name: 'Новое' }, owner.token);
  assert.equal(saved.body.reactionsVisible, false);
});

test('в личном чате видно обоим, посторонним нет', async () => {
  const a = await reg('rw_a');
  const b = await reg('rw_b');
  const c = await reg('rw_c');
  await befriend(a, b);
  const message = (await api('POST', `/messages/${b.user.id}`, { text: 'привет' }, a.token)).body;
  await api('POST', `/messages/${a.user.id}/${message.id}/reactions`, { emoji: '👍' }, b.token);
  const seen = await api('GET', `/messages/${b.user.id}/${message.id}/reactions`, null, a.token);
  assert.equal(seen.body[0].users[0].id, b.user.id);
  assert.equal((await api('GET', `/messages/${b.user.id}/${message.id}/reactions`, null, c.token)).status, 404);
});
