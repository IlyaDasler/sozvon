// Медиасервер LiveKit для больших комнат: сервер решает, как идёт голос (каждый с каждым или через LiveKit),
// выдаёт подписанный пропуск в комнату LiveKit с правами из ролей, старые версии в такую комнату не пускает,
// а выгнанного из голоса убирает и с медиасервера
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { startServer } from './helpers.js';

const SECRET = 'livekit-test-secret-0123456789abcdef';
let server, api, connect, befriend, reg, livekitApi;
const removed = [];

before(async () => {
  // Вместо настоящего LiveKit — его API: запоминаем, кого просили убрать
  livekitApi = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      removed.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    });
  });
  await new Promise((r) => livekitApi.listen(0, '127.0.0.1', r));
  server = await startServer({
    env: {
      LIVEKIT_URL: 'wss://example.test/livekit',
      LIVEKIT_API_URL: `http://127.0.0.1:${livekitApi.address().port}`,
      LIVEKIT_API_KEY: 'sozvon',
      LIVEKIT_API_SECRET: SECRET,
      LIVEKIT_MIN_MEMBERS: '3',
    },
  });
  ({ api, connect, befriend, reg } = server);
});

after(async () => {
  await server.stop();
  livekitApi.close();
});

function verifyJwt(token) {
  const [h, p, s] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  assert.equal(s, expected, 'подпись пропуска');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).alg, 'HS256');
  return JSON.parse(Buffer.from(p, 'base64url'));
}

async function hubWithRoom(prefix, count) {
  const people = [];
  for (let i = 0; i < count; i++) people.push(await reg(`${prefix}${i}`));
  const [owner, ...rest] = people;
  const hub = (await api('POST', '/hubs', { name: prefix }, owner.token)).body;
  for (const u of rest) {
    await befriend(owner, u);
    await api('POST', `/hubs/${hub.id}/invites`, { userIds: [u.user.id] }, owner.token);
    await api('POST', `/hub-invites/${hub.id}/accept`, null, u.token);
  }
  const room = (await api('POST', '/rooms', { name: 'Голос', kind: 'voice', hubId: hub.id }, owner.token)).body;
  return { people, room };
}

test('маленькая комната — как раньше, каждый с каждым', async () => {
  const { people, room } = await hubWithRoom('lk_small', 2);
  const c = connect(people[0].token);
  await c.open;
  c.send({ type: 'room:join', roomId: room.id, sfu: true });
  const joined = await c.next('room:joined');
  assert.deepEqual(joined.peers, []);
  assert.equal(joined.media, 'p2p');
  assert.equal(joined.livekit, undefined);
  c.ws.close();
});

test('большая комната — через LiveKit: пропуск на эту комнату, этого человека и с правами его роли', async () => {
  const { people, room } = await hubWithRoom('lk_big', 3);
  const c = connect(people[1].token);
  await c.open;
  c.send({ type: 'room:join', roomId: room.id, sfu: true });
  const joined = await c.next('room:joined');
  assert.equal(joined.media, 'sfu');
  assert.equal(joined.livekit.url, 'wss://example.test/livekit');
  const claims = verifyJwt(joined.livekit.token);
  assert.equal(claims.iss, 'sozvon');
  assert.equal(claims.sub, String(people[1].user.id));
  assert.equal(claims.video.room, `sozvon-room-${room.id}`);
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canSubscribe, true);
  assert.deepEqual(claims.video.canPublishSources.sort(), ['camera', 'microphone', 'screen_share', 'screen_share_audio']);
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp - Date.now() / 1000 <= 6 * 3600 + 5);
  // Остальным видно, как идёт голос в этой комнате
  const voiceMsg = await c.next('room:voice');
  assert.equal(voiceMsg.media, 'sfu');

  // Старая версия не умеет LiveKit — в такую комнату её не пускаем, а просим обновиться
  const old = connect(people[2].token);
  await old.open;
  old.send({ type: 'room:join', roomId: room.id });
  assert.equal((await old.next('room:error')).reason, 'old-version');

  // Выгнали из голоса — сервер убирает человека и с медиасервера
  await api('DELETE', `/rooms/${room.id}/members/${people[1].user.id}`, null, people[0].token);
  await new Promise((r) => setTimeout(r, 300));
  const call = removed.find((r) => r.body.identity === String(people[1].user.id));
  assert.ok(call, 'LiveKit попросили убрать выгнанного');
  assert.equal(call.path, '/twirp/livekit.RoomService/RemoveParticipant');
  assert.equal(call.body.room, `sozvon-room-${room.id}`);
  assert.equal(verifyJwt(call.auth.replace('Bearer ', '')).video.roomAdmin, true);
  c.ws.close();
  old.ws.close();
});

test('без права говорить и показывать — пропуск без микрофона и камеры', async () => {
  const { people, room } = await hubWithRoom('lk_perm', 3);
  // «Все без роли» могут только слушать
  await api('PATCH', `/rooms/${room.id}`, { defaultPerms: 1 }, people[0].token);
  const c = connect(people[2].token);
  await c.open;
  c.send({ type: 'room:join', roomId: room.id, sfu: true });
  const claims = verifyJwt((await c.next('room:joined')).livekit.token);
  assert.deepEqual(claims.video.canPublishSources, []);
  c.ws.close();
});
