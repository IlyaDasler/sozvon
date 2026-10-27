import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const port = 3900 + Math.floor(Math.random() * 90);
const base = `http://localhost:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-test-'));
let proc;

async function api(method, url, body, token) {
  const res = await fetch(base + '/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// Клиент WebSocket с очередью входящих сообщений
function connect(token) {
  const ws = new WebSocket(`ws://localhost:${port}/ws?token=${encodeURIComponent(token)}`);
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.type === msg.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  return {
    ws,
    open: new Promise((r) => ws.once('open', r)),
    send: (msg) => ws.send(JSON.stringify(msg)),
    next(type) {
      const i = queue.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ type, resolve });
        setTimeout(() => reject(new Error(`Не дождались ${type}`)), 3000);
      });
    },
  };
}

// Дружба — через заявку: a зовёт, b принимает
async function befriend(a, b) {
  await api('POST', '/contacts', { username: b.user.username }, a.token);
  await api('POST', `/friend-requests/${a.user.id}/accept`, null, b.token);
}

before(async () => {
  proc = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, INVITE_CODE: 'friends', AUTH_RATE_LIMIT: '100' },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Сервер не запустился');
});

after(async () => {
  const exited = new Promise((r) => proc.once('exit', r));
  proc.kill();
  await exited;
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

test('регистрация, вход, друзья, сообщения и звонок', async () => {
  const invite = { inviteCode: 'friends' };
  assert.equal((await api('POST', '/register', { username: 'ilya', password: 'secret1' })).status, 403);

  const a = await api('POST', '/register', { username: 'Ilya', password: 'secret1', displayName: 'Илья', ...invite });
  assert.equal(a.status, 200);
  assert.equal(a.body.user.username, 'ilya');

  assert.equal((await api('POST', '/register', { username: 'ilya', password: 'secret1', ...invite })).status, 409);
  assert.equal((await api('POST', '/register', { username: 'x', password: 'secret1', ...invite })).status, 400);
  assert.equal((await api('POST', '/login', { username: 'ilya', password: 'wrong!' })).status, 401);
  assert.equal((await api('GET', '/me', null, 'garbage')).status, 401);

  const b = await api('POST', '/register', { username: 'misha', password: 'secret2', ...invite });
  const login = await api('POST', '/login', { username: 'ILYA', password: 'secret1' });
  assert.equal(login.status, 200);
  const ta = login.body.token;
  const tb = b.body.token;

  const added = await api('POST', '/contacts', { username: 'misha' }, ta);
  assert.equal(added.status, 200);
  assert.equal(added.body.friendship, 'pending');
  assert.equal((await api('POST', `/friend-requests/${a.body.user.id}/accept`, null, tb)).status, 200);
  assert.equal((await api('GET', '/contacts', null, tb)).body[0].username, 'ilya');

  const ca = connect(ta);
  const cb = connect(tb);
  await Promise.all([ca.open, cb.open]);

  const msg = await api('POST', `/messages/${b.body.user.id}`, { text: 'Привет, го в игру?' }, ta);
  assert.equal(msg.status, 200);
  assert.equal((await cb.next('message')).message.text, 'Привет, го в игру?');
  assert.equal((await api('GET', `/messages/${a.body.user.id}`, null, tb)).body.length, 1);

  ca.send({ type: 'call:invite', to: b.body.user.id });
  const { callId } = await ca.next('call:ringing');
  const incoming = await cb.next('call:incoming');
  assert.equal(incoming.callId, callId);
  assert.equal(incoming.from.displayName, 'Илья');

  cb.send({ type: 'call:accept', callId });
  await ca.next('call:accepted');

  ca.send({ type: 'signal', callId, data: { sdp: { type: 'offer', sdp: 'test' } } });
  assert.deepEqual((await cb.next('signal')).data, { sdp: { type: 'offer', sdp: 'test' } });

  ca.send({ type: 'call:hangup', callId });
  assert.equal((await cb.next('call:ended')).reason, 'hangup');

  const ice = await api('GET', '/ice', null, ta);
  assert.ok(Array.isArray(ice.body.iceServers));

  ca.ws.close();
  assert.equal((await cb.next('presence')).online, false);
  cb.ws.close();
});

test('аватарка профиля', async () => {
  const { body: reg } = await api('POST', '/register', { username: 'avatar_owner', password: 'secret1', inviteCode: 'friends' });
  const { body: friend } = await api('POST', '/register', { username: 'avatar_friend', password: 'secret1', inviteCode: 'friends' });
  await befriend(reg, friend);
  assert.equal(reg.user.avatarUrl, null);

  const upload = (buf, type = 'image/webp') =>
    fetch(base + '/api/me/avatar', {
      method: 'PUT',
      headers: { 'Content-Type': type, Authorization: `Bearer ${reg.token}` },
      body: buf,
    });
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(64, 7)]);

  // Не WebP, слишком большой файл и запрос без входа отклоняются
  assert.equal((await upload(Buffer.from('not an image'))).status, 400);
  assert.equal((await upload(Buffer.concat([webp, Buffer.alloc(400 * 1024)]))).status, 413);
  assert.equal((await fetch(base + '/api/me/avatar', { method: 'PUT', body: webp, headers: { 'Content-Type': 'image/webp' } })).status, 401);

  const res = await upload(webp);
  assert.equal(res.status, 200);
  const me = await res.json();
  assert.match(me.avatarUrl, /^\/api\/avatars\/[a-f0-9]{32}\.webp$/);

  // Картинка отдаётся без токена, а друг видит новую ссылку в списке друзей
  const img = await fetch(base + me.avatarUrl);
  assert.equal(img.status, 200);
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), webp);
  const contacts = (await api('GET', '/contacts', null, friend.token)).body;
  assert.equal(contacts.find((c) => c.username === 'avatar_owner').avatarUrl, me.avatarUrl);

  // Новая загрузка удаляет старый файл, удаление аватарки — тоже
  const second = await (await upload(webp)).json();
  assert.notEqual(second.avatarUrl, me.avatarUrl);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await fetch(base + me.avatarUrl)).status, 404);
  const removed = await api('DELETE', '/me/avatar', null, reg.token);
  assert.equal(removed.body.avatarUrl, null);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await fetch(base + second.avatarUrl)).status, 404);
  assert.equal((await fetch(base + '/api/avatars/..%2Fsozvon.db')).status, 404);
});

