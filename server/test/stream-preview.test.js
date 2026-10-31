// Превью трансляции: картинка для карточки в списке голоса. Живёт только в памяти сервера
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, connect, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, connect, befriend, reg } = server);
});

after(() => server.stop());

const IMAGE = `data:image/jpeg;base64,${'A'.repeat(1000)}`;

async function streamer(tag) {
  const owner = await reg(`sp_o${tag}`);
  const viewer = await reg(`sp_v${tag}`);
  await befriend(owner, viewer);
  const hub = (await api('POST', '/hubs', { name: 'Эфир' }, owner.token)).body;
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [viewer.user.id] }, owner.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, viewer.token);
  const room = (await api('POST', '/rooms', { name: 'голос', kind: 'voice', hubId: hub.id }, owner.token)).body;
  const co = connect(owner.token);
  const cv = connect(viewer.token);
  await Promise.all([co.open, cv.open]);
  co.send({ type: 'room:join', roomId: room.id, muted: true });
  await co.next('room:joined');
  await cv.next('room:voice');
  return { owner, viewer, room, co, cv };
}

const ask = async (client, roomId, userId) => {
  client.send({ type: 'room:preview:get', roomId, userId });
  return (await client.next('room:preview')).image;
};

test('участник комнаты видит превью, пока идёт трансляция, не входя в голос', async () => {
  const { owner, room, co, cv } = await streamer(1);
  co.send({ type: 'room:preview', roomId: room.id, image: IMAGE });
  await ask(co, room.id, owner.user.id);
  assert.equal(await ask(cv, room.id, owner.user.id), null, 'без трансляции превью не принимается');

  co.send({ type: 'room:state', roomId: room.id, screen: true });
  await cv.next('room:voice');
  co.send({ type: 'room:preview', roomId: room.id, image: IMAGE });
  await ask(co, room.id, owner.user.id);
  assert.equal(await ask(cv, room.id, owner.user.id), IMAGE);

  co.send({ type: 'room:state', roomId: room.id, screen: false });
  await cv.next('room:voice');
  assert.equal(await ask(cv, room.id, owner.user.id), null, 'после трансляции превью стирается');
  co.ws.close();
  cv.ws.close();
});

test('превью не попадает в общий список и не отдаётся посторонним', async () => {
  const { owner, room, co, cv } = await streamer(2);
  co.send({ type: 'room:state', roomId: room.id, screen: true });
  await cv.next('room:voice');
  co.send({ type: 'room:preview', roomId: room.id, image: IMAGE });
  await ask(co, room.id, owner.user.id);
  co.send({ type: 'room:state', roomId: room.id, muted: false });
  const voice = await cv.next('room:voice');
  assert.ok(!JSON.stringify(voice).includes('base64'), 'картинка разослана всем');

  const stranger = await reg('sp_stranger');
  const cs = connect(stranger.token);
  await cs.open;
  assert.equal(await ask(cs, room.id, owner.user.id), null);
  for (const c of [co, cv, cs]) c.ws.close();
});

test('чужой формат и слишком большая картинка отклоняются', async () => {
  const { owner, room, co, cv } = await streamer(3);
  co.send({ type: 'room:state', roomId: room.id, screen: true });
  await cv.next('room:voice');
  co.send({ type: 'room:preview', roomId: room.id, image: 'data:text/html;base64,AAAA' });
  await ask(co, room.id, owner.user.id);
  assert.equal(await ask(cv, room.id, owner.user.id), null);
  co.send({ type: 'room:preview', roomId: room.id, image: `data:image/jpeg;base64,${'A'.repeat(50_000)}` });
  await ask(co, room.id, owner.user.id);
  assert.equal(await ask(cv, room.id, owner.user.id), null);
  co.ws.close();
  cv.ws.close();
});
