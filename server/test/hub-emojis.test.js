// Свои смайлики канала: добавляет любой участник, удаляет автор или управляющий
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, befriend, reg, base;

before(async () => {
  server = await startServer();
  ({ api, befriend, reg, base } = server);
});

after(() => server.stop());

// Самый короткий настоящий заголовок WebP: сервер проверяет сигнатуру
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);

const upload = (hubId, name, token, body = WEBP) =>
  fetch(`${base}/api/hubs/${hubId}/emojis/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/webp' },
    body,
  });

async function hubWith(tag) {
  const owner = await reg(`he_o${tag}`);
  const member = await reg(`he_m${tag}`);
  await befriend(owner, member);
  const hub = (await api('POST', '/hubs', { name: 'Смайлы' }, owner.token)).body;
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [member.user.id] }, owner.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, member.token);
  return { owner, member, hub };
}

test('участник добавляет смайлик, посторонний — нет, картинка доступна', async () => {
  const { owner, member, hub } = await hubWith(1);
  assert.deepEqual(hub.emojis, []);
  const stranger = await reg('he_stranger');
  assert.notEqual((await upload(hub.id, 'кот', stranger.token)).status, 200);
  const res = await upload(hub.id, 'кот', member.token);
  assert.equal(res.status, 200);
  const { emojis } = await res.json();
  assert.equal(emojis[0].name, 'кот');
  assert.equal(emojis[0].createdBy, member.user.id);
  assert.match(emojis[0].url, /^\/api\/avatars\/[a-f0-9]{32}\.webp$/);
  assert.equal((await fetch(`${base}${emojis[0].url}`)).status, 200);
  const seen = (await api('GET', '/hubs', null, owner.token)).body.find((h) => h.id === hub.id);
  assert.equal(seen.emojis[0].name, 'кот');
});

test('имя проверяется, повтор отклоняется, не WebP не принимается', async () => {
  const { owner, hub } = await hubWith(2);
  assert.equal((await upload(hub.id, 'а', owner.token)).status, 400);
  assert.equal((await upload(hub.id, 'с пробелом', owner.token)).status, 400);
  assert.equal((await upload(hub.id, '<b>', owner.token)).status, 400);
  assert.equal((await upload(hub.id, 'файл', owner.token, Buffer.from('<svg></svg>'))).status, 400);
  assert.equal((await upload(hub.id, 'Кот_2', owner.token)).status, 200);
  assert.equal((await upload(hub.id, 'кот_2', owner.token)).status, 409, 'регистр не отличает имена');
});

test('удалить может автор или управляющий, другой участник — нет; файл исчезает', async () => {
  const { owner, member, hub } = await hubWith(3);
  const other = await reg('he_other');
  await befriend(owner, other);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [other.user.id] }, owner.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, other.token);
  await upload(hub.id, 'мой', member.token);
  const { emojis } = await (await upload(hub.id, 'ещё', member.token)).json();
  const [mine, second] = emojis;
  assert.equal((await api('DELETE', `/hubs/${hub.id}/emojis/${mine.id}`, null, other.token)).status, 403);
  assert.equal((await api('DELETE', `/hubs/${hub.id}/emojis/${mine.id}`, null, member.token)).status, 200);
  assert.equal((await fetch(`${base}${mine.url}`)).status, 404);
  const left = await api('DELETE', `/hubs/${hub.id}/emojis/${second.id}`, null, owner.token);
  assert.deepEqual(left.body.emojis, []);
});
