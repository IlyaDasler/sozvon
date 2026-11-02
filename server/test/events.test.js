import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, befriend, reg } = server);
});

after(() => server.stop());

test('событие канала: публикация, готовность и «готов в другое время»', async () => {
  const owner = await reg('event_owner');
  const friend = await reg('event_friend');
  await befriend(owner, friend);

  const hub = (await api('POST', '/hubs', { name: 'События' }, owner.token)).body;
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [friend.user.id] }, owner.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, friend.token);
  const room = (await api('POST', '/rooms', { name: 'Игры', kind: 'text', hubId: hub.id }, owner.token)).body;

  const at = Date.now() + 3 * 60 * 60_000;
  const created = await api('POST', `/rooms/${room.id}/events`, { title: 'Broken Arrow', startsAt: at, invitees: [friend.user.id] }, owner.token);
  assert.equal(created.status, 200);
  const event = created.body.events[0];
  assert.equal(event.title, 'Broken Arrow');
  // Автор сразу «буду», приглашённый отмечен как приглашённый
  assert.deepEqual(
    event.responses.map((r) => [r.userId, r.status]).sort(),
    [[owner.user.id, 'yes'], [friend.user.id, 'invited']].sort()
  );

  // Друг отмечает «готов в 21:30» — время сохраняется
  const readyAt = at + 30 * 60_000;
  const answered = await api('PUT', `/events/${event.id}/response`, { status: 'maybe', readyAt }, friend.token);
  assert.equal(answered.status, 200);
  const mine = answered.body.events[0].responses.find((r) => r.userId === friend.user.id);
  assert.equal(mine.status, 'maybe');
  assert.equal(mine.readyAt, readyAt);

  // Без времени «maybe» не принимается
  assert.equal((await api('PUT', `/events/${event.id}/response`, { status: 'maybe' }, friend.token)).status, 400);

  // Неизвестный ответ и пустое название
  assert.equal((await api('PUT', `/events/${event.id}/response`, { status: 'zzz' }, friend.token)).status, 400);
  assert.equal((await api('POST', `/rooms/${room.id}/events`, { title: '  ', startsAt: at }, owner.token)).status, 400);

  // Событие видно в комнате, а чужая комната его не отдаёт
  const rooms = (await api('GET', '/rooms', null, owner.token)).body;
  assert.equal(rooms.find((r) => r.id === room.id).events.length, 1);
  const otherHub = (await api('POST', '/hubs', { name: 'Другой' }, owner.token)).body;
  const otherRoom = (await api('POST', '/rooms', { name: 'Там', kind: 'text', hubId: otherHub.id }, owner.token)).body;
  assert.equal(otherRoom.events.length, 0);

  // Удалить может автор; друг — нет
  assert.equal((await api('DELETE', `/events/${event.id}`, null, friend.token)).status, 403);
  assert.equal((await api('DELETE', `/events/${event.id}`, null, owner.token)).status, 200);
  const after = (await api('GET', '/rooms', null, owner.token)).body.find((r) => r.id === room.id);
  assert.equal(after.events.length, 0);
});