test('комнаты: участники, чат и голосовой канал', async () => {
  const reg = async (username) =>
    (await api('POST', '/register', { username, password: 'secret1', displayName: username, inviteCode: 'friends' })).body;
  const owner = await reg('room_owner');
  const friend = await reg('room_friend');
  const third = await reg('room_third');
  const stranger = await reg('room_stranger');
  await befriend(owner, friend);
  await befriend(owner, third);

  // Создавать можно только с друзьями и с понятным названием и типом
  assert.equal((await api('POST', '/rooms', { name: '', kind: 'voice' }, owner.token)).status, 400);
  assert.equal((await api('POST', '/rooms', { name: 'Игры', kind: 'video' }, owner.token)).status, 400);
  assert.equal(
    (await api('POST', '/rooms', { name: 'Игры', kind: 'voice', memberIds: [stranger.user.id] }, owner.token)).status,
    400
  );

  const cf = connect(friend.token);
  await cf.open;
  const created = await api('POST', '/rooms', { name: 'Игры', kind: 'voice', memberIds: [friend.user.id] }, owner.token);
  assert.equal(created.status, 200);
  const room = created.body;
  assert.deepEqual(room.members.map((m) => m.username), ['room_owner', 'room_friend']);
  assert.equal((await cf.next('room:updated')).room.id, room.id);

  // Чужой комнату не видит
  assert.equal((await api('GET', `/rooms/${room.id}/messages`, null, stranger.token)).status, 404);
  assert.deepEqual((await api('GET', '/rooms', null, stranger.token)).body, []);

  // Сообщения в комнате видят все участники
  const sent = await api('POST', `/rooms/${room.id}/messages`, { text: 'Заходите в голос' }, owner.token);
  assert.equal(sent.status, 200);
  assert.equal((await cf.next('room:message')).message.text, 'Заходите в голос');
  assert.equal((await api('GET', `/rooms/${room.id}/messages`, null, friend.token)).body.length, 1);

  // Участник может добавить только своего друга; переименовать — только создатель
  assert.equal((await api('POST', `/rooms/${room.id}/members`, { userId: third.user.id }, friend.token)).status, 400);
  assert.equal((await api('PATCH', `/rooms/${room.id}`, { name: 'Мои' }, friend.token)).status, 403);
  const renamed = await api('PATCH', `/rooms/${room.id}`, { name: 'Вечерние игры' }, owner.token);
  assert.equal(renamed.body.name, 'Вечерние игры');

  // Голосовой канал: новичок получает список тех, кто уже внутри, и сам начинает соединение
  const co = connect(owner.token);
  await co.open;
  co.send({ type: 'room:join', roomId: room.id, muted: true });
  assert.deepEqual((await co.next('room:joined')).peers, []);
  const voiceUpdate = await cf.next('room:voice');
  assert.deepEqual(voiceUpdate.participants.map((p) => [p.userId, p.muted]), [[owner.user.id, true]]);

  cf.send({ type: 'room:join', roomId: room.id });
  assert.deepEqual((await cf.next('room:joined')).peers, [owner.user.id]);
  cf.send({ type: 'room:signal', roomId: room.id, to: owner.user.id, data: { sdp: { type: 'offer', sdp: 'x' } } });
  const signal = await co.next('room:signal');
  assert.equal(signal.from, friend.user.id);
  assert.deepEqual(signal.data, { sdp: { type: 'offer', sdp: 'x' } });

  // Пока человек в комнате, позвонить ему один на один нельзя — он занят
  co.send({ type: 'call:invite', to: friend.user.id });
  assert.equal((await co.next('call:unavailable')).reason, 'busy');

  cf.send({ type: 'room:state', roomId: room.id, screen: true });
  let state;
  do state = await co.next('room:voice');
  while (!state.participants.some((p) => p.screen));

  // Текстовую комнату в голосе не открыть; чужую — тоже
  const text = (await api('POST', '/rooms', { name: 'Болталка', kind: 'text' }, owner.token)).body;
  const cs = connect(stranger.token);
  await cs.open;
  cs.send({ type: 'room:join', roomId: room.id });
  assert.equal((await cs.next('room:error')).reason, 'not-member');
  co.send({ type: 'room:join', roomId: text.id });
  assert.equal((await co.next('room:error')).reason, 'not-member');

  // Создатель убирает участника — того выкидывает из голоса и из комнаты
  assert.equal((await api('DELETE', `/rooms/${room.id}/members/${owner.user.id}`, null, owner.token)).status, 400);
  assert.equal((await api('DELETE', `/rooms/${room.id}/members/${friend.user.id}`, null, owner.token)).status, 200);
  assert.equal((await cf.next('room:left')).reason, 'kicked');
  assert.equal((await cf.next('room:removed')).roomId, room.id);
  assert.equal((await api('GET', `/rooms/${room.id}/messages`, null, friend.token)).status, 404);

  // Удаление комнаты
  assert.equal((await api('DELETE', `/rooms/${room.id}`, null, owner.token)).status, 200);
  assert.equal((await co.next('room:left')).reason, 'removed');
  assert.deepEqual((await api('GET', '/rooms', null, owner.token)).body.map((r) => r.name), ['Болталка']);

  for (const c of [co, cf, cs]) c.ws.close();
});

