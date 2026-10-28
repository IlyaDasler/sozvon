// Сходки: свой «сервер» с комнатами внутри, приглашения друзей, права, баны и перенос старых комнат
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { startServer } from './helpers.js';

let server, api, connect, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, connect, befriend, reg } = server);
});

after(() => server.stop());

const hubRooms = async (token, hubId) => (await api('GET', '/rooms', null, token)).body.filter((r) => r.hubId === hubId);

// Позвать в сходку и сразу принять приглашение
async function join(hub, by, who) {
  assert.equal((await api('POST', `/hubs/${hub.id}/invites`, { userIds: [who.user.id] }, by.token)).status, 200);
  const res = await api('POST', `/hub-invites/${hub.id}/accept`, null, who.token);
  assert.equal(res.status, 200);
  return res.body;
}

test('сходки: создание, приглашение, вступление, комнаты внутри, выход и удаление', async () => {
  const owner = await reg('hub_owner');
  const friend = await reg('hub_friend');
  const stranger = await reg('hub_stranger');
  await befriend(owner, friend);

  assert.equal((await api('POST', '/hubs', { name: '' }, owner.token)).status, 400);
  assert.equal((await api('POST', '/hubs', { name: 'x'.repeat(41) }, owner.token)).status, 400);
  const created = await api('POST', '/hubs', { name: 'Подъезд', iconColor: '#30a46c' }, owner.token);
  assert.equal(created.status, 200);
  const hub = created.body;
  assert.equal(hub.name, 'Подъезд');
  assert.equal(hub.iconColor, '#30a46c');
  assert.equal(hub.ownerId, owner.user.id);
  assert.deepEqual(hub.members.map((m) => m.id), [owner.user.id]);
  // В новой сходке сразу есть голосовая и текстовая комнаты
  assert.deepEqual((await hubRooms(owner.token, hub.id)).map((r) => r.kind).sort(), ['text', 'voice']);

  // Чужой сходку не видит и ничего в ней не может
  assert.deepEqual((await api('GET', '/hubs', null, stranger.token)).body, []);
  assert.equal((await api('PATCH', `/hubs/${hub.id}`, { name: 'Моё' }, stranger.token)).status, 404);
  assert.equal((await api('POST', '/rooms', { hubId: hub.id, name: 'Чужая', kind: 'text' }, stranger.token)).status, 404);

  // Звать можно только друзей
  assert.equal((await api('POST', `/hubs/${hub.id}/invites`, { userIds: [stranger.user.id] }, owner.token)).status, 400);
  const cf = connect(friend.token);
  await cf.open;
  const invited = await api('POST', `/hubs/${hub.id}/invites`, { userIds: [friend.user.id] }, owner.token);
  assert.equal(invited.status, 200);
  assert.deepEqual(invited.body.invited, [friend.user.id]);
  const invite = (await cf.next('hub:invite')).invite;
  assert.equal(invite.hub.name, 'Подъезд');
  assert.equal(invite.from.id, owner.user.id);
  assert.deepEqual((await api('GET', '/hub-invites', null, friend.token)).body.map((i) => i.hub.id), [hub.id]);
  // Пока не вступил — комнат сходки не видит
  assert.deepEqual(await hubRooms(friend.token, hub.id), []);
  assert.equal((await api('POST', `/hub-invites/${hub.id}/accept`, null, stranger.token)).status, 404);

  // Вступил — стал участником всех её комнат
  const joined = await api('POST', `/hub-invites/${hub.id}/accept`, null, friend.token);
  assert.equal(joined.status, 200);
  assert.deepEqual(joined.body.members.map((m) => m.id), [owner.user.id, friend.user.id]);
  assert.deepEqual(joined.body.invited, []);
  assert.deepEqual((await api('GET', '/hub-invites', null, friend.token)).body, []);
  const rooms = await hubRooms(friend.token, hub.id);
  assert.equal(rooms.length, 2);
  for (const r of rooms) assert.ok(r.members.some((m) => m.id === friend.user.id));

  // Новая комната в сходке — сразу у всех её участников
  const memes = await api('POST', '/rooms', { hubId: hub.id, name: 'Мемы', kind: 'text' }, owner.token);
  assert.equal(memes.status, 200);
  assert.equal(memes.body.hubId, hub.id);
  assert.deepEqual(memes.body.members.map((m) => m.id).sort(), [owner.user.id, friend.user.id].sort());
  let update;
  do update = await cf.next('room:updated');
  while (update.room.id !== memes.body.id);

  // Обычный участник сходкой не управляет
  assert.equal((await api('POST', '/rooms', { hubId: hub.id, name: 'Моя', kind: 'text' }, friend.token)).status, 403);
  assert.equal((await api('PATCH', `/hubs/${hub.id}`, { name: 'Наш двор' }, friend.token)).status, 403);
  assert.equal((await api('POST', `/hubs/${hub.id}/invites`, { userIds: [owner.user.id] }, friend.token)).status, 403);
  assert.equal((await api('DELETE', `/rooms/${memes.body.id}`, null, friend.token)).status, 403);
  assert.equal((await api('PUT', `/hubs/${hub.id}/members/${friend.user.id}/manager`, { manager: true }, friend.token)).status, 403);

  // Право «управлять сходкой» даёт только создатель
  const promoted = await api('PUT', `/hubs/${hub.id}/members/${friend.user.id}/manager`, { manager: true }, owner.token);
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.members.find((m) => m.id === friend.user.id).manager, true);
  const renamed = await api('PATCH', `/hubs/${hub.id}`, { name: 'Наш двор', iconColor: '#0090ff' }, friend.token);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, 'Наш двор');
  assert.equal((await cf.next('hub:updated')).hub.id, hub.id);
  assert.equal((await api('POST', '/rooms', { hubId: hub.id, name: 'Кино', kind: 'voice' }, friend.token)).status, 200);
  // Управляющий в комнатах сходки — как администратор: переименовывает и удаляет чужие комнаты
  assert.equal((await api('PATCH', `/rooms/${memes.body.id}`, { name: 'Мемасы' }, friend.token)).status, 200);
  assert.equal((await api('DELETE', `/rooms/${memes.body.id}`, null, friend.token)).status, 200);
  // Но удалить сходку может только создатель
  assert.equal((await api('DELETE', `/hubs/${hub.id}`, null, friend.token)).status, 403);

  // Выход: из сходки и всех её комнат
  assert.equal((await api('DELETE', `/hubs/${hub.id}/members/${owner.user.id}`, null, owner.token)).status, 400);
  assert.equal((await api('DELETE', `/hubs/${hub.id}/members/${friend.user.id}`, null, friend.token)).status, 200);
  assert.equal((await cf.next('hub:removed')).reason, 'left');
  assert.deepEqual(await hubRooms(friend.token, hub.id), []);
  assert.deepEqual((await api('GET', '/hubs', null, friend.token)).body, []);

  // Удаление: комнаты пропадают вместе со сходкой, приглашения — тоже
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [friend.user.id] }, owner.token);
  const co = connect(owner.token);
  await co.open;
  const voiceRoom = (await hubRooms(owner.token, hub.id)).find((r) => r.kind === 'voice');
  co.send({ type: 'room:join', roomId: voiceRoom.id });
  await co.next('room:joined');
  assert.equal((await api('DELETE', `/hubs/${hub.id}`, null, owner.token)).status, 200);
  assert.equal((await co.next('room:left')).reason, 'removed');
  assert.equal((await co.next('hub:removed')).hubId, hub.id);
  assert.deepEqual(await hubRooms(owner.token, hub.id), []);
  assert.deepEqual((await api('GET', '/hub-invites', null, friend.token)).body, []);
  for (const c of [cf, co]) c.ws.close();
});

