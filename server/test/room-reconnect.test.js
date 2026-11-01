// Короткий обрыв связи не должен выкидывать из голосового канала: сервер держит место участника,
// а вернувшееся приложение просит вернуть его в тот же канал (room:resume)
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, connect, reg, api, befriend;

before(async () => {
  // Окно больше паузы теста: возврат должен успевать, а «опоздавший» — проверяется отдельно
  server = await startServer({ env: { CALL_RECONNECT_GRACE_MS: '1500' } });
  ({ connect, reg, api, befriend } = server);
});

after(() => server.stop());

async function person(name) {
  const u = await reg(name);
  u.ws = connect(u.token);
  await u.ws.open;
  return u;
}

async function roomFor(owner, ...guests) {
  const hub = (await api('POST', '/hubs', { name: 'Канал' }, owner.token)).body;
  // Звать в канал можно только друзей, и приглашение — это заявка: её принимают
  for (const g of guests) {
    await befriend(owner, g);
    await api('POST', `/hubs/${hub.id}/invites`, { userIds: [g.user.id] }, owner.token);
    await api('POST', `/hub-invites/${hub.id}/accept`, null, g.token);
  }
  const room = (await api('POST', '/rooms', { name: 'Голос', kind: 'voice', hubId: hub.id }, owner.token)).body;
  return room;
}

async function joinVoice(u, roomId) {
  u.ws.send({ type: 'room:join', roomId });
  // Сервер может отказать — показываем причину, а не «не дождались»
  const result = await Promise.race([
    u.ws.next('room:joined').then((m) => ({ ok: m })),
    u.ws.next('room:error').then((m) => ({ err: m })),
  ]);
  if (result.err) throw new Error(`room:error ${result.err.reason}`);
  return result.ok;
}

const ids = (msg) => msg.participants.map((p) => p.userId).sort((a, b) => a - b);

// В очереди уже лежат сообщения о входах — забираем их, чтобы проверять только то, что будет дальше
async function skip(ws, count) {
  for (let i = 0; i < count; i++) await ws.next('room:voice');
}

test('секундный обрыв не выкидывает из голосового канала', async () => {
  const owner = await person('rv_owner');
  const guest = await person('rv_guest');
  const room = await roomFor(owner, guest);
  await joinVoice(owner, room.id);
  await joinVoice(guest, room.id);
  await skip(owner.ws, 2);
  const both = [owner.user.id, guest.user.id].sort((a, b) => a - b);

  guest.ws.ws.close();
  // Связь пропала, но место в канале за гостем осталось — это видно остальным
  const away = await owner.ws.next('room:voice');
  assert.deepEqual(ids(away), both);

  // Приложение вернулось и просит вернуть его в тот же канал
  guest.ws = connect(guest.token);
  await guest.ws.open;
  guest.ws.send({ type: 'room:resume', roomId: room.id });
  const resumed = await guest.ws.next('room:resumed');
  assert.equal(resumed.roomId, room.id);

  // После возврата сервер снова сообщает состав канала — и в нём оба
  const back = await owner.ws.next('room:voice');
  assert.deepEqual(ids(back), both);
});

test('не вернулся за окно ожидания — уходит из канала, как раньше', async () => {
  const owner = await person('rv_owner2');
  const guest = await person('rv_guest2');
  const room = await roomFor(owner, guest);
  await joinVoice(owner, room.id);
  await joinVoice(guest, room.id);
  await skip(owner.ws, 2);

  guest.ws.ws.close();
  const away = await owner.ws.next('room:voice');
  assert.deepEqual(ids(away).sort(), [owner.user.id, guest.user.id].sort());

  // Окно прошло — гость ушёл
  const gone = await owner.ws.next('room:voice');
  assert.deepEqual(ids(gone), [owner.user.id]);
});

test('вернувшийся слишком поздно заходит заново по отказу resume', async () => {
  const owner = await person('rv_owner3');
  const guest = await person('rv_guest3');
  const room = await roomFor(owner, guest);
  await joinVoice(owner, room.id);
  await joinVoice(guest, room.id);
  await skip(owner.ws, 2);

  guest.ws.ws.close();
  await owner.ws.next('room:voice'); // связь прервалась
  await owner.ws.next('room:voice'); // окно прошло, гость вышел

  guest.ws = connect(guest.token);
  await guest.ws.open;
  guest.ws.send({ type: 'room:resume', roomId: room.id });
  const failed = await guest.ws.next('room:resume:failed');
  assert.equal(failed.roomId, room.id);
});