test('комнаты: роли, права, кик и бан', async () => {
  const reg = async (username) =>
    (await api('POST', '/register', { username, password: 'secret1', displayName: username, inviteCode: 'friends' })).body;
  const owner = await reg('role_owner');
  const mod = await reg('role_mod');
  const guest = await reg('role_guest');
  const extra = await reg('role_extra');
  for (const u of [mod, guest, extra]) await befriend(owner, u);
  await befriend(mod, extra);

  const room = (await api('POST', '/rooms', { name: 'Клан', kind: 'voice', memberIds: [mod.user.id, guest.user.id] }, owner.token)).body;
  // Создателю сразу доступна роль администратора
  const admin = room.roles.find((r) => r.name === 'Администратор');
  assert.ok(admin);
  assert.equal(room.defaultPerms, 31);

  // Обычный участник роли не раздаёт, никого не выгоняет и не банит
  assert.equal((await api('POST', `/rooms/${room.id}/roles`, { name: 'Модер', perms: 32 }, guest.token)).status, 403);
  assert.equal((await api('DELETE', `/rooms/${room.id}/members/${mod.user.id}`, null, guest.token)).status, 403);
  assert.equal((await api('POST', `/rooms/${room.id}/bans`, { userId: mod.user.id }, guest.token)).status, 403);

  // Создатель заводит роль модератора и назначает её
  const withRole = (await api('POST', `/rooms/${room.id}/roles`, { name: 'Модератор', color: '#0090ff', perms: 32 | 64 | 128 | 15 }, owner.token)).body;
  const modRole = withRole.roles.find((r) => r.name === 'Модератор');
  assert.equal((await api('PUT', `/rooms/${room.id}/members/${mod.user.id}/role`, { roleId: modRole.id }, owner.token)).status, 200);

  // Модератор не может раздать админку и не может тронуть создателя
  assert.equal((await api('PUT', `/rooms/${room.id}/members/${guest.user.id}/role`, { roleId: admin.id }, mod.token)).status, 403);
  assert.equal((await api('POST', `/rooms/${room.id}/roles`, { name: 'Супер', perms: 256 }, mod.token)).status, 403);
  assert.equal((await api('POST', `/rooms/${room.id}/bans`, { userId: owner.user.id }, mod.token)).status, 403);
  // У модератора нет права звать друзей — роль его не даёт
  assert.equal((await api('POST', `/rooms/${room.id}/members`, { userId: extra.user.id }, mod.token)).status, 403);

  // Права по умолчанию: гостю запрещаем писать и говорить
  assert.equal((await api('PATCH', `/rooms/${room.id}`, { defaultPerms: 1 | 4 }, mod.token)).status, 200);
  assert.equal((await api('POST', `/rooms/${room.id}/messages`, { text: 'привет' }, guest.token)).status, 403);
  const cg = connect(guest.token);
  await cg.open;
  cg.send({ type: 'room:join', roomId: room.id });
  await cg.next('room:joined');
  cg.send({ type: 'room:state', roomId: room.id, muted: false });
  let v;
  do v = await cg.next('room:voice');
  while (!v.participants.length);
  assert.equal(v.participants[0].muted, true);

  // Без права заходить в голос — отключает сразу
  await api('PATCH', `/rooms/${room.id}`, { defaultPerms: 0 }, owner.token);
  assert.equal((await cg.next('room:left')).reason, 'no-access');
  cg.send({ type: 'room:join', roomId: room.id });
  assert.equal((await cg.next('room:error')).reason, 'no-access');
  await api('PATCH', `/rooms/${room.id}`, { defaultPerms: 31 }, owner.token);

  // Бан: человек пропадает из комнаты, и добавить его обратно нельзя, пока не разбанят
  const banned = await api('POST', `/rooms/${room.id}/bans`, { userId: guest.user.id }, mod.token);
  assert.equal(banned.status, 200);
  assert.deepEqual(banned.body.bans.map((b) => b.id), [guest.user.id]);
  assert.equal((await cg.next('room:removed')).reason, 'banned');
  assert.equal((await api('GET', `/rooms/${room.id}/messages`, null, guest.token)).status, 404);
  assert.equal((await api('POST', `/rooms/${room.id}/members`, { userId: guest.user.id }, owner.token)).status, 400);
  assert.equal((await api('DELETE', `/rooms/${room.id}/bans/${guest.user.id}`, null, owner.token)).status, 200);
  assert.equal((await api('POST', `/rooms/${room.id}/members`, { userId: guest.user.id }, owner.token)).status, 200);

  // Кик модератором
  assert.equal((await api('DELETE', `/rooms/${room.id}/members/${guest.user.id}`, null, mod.token)).status, 200);

  // Удалили роль — модератор снова обычный участник
  await api('DELETE', `/rooms/${room.id}/roles/${modRole.id}`, null, owner.token);
  const after = (await api('GET', '/rooms', null, mod.token)).body.find((r) => r.id === room.id);
  assert.equal(after.members.find((m) => m.id === mod.user.id).roleId, null);
  assert.equal((await api('PATCH', `/rooms/${room.id}`, { name: 'Мой клан' }, mod.token)).status, 403);

  cg.ws.close();
});