test('сходки: кик и бан из сходки, старшинство, баны комнат при вступлении', async () => {
  const owner = await reg('hb_owner');
  const mod = await reg('hb_mod');
  const guest = await reg('hb_guest');
  await befriend(owner, mod);
  await befriend(owner, guest);
  const hub = (await api('POST', '/hubs', { name: 'Гаражи' }, owner.token)).body;
  await join(hub, owner, mod);
  await join(hub, owner, guest);
  await api('PUT', `/hubs/${hub.id}/members/${mod.user.id}/manager`, { manager: true }, owner.token);

  // Младший не трогает старшего, управляющий — создателя
  assert.equal((await api('DELETE', `/hubs/${hub.id}/members/${mod.user.id}`, null, guest.token)).status, 403);
  assert.equal((await api('DELETE', `/hubs/${hub.id}/members/${owner.user.id}`, null, mod.token)).status, 403);
  assert.equal((await api('POST', `/hubs/${hub.id}/bans`, { userId: owner.user.id }, mod.token)).status, 403);
  assert.equal((await api('POST', `/hubs/${hub.id}/bans`, { userId: mod.user.id }, guest.token)).status, 403);

  // Бан в одной комнате сходки переживает повторное вступление
  const text = (await hubRooms(owner.token, hub.id)).find((r) => r.kind === 'text');
  assert.equal((await api('POST', `/rooms/${text.id}/bans`, { userId: guest.user.id }, mod.token)).status, 200);

  // Кик из сходки: пропадает из всех комнат, но позвать снова можно
  const cg = connect(guest.token);
  await cg.open;
  assert.equal((await api('DELETE', `/hubs/${hub.id}/members/${guest.user.id}`, null, mod.token)).status, 200);
  assert.equal((await cg.next('hub:removed')).reason, 'kicked');
  assert.deepEqual(await hubRooms(guest.token, hub.id), []);
  await join(hub, owner, guest);
  const back = await hubRooms(guest.token, hub.id);
  assert.deepEqual(back.map((r) => r.kind), ['voice']);

  // Бан из сходки: пропадает, и позвать нельзя, пока не снимут
  const banned = await api('POST', `/hubs/${hub.id}/bans`, { userId: guest.user.id }, mod.token);
  assert.equal(banned.status, 200);
  assert.deepEqual(banned.body.bans.map((b) => b.id), [guest.user.id]);
  assert.equal((await cg.next('hub:removed')).reason, 'banned');
  assert.deepEqual(await hubRooms(guest.token, hub.id), []);
  assert.equal((await api('POST', `/hubs/${hub.id}/invites`, { userIds: [guest.user.id] }, owner.token)).status, 400);
  // Старое приглашение тоже не сработает
  assert.equal((await api('POST', `/hub-invites/${hub.id}/accept`, null, guest.token)).status, 404);
  assert.equal((await api('DELETE', `/hubs/${hub.id}/bans/${guest.user.id}`, null, guest.token)).status, 404);
  assert.equal((await api('DELETE', `/hubs/${hub.id}/bans/${guest.user.id}`, null, mod.token)).status, 200);
  await join(hub, owner, guest);

  // Отказ от приглашения
  const other = await reg('hb_other');
  await befriend(owner, other);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [other.user.id] }, owner.token);
  assert.equal((await api('DELETE', `/hub-invites/${hub.id}`, null, other.token)).status, 200);
  assert.equal((await api('POST', `/hub-invites/${hub.id}/accept`, null, other.token)).status, 404);

  // Снять право управлять: снова обычный участник
  await api('PUT', `/hubs/${hub.id}/members/${mod.user.id}/manager`, { manager: false }, owner.token);
  assert.equal((await api('PATCH', `/hubs/${hub.id}`, { name: 'Мои гаражи' }, mod.token)).status, 403);
  cg.ws.close();
});

