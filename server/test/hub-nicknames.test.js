import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, befriend, reg } = server);
});

after(() => server.stop());

test('имя в канале: меняет управляющий, видно только в этом канале', async () => {
  const owner = await reg('nick_owner');
  const friend = await reg('nick_friend');
  await befriend(owner, friend);

  const hub = (await api('POST', '/hubs', { name: 'Канал' }, owner.token)).body;
  assert.equal((await api('POST', `/hubs/${hub.id}/invites`, { userIds: [friend.user.id] }, owner.token)).status, 200);
  assert.equal((await api('POST', `/hub-invites/${hub.id}/accept`, null, friend.token)).status, 200);
  const room = (await api('POST', '/rooms', { name: 'Общий', kind: 'text', hubId: hub.id }, owner.token)).body;

  // Своё имя в канале
  const renamed = await api('PUT', `/hubs/${hub.id}/members/${friend.user.id}/nickname`, { name: 'Петя' }, owner.token);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.members.find((m) => m.id === friend.user.id).nickname, 'Петя');

  // Оно же приходит и в комнатах канала
  const rooms = (await api('GET', '/rooms', null, owner.token)).body;
  assert.equal(rooms.find((r) => r.id === room.id).members.find((m) => m.id === friend.user.id).nickname, 'Петя');

  // В другом канале имя остаётся настоящим
  const other = (await api('POST', '/hubs', { name: 'Второй' }, owner.token)).body;
  await api('POST', `/hubs/${other.id}/invites`, { userIds: [friend.user.id] }, owner.token);
  await api('POST', `/hub-invites/${other.id}/accept`, null, friend.token);
  const otherRoom = (await api('POST', '/rooms', { name: 'Там', kind: 'text', hubId: other.id }, owner.token)).body;
  assert.equal(otherRoom.members.find((m) => m.id === friend.user.id).nickname, null);

  // Пустое имя и слишком длинное не проходят
  assert.equal((await api('PUT', `/hubs/${hub.id}/members/${friend.user.id}/nickname`, { name: '   ' }, owner.token)).status, 400);
  assert.equal((await api('PUT', `/hubs/${hub.id}/members/${friend.user.id}/nickname`, { name: 'я'.repeat(33) }, owner.token)).status, 400);

  // Обычный участник менять не может
  assert.equal((await api('PUT', `/hubs/${hub.id}/members/${owner.user.id}/nickname`, { name: 'Я' }, friend.token)).status, 403);

  // Сброс возвращает настоящее имя
  const reset = await api('DELETE', `/hubs/${hub.id}/members/${friend.user.id}/nickname`, null, owner.token);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.members.find((m) => m.id === friend.user.id).nickname, null);
});