test('без почтового ящика на сервере регистрация по почте не проходит', async () => {
  assert.equal((await api('GET', '/health')).body.emailCodes, false);
  assert.equal((await api('POST', '/register/code', { email: 'petr@mail.ru', inviteCode: 'friends' })).status, 503);
  assert.equal((await api('POST', '/register', { email: 'petr@mail.ru', password: 'secret1', inviteCode: 'friends' })).status, 503);
  // Старые версии приложения по-прежнему регистрируются по логину
  assert.equal((await api('POST', '/register', { username: 'petr_old', password: 'secret1', inviteCode: 'friends' })).status, 200);
});

test('статусы: активен, неактивен, не беспокоить, невидимый', async () => {
  const reg = async (username) =>
    (await api('POST', '/register', { username, password: 'secret1', displayName: username, inviteCode: 'friends' })).body;
  const a = await reg('status_a');
  const b = await reg('status_b');
  await befriend(a, b);
  assert.equal(a.user.status, 'online');

  const cb = connect(b.token);
  await cb.open;
  const ca = connect(a.token);
  await ca.open;
  const presence = async (status) => {
    let m;
    do m = await cb.next('presence');
    while (m.userId !== a.user.id || m.status !== status);
    return m;
  };
  assert.equal((await presence('online')).online, true);

  // Давно не трогали компьютер — «неактивен», вернулись — снова «активен»
  ca.send({ type: 'status:auto', idle: true });
  assert.equal((await presence('idle')).online, true);
  ca.send({ type: 'status:auto', idle: false });
  await presence('online');

  // Не беспокоить: в сети, но со своим статусом; неверный статус не принимается
  assert.equal((await api('PUT', '/me/status', { status: 'busy' }, a.token)).status, 400);
  assert.equal((await api('PUT', '/me/status', { status: 'dnd' }, a.token)).body.status, 'dnd');
  assert.equal((await presence('dnd')).online, true);
  assert.equal((await ca.next('me:status')).status, 'dnd');

  // Невидимый: для друзей «не в сети», сам себя видит невидимым
  const me = await api('PUT', '/me/status', { status: 'invisible' }, a.token);
  assert.equal(me.body.status, 'invisible');
  assert.equal((await presence('offline')).online, false);
  const seen = (await api('GET', '/contacts', null, b.token)).body.find((c) => c.id === a.user.id);
  assert.deepEqual([seen.online, seen.status], [false, 'offline']);
  // Статус сохраняется: после переподключения невидимый остаётся невидимым
  ca.ws.close();
  const ca2 = connect(a.token);
  await ca2.open;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await api('GET', '/contacts', null, b.token)).body.find((c) => c.id === a.user.id).status, 'offline');
  await api('PUT', '/me/status', { status: 'online' }, a.token);
  await presence('online');
  for (const c of [ca2, cb]) c.ws.close();
});