test('сходки: картинка-иконка', async () => {
  const owner = await reg('hi_owner');
  const hub = (await api('POST', '/hubs', { name: 'С иконкой' }, owner.token)).body;
  assert.equal(hub.iconUrl, null);
  const put = (body, type = 'image/webp') =>
    fetch(`${server.base}/api/hubs/${hub.id}/icon`, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': type, Authorization: `Bearer ${owner.token}` },
    });
  assert.equal((await put(Buffer.from('not an image'))).status, 400);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
  const res = await put(webp);
  assert.equal(res.status, 200);
  const { iconUrl } = await res.json();
  assert.match(iconUrl, /^\/api\/avatars\/[a-f0-9]{32}\.webp$/);
  assert.equal((await fetch(server.base + iconUrl)).status, 200);
  const removed = await api('DELETE', `/hubs/${hub.id}/icon`, null, owner.token);
  assert.equal(removed.body.iconUrl, null);
  assert.equal((await fetch(server.base + iconUrl)).status, 404);
});

test('старые клиенты: комната без сходки попадает в сходку создателя', async () => {
  const owner = await reg('legacy_owner');
  const friend = await reg('legacy_friend');
  await befriend(owner, friend);
  const first = await api('POST', '/rooms', { name: 'Старая', kind: 'voice', memberIds: [friend.user.id] }, owner.token);
  assert.equal(first.status, 200);
  const hubs = (await api('GET', '/hubs', null, owner.token)).body;
  assert.deepEqual(hubs.map((h) => h.name), ['Сходка legacy_owner']);
  assert.equal(first.body.hubId, hubs[0].id);
  // Друг из старого клиента попал в сходку, но только в эту комнату
  assert.deepEqual((await api('GET', '/hubs', null, friend.token)).body.map((h) => h.id), [hubs[0].id]);
  assert.deepEqual((await hubRooms(friend.token, hubs[0].id)).map((r) => r.name), ['Старая']);
  const second = await api('POST', '/rooms', { name: 'Ещё одна', kind: 'text' }, owner.token);
  assert.equal(second.body.hubId, hubs[0].id);
  // И позвать из старого клиента в комнату сходки можно друга, который ещё не в сходке
  const late = await reg('legacy_late');
  await befriend(owner, late);
  assert.equal((await api('POST', `/rooms/${second.body.id}/members`, { userId: late.user.id }, owner.token)).status, 200);
  assert.ok((await api('GET', '/hubs', null, late.token)).body[0].members.some((m) => m.id === late.user.id));
});

