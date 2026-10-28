// Каналы: свой «сервер» с комнатами внутри, приглашения друзей, права, баны и перенос старых комнат
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

// Позвать в канал и сразу принять приглашение
async function join(hub, by, who) {
  assert.equal((await api('POST', `/hubs/${hub.id}/invites`, { userIds: [who.user.id] }, by.token)).status, 200);
  const res = await api('POST', `/hub-invites/${hub.id}/accept`, null, who.token);
  assert.equal(res.status, 200);
  return res.body;
}

test('каналы: создание, приглашение, вступление, комнаты внутри, выход и удаление', async () => {
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
  // В новом канале сразу есть голосовая и текстовая комнаты
  assert.deepEqual((await hubRooms(owner.token, hub.id)).map((r) => r.kind).sort(), ['text', 'voice']);

  // Чужого канала не видит и ничего в нём не может
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
  // Пока не вступил — комнат канала не видит
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

  // Новая комната в канале — сразу у всех его участников
  const memes = await api('POST', '/rooms', { hubId: hub.id, name: 'Мемы', kind: 'text' }, owner.token);
  assert.equal(memes.status, 200);
  assert.equal(memes.body.hubId, hub.id);
  assert.deepEqual(memes.body.members.map((m) => m.id).sort(), [owner.user.id, friend.user.id].sort());
  let update;
  do update = await cf.next('room:updated');
  while (update.room.id !== memes.body.id);

  // Обычный участник каналом не управляет
  assert.equal((await api('POST', '/rooms', { hubId: hub.id, name: 'Моя', kind: 'text' }, friend.token)).status, 403);
  assert.equal((await api('PATCH', `/hubs/${hub.id}`, { name: 'Наш двор' }, friend.token)).status, 403);
  assert.equal((await api('POST', `/hubs/${hub.id}/invites`, { userIds: [owner.user.id] }, friend.token)).status, 403);
  assert.equal((await api('DELETE', `/rooms/${memes.body.id}`, null, friend.token)).status, 403);
  assert.equal((await api('PUT', `/hubs/${hub.id}/members/${friend.user.id}/manager`, { manager: true }, friend.token)).status, 403);

  // Право «управлять каналом» даёт только создатель
  const promoted = await api('PUT', `/hubs/${hub.id}/members/${friend.user.id}/manager`, { manager: true }, owner.token);
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.members.find((m) => m.id === friend.user.id).manager, true);
  const renamed = await api('PATCH', `/hubs/${hub.id}`, { name: 'Наш двор', iconColor: '#0090ff' }, friend.token);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, 'Наш двор');
  assert.equal((await cf.next('hub:updated')).hub.id, hub.id);
  assert.equal((await api('POST', '/rooms', { hubId: hub.id, name: 'Кино', kind: 'voice' }, friend.token)).status, 200);
  // Управляющий в комнатах канала — как администратор: переименовывает и удаляет чужие комнаты
  assert.equal((await api('PATCH', `/rooms/${memes.body.id}`, { name: 'Мемасы' }, friend.token)).status, 200);
  assert.equal((await api('DELETE', `/rooms/${memes.body.id}`, null, friend.token)).status, 200);
  // Но удалить канал может только создатель
  assert.equal((await api('DELETE', `/hubs/${hub.id}`, null, friend.token)).status, 403);

  // Выход: из канала и всех его комнат
  assert.equal((await api('DELETE', `/hubs/${hub.id}/members/${owner.user.id}`, null, owner.token)).status, 400);
  assert.equal((await api('DELETE', `/hubs/${hub.id}/members/${friend.user.id}`, null, friend.token)).status, 200);
  assert.equal((await cf.next('hub:removed')).reason, 'left');
  assert.deepEqual(await hubRooms(friend.token, hub.id), []);
  assert.deepEqual((await api('GET', '/hubs', null, friend.token)).body, []);

  // Удаление: комнаты пропадают вместе со каналом, приглашения — тоже
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