test('профиль: «О себе», цвет баннера и дата регистрации видны друзьям', async () => {
  const reg = async (username) =>
    (await api('POST', '/register', { username, password: 'secret1', displayName: username, inviteCode: 'friends' })).body;
  const a = await reg('profile_a');
  const b = await reg('profile_b');
  await befriend(a, b);
  assert.equal(a.user.bio, '');
  assert.equal(a.user.bannerColor, null);
  assert.ok(a.user.memberSince > 0);

  const me = await api('PATCH', '/me', { bio: '  Люблю **CS2** и котов  ', bannerColor: '#5865F2' }, a.token);
  assert.equal(me.status, 200);
  assert.deepEqual([me.body.bio, me.body.bannerColor], ['Люблю **CS2** и котов', '#5865f2']);
  assert.equal((await api('PATCH', '/me', { bio: 'x'.repeat(191) }, a.token)).status, 400);
  assert.equal((await api('PATCH', '/me', { bannerColor: 'red' }, a.token)).status, 400);
  // Пустой цвет — баннер по цвету аватара
  assert.equal((await api('PATCH', '/me', { bannerColor: null }, a.token)).body.bannerColor, null);

  const friend = (await api('GET', '/contacts', null, b.token)).body.find((c) => c.id === a.user.id);
  assert.equal(friend.bio, 'Люблю **CS2** и котов');
  assert.ok(friend.memberSince > 0);
});