test('миграция: комнаты без сходки переезжают в «Сходку <имя создателя>» вместе с участниками', async () => {
  const s = await startServer();
  const owner = await s.reg('mig_owner');
  const friend = await s.reg('mig_friend');
  const other = await s.reg('mig_other');
  await s.befriend(owner, friend);
  await s.api('PATCH', '/me', { displayName: 'Илья' }, owner.token);
  const voice = (await s.api('POST', '/rooms', { name: 'Голос', kind: 'voice', memberIds: [friend.user.id] }, owner.token)).body;
  const text = (await s.api('POST', '/rooms', { name: 'Чат', kind: 'text' }, owner.token)).body;
  const otherRoom = (await s.api('POST', '/rooms', { name: 'Своя', kind: 'text' }, other.token)).body;
  await s.api('POST', `/rooms/${voice.id}/messages`, { text: 'не потеряйся' }, friend.token);
  await s.stop({ keepData: true });

  // Делаем базу такой, какой её оставила версия 1.9: у комнат нет сходок
  const db = new DatabaseSync(path.join(s.dataDir, 'sozvon.db'));
  db.exec('UPDATE rooms SET hub_id = NULL; DELETE FROM hubs;');
  db.close();

  for (let run = 0; run < 2; run++) {
    const again = await startServer({ dataDir: s.dataDir });
    const hubs = (await again.api('GET', '/hubs', null, owner.token)).body;
    assert.deepEqual(hubs.map((h) => h.name), ['Сходка Илья']);
    assert.deepEqual(hubs[0].members.map((m) => m.id).sort(), [owner.user.id, friend.user.id].sort());
    const rooms = (await again.api('GET', '/rooms', null, owner.token)).body;
    assert.deepEqual(rooms.map((r) => [r.id, r.hubId]).sort(), [[voice.id, hubs[0].id], [text.id, hubs[0].id]].sort());
    // Участники комнат и переписка не потерялись
    const friendRooms = (await again.api('GET', '/rooms', null, friend.token)).body;
    assert.deepEqual(friendRooms.map((r) => r.id), [voice.id]);
    assert.equal((await again.api('GET', `/rooms/${voice.id}/messages`, null, owner.token)).body[0].text, 'не потеряйся');
    const otherHubs = (await again.api('GET', '/hubs', null, other.token)).body;
    assert.deepEqual(otherHubs.map((h) => h.name), ['Сходка mig_other']);
    assert.equal((await again.api('GET', '/rooms', null, other.token)).body[0].id, otherRoom.id);
    await again.stop({ keepData: run === 0 });
  }
});