test('каналы: кик и бан из канала, старшинство, баны комнат при вступлении', async () => {
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

  // Бан в одной комнате канала переживает повторное вступление
  const text = (await hubRooms(owner.token, hub.id)).find((r) => r.kind === 'text');
  assert.equal((await api('POST', `/rooms/${text.id}/bans`, { userId: guest.user.id }, mod.token)).status, 200);

  // Кик из канала: пропадает из всех комнат, но позвать снова можно
  const cg = connect(guest.token);
  await cg.open;
  assert.equal((await api('DELETE', `/hubs/${hub.id}/members/${guest.user.id}`, null, mod.token)).status, 200);
  assert.equal((await cg.next('hub:removed')).reason, 'kicked');
  assert.deepEqual(await hubRooms(guest.token, hub.id), []);
  await join(hub, owner, guest);
  const back = await hubRooms(guest.token, hub.id);
  assert.deepEqual(back.map((r) => r.kind), ['voice']);

  // Бан из канала: пропадает, и позвать нельзя, пока не снимут
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

test('каналы: картинка-иконка', async () => {
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

test('старые клиенты: комната без канала попадает в канал создателя', async () => {
  const owner = await reg('legacy_owner');
  const friend = await reg('legacy_friend');
  await befriend(owner, friend);
  const first = await api('POST', '/rooms', { name: 'Старая', kind: 'voice', memberIds: [friend.user.id] }, owner.token);
  assert.equal(first.status, 200);
  const hubs = (await api('GET', '/hubs', null, owner.token)).body;
  assert.deepEqual(hubs.map((h) => h.name), ['Канал legacy_owner']);
  assert.equal(first.body.hubId, hubs[0].id);
  // Друг из старого клиента попал в канал, но только в эту комнату
  assert.deepEqual((await api('GET', '/hubs', null, friend.token)).body.map((h) => h.id), [hubs[0].id]);
  assert.deepEqual((await hubRooms(friend.token, hubs[0].id)).map((r) => r.name), ['Старая']);
  const second = await api('POST', '/rooms', { name: 'Ещё одна', kind: 'text' }, owner.token);
  assert.equal(second.body.hubId, hubs[0].id);
  // И позвать из старого клиента в комнату канала можно друга, который ещё не в канале
  const late = await reg('legacy_late');
  await befriend(owner, late);
  assert.equal((await api('POST', `/rooms/${second.body.id}/members`, { userId: late.user.id }, owner.token)).status, 200);
  assert.ok((await api('GET', '/hubs', null, late.token)).body[0].members.some((m) => m.id === late.user.id));

  // Первая комната из старого клиента без друзей: новый канал всё равно приходит на другие устройства создателя
  const solo = await reg('legacy_solo');
  const cs = connect(solo.token);
  await cs.open;
  const lone = await api('POST', '/rooms', { name: 'Один', kind: 'text' }, solo.token);
  assert.equal((await cs.next('hub:updated')).hub.id, lone.body.hubId);
  cs.ws.close();
});

test('миграция: комнаты без канала переезжают в «Канал <имя создателя>» вместе с участниками', async () => {
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

  // Делаем базу такой, какой её оставила версия 1.9: у комнат нет каналов
  const db = new DatabaseSync(path.join(s.dataDir, 'sozvon.db'));
  db.exec('UPDATE rooms SET hub_id = NULL; DELETE FROM hubs;');
  db.close();

  for (let run = 0; run < 2; run++) {
    const again = await startServer({ dataDir: s.dataDir });
    const hubs = (await again.api('GET', '/hubs', null, owner.token)).body;
    assert.deepEqual(hubs.map((h) => h.name), ['Канал Илья']);
    assert.deepEqual(hubs[0].members.map((m) => m.id).sort(), [owner.user.id, friend.user.id].sort());
    const rooms = (await again.api('GET', '/rooms', null, owner.token)).body;
    assert.deepEqual(rooms.map((r) => [r.id, r.hubId]).sort(), [[voice.id, hubs[0].id], [text.id, hubs[0].id]].sort());
    // Участники комнат и переписка не потерялись
    const friendRooms = (await again.api('GET', '/rooms', null, friend.token)).body;
    assert.deepEqual(friendRooms.map((r) => r.id), [voice.id]);
    assert.equal((await again.api('GET', `/rooms/${voice.id}/messages`, null, owner.token)).body[0].text, 'не потеряйся');
    const otherHubs = (await again.api('GET', '/hubs', null, other.token)).body;
    assert.deepEqual(otherHubs.map((h) => h.name), ['Канал mig_other']);
    assert.equal((await again.api('GET', '/rooms', null, other.token)).body[0].id, otherRoom.id);
    await again.stop({ keepData: run === 0 });
  }
});

test('миграция 2.2: каналы «Сходка <имя>» из версии 2.0 становятся «Канал <имя>», свои названия не трогаем', async () => {
  const s = await startServer();
  const owner = await s.reg('sk_owner');
  const auto = (await s.api('POST', '/hubs', { name: 'Канал временно' }, owner.token)).body;
  const own = (await s.api('POST', '/hubs', { name: 'Наша сходка' }, owner.token)).body;
  await s.stop({ keepData: true });

  // Так назвала канал миграция версии 2.0
  const db = new DatabaseSync(path.join(s.dataDir, 'sozvon.db'));
  db.prepare('UPDATE hubs SET name = ? WHERE id = ?').run('Сходка Соломон Ицхакович', auto.id);
  db.close();

  for (let run = 0; run < 2; run++) {
    const again = await startServer({ dataDir: s.dataDir });
    try {
      const names = Object.fromEntries((await again.api('GET', '/hubs', null, owner.token)).body.map((h) => [h.id, h.name]));
      assert.equal(names[auto.id], 'Канал Соломон Ицхакович');
      assert.equal(names[own.id], 'Наша сходка');
    } finally {
      await again.stop({ keepData: run === 0 });
    }
  }
});

test('свой фон комнаты: ставит тот, кто настраивает комнату; видят все; убирается и пропадает с комнатой', async () => {
  const owner = await reg('bg_owner');
  const guest = await reg('bg_guest');
  await befriend(owner, guest);
  const hub = (await api('POST', '/hubs', { name: 'С фоном' }, owner.token)).body;
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [guest.user.id] }, owner.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, guest.token);
  const room = (await api('POST', '/rooms', { name: 'Уютная', kind: 'text', hubId: hub.id }, owner.token)).body;
  assert.equal(room.backgroundUrl, null);
  const put = (who, body, type = 'image/webp') =>
    fetch(`${server.base}/api/rooms/${room.id}/background`, { method: 'PUT', body, headers: { 'Content-Type': type, Authorization: `Bearer ${who.token}` } });
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(400 * 1024)]);
  assert.equal((await put(guest, webp)).status, 403);
  assert.equal((await put(owner, Buffer.from('not an image'))).status, 400);
  const res = await put(owner, webp); // крупнее аватарки: фон — во всю ширину
  assert.equal(res.status, 200);
  const { backgroundUrl } = await res.json();
  assert.match(backgroundUrl, /^\/api\/avatars\/[a-f0-9]{32}\.webp$/);
  const seen = (await api('GET', '/rooms', null, guest.token)).body.find((r) => r.id === room.id);
  assert.equal(seen.backgroundUrl, backgroundUrl);
  assert.equal((await api('DELETE', `/rooms/${room.id}/background`, null, owner.token)).body.backgroundUrl, null);
  assert.equal((await fetch(server.base + backgroundUrl)).status, 404);
  const again = (await (await put(owner, webp)).json()).backgroundUrl;
  await api('DELETE', `/rooms/${room.id}`, null, owner.token);
  assert.equal((await fetch(server.base + again)).status, 404);
});