test('друзья: заявки, принятие, отказ, отмена и блокировка', async () => {
  const reg = async (username) =>
    (await api('POST', '/register', { username, password: 'secret1', displayName: username, inviteCode: 'friends' })).body;
  const a = await reg('req_a');
  const b = await reg('req_b');
  const c = await reg('req_c');
  const d = await reg('req_d');
  const cb = connect(b.token);
  const ca = connect(a.token);
  const cc = connect(c.token);
  await Promise.all([cb.open, ca.open, cc.open]);
  const requests = async (who) => (await api('GET', '/friend-requests', null, who.token)).body;
  const ids = (list) => list.map((u) => u.id);
  const friendIds = async (who) => ids((await api('GET', '/contacts', null, who.token)).body);

  // Заявка не делает друзьями: приходит уведомление, писать пока нельзя
  const sent = await api('POST', '/contacts', { username: 'req_b' }, a.token);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.friendship, 'pending');
  assert.equal(sent.body.id, b.user.id);
  assert.equal((await cb.next('friend:request')).user.id, a.user.id);
  assert.deepEqual(await friendIds(b), []);
  assert.equal((await api('POST', `/messages/${b.user.id}`, { text: 'эй' }, a.token)).status, 404);
  assert.deepEqual(ids((await requests(b)).incoming), [a.user.id]);
  assert.deepEqual(ids((await requests(a)).outgoing), [b.user.id]);
  // Статус «в сети» до дружбы не виден
  assert.equal((await requests(b)).incoming[0].online, undefined);
  assert.equal((await api('POST', '/contacts', { username: 'req_b' }, a.token)).status, 409);

  // Принятие: оба в друзьях, отправитель узнаёт сразу
  assert.equal((await api('POST', `/friend-requests/${a.user.id}/accept`, null, b.token)).status, 200);
  assert.equal((await ca.next('contact:added')).user.id, b.user.id);
  assert.deepEqual(await friendIds(a), [b.user.id]);
  assert.deepEqual(await friendIds(b), [a.user.id]);
  assert.deepEqual(await requests(b), { incoming: [], outgoing: [] });
  assert.equal((await api('POST', '/contacts', { username: 'req_a' }, b.token)).status, 409);
  // Принять можно только существующую заявку
  assert.equal((await api('POST', `/friend-requests/${c.user.id}/accept`, null, b.token)).status, 404);

  // Отказ: заявка пропадает у обоих, друзьями не становятся
  await api('POST', '/contacts', { username: 'req_b' }, c.token);
  await cb.next('friend:request');
  assert.equal((await api('DELETE', `/friend-requests/${c.user.id}`, null, b.token)).status, 200);
  assert.equal((await cc.next('friend:request:removed')).userId, b.user.id);
  assert.deepEqual((await requests(c)).outgoing, []);
  assert.deepEqual(await friendIds(c), []);

  // Отмена своей заявки
  await api('POST', '/contacts', { username: 'req_b' }, c.token);
  await cb.next('friend:request');
  assert.equal((await api('DELETE', `/friend-requests/${b.user.id}`, null, c.token)).status, 200);
  assert.equal((await cb.next('friend:request:removed')).userId, c.user.id);
  assert.deepEqual((await requests(b)).incoming, []);

  // Встречные заявки — сразу дружба
  await api('POST', '/contacts', { username: 'req_d' }, c.token);
  const mutual = await api('POST', '/contacts', { username: 'req_c' }, d.token);
  assert.equal(mutual.body.friendship, 'friends');
  assert.deepEqual(await friendIds(c), [d.user.id]);

  // Блокировка: заявка удаляется, новые не проходят, человек в списке заблокированных
  await api('POST', '/contacts', { username: 'req_b' }, c.token);
  await cb.next('friend:request');
  assert.equal((await api('POST', '/blocks', { userId: c.user.id }, b.token)).status, 200);
  assert.deepEqual((await requests(b)).incoming, []);
  assert.deepEqual(ids((await api('GET', '/blocks', null, b.token)).body), [c.user.id]);
  assert.equal((await api('POST', '/contacts', { username: 'req_b' }, c.token)).status, 403);
  assert.equal((await api('POST', '/contacts', { username: 'req_c' }, b.token)).status, 403);
  // Разблокировали — снова можно
  assert.equal((await api('DELETE', `/blocks/${c.user.id}`, null, b.token)).status, 200);
  assert.deepEqual((await api('GET', '/blocks', null, b.token)).body, []);
  assert.equal((await api('POST', '/contacts', { username: 'req_b' }, c.token)).body.friendship, 'pending');

  // Заблокировать друга — дружба пропадает у обоих
  assert.equal((await api('POST', '/blocks', { userId: a.user.id }, b.token)).status, 200);
  assert.equal((await ca.next('contact:removed')).userId, b.user.id);
  assert.deepEqual(await friendIds(a), []);
  assert.equal((await api('POST', '/blocks', { userId: b.user.id }, b.token)).status, 400);

  for (const s of [ca, cb, cc]) s.ws.close();
});

test('комнаты: кик на время — только чтение, потом права возвращаются', async () => {
  const reg = async (username) =>
    (await api('POST', '/register', { username, password: 'secret1', displayName: username, inviteCode: 'friends' })).body;
  const owner = await reg('to_owner');
  const mod = await reg('to_mod');
  const guest = await reg('to_guest');
  await befriend(owner, mod);
  await befriend(owner, guest);
  let room = (await api('POST', '/rooms', { name: 'Тайм', kind: 'voice', memberIds: [mod.user.id, guest.user.id] }, owner.token)).body;
  const modRole = (await api('POST', `/rooms/${room.id}/roles`, { name: 'Модер', perms: 15 | 32 }, owner.token)).body.roles.find((r) => r.name === 'Модер');
  await api('PUT', `/rooms/${room.id}/members/${mod.user.id}/role`, { roleId: modRole.id }, owner.token);

  const cg = connect(guest.token);
  await cg.open;
  cg.send({ type: 'room:join', roomId: room.id });
  await cg.next('room:joined');

  // Обычный участник кикнуть не может, создателя не кикнуть, длительность проверяется
  assert.equal((await api('POST', `/rooms/${room.id}/timeouts`, { userId: mod.user.id, seconds: 60 }, guest.token)).status, 403);
  assert.equal((await api('POST', `/rooms/${room.id}/timeouts`, { userId: owner.user.id, seconds: 60 }, mod.token)).status, 403);
  assert.equal((await api('POST', `/rooms/${room.id}/timeouts`, { userId: guest.user.id, seconds: 0 }, mod.token)).status, 400);

  // Кик на 2 секунды: выкидывает из голоса, писать нельзя, читать можно, участник остаётся в комнате
  const kicked = await api('POST', `/rooms/${room.id}/timeouts`, { userId: guest.user.id, seconds: 2 }, mod.token);
  assert.equal(kicked.status, 200);
  const until = kicked.body.members.find((m) => m.id === guest.user.id).timeoutUntil;
  assert.ok(until > Date.now() && until <= Date.now() + 2000);
  assert.equal((await cg.next('room:left')).reason, 'no-access');
  const write = await api('POST', `/rooms/${room.id}/messages`, { text: 'можно?' }, guest.token);
  assert.equal(write.status, 403);
  assert.match(write.body.error, /кик/i);
  assert.equal((await api('GET', `/rooms/${room.id}/messages`, null, guest.token)).status, 200);
  cg.send({ type: 'room:join', roomId: room.id });
  assert.equal((await cg.next('room:error')).reason, 'no-access');
  // Кикнутый модератор тоже никого не трогает
  await api('POST', `/rooms/${room.id}/timeouts`, { userId: mod.user.id, seconds: 60 }, owner.token);
  assert.equal((await api('DELETE', `/rooms/${room.id}/timeouts/${guest.user.id}`, null, mod.token)).status, 403);
  // Создатель снимает кик досрочно
  assert.equal((await api('DELETE', `/rooms/${room.id}/timeouts/${mod.user.id}`, null, owner.token)).status, 200);
  room = (await api('GET', '/rooms', null, owner.token)).body.find((r) => r.id === room.id);
  assert.equal(room.members.find((m) => m.id === mod.user.id).timeoutUntil, null);

  // Время вышло — права роли вернулись сами
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal((await api('POST', `/rooms/${room.id}/messages`, { text: 'я вернулся' }, guest.token)).status, 200);
  room = (await api('GET', '/rooms', null, guest.token)).body.find((r) => r.id === room.id);
  assert.equal(room.members.find((m) => m.id === guest.user.id).timeoutUntil, null);
  cg.ws.close();
});
