// Группы комнат в канале и время идущего разговора в голосовой комнате
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, connect, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, connect, befriend, reg } = server);
});

after(() => server.stop());

async function hubWith(tag) {
  const owner = await reg(`rg_o${tag}`);
  const member = await reg(`rg_m${tag}`);
  await befriend(owner, member);
  const hub = (await api('POST', '/hubs', { name: 'Группы' }, owner.token)).body;
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [member.user.id] }, owner.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, member.token);
  const room = (await api('POST', '/rooms', { name: 'голос', kind: 'voice', hubId: hub.id }, owner.token)).body;
  return { owner, member, hub, room };
}

const roomOf = async (id, token) => (await api('GET', '/rooms', null, token)).body.find((r) => r.id === id);

test('управляющий создаёт и переименовывает группу, участник — нет', async () => {
  const { owner, member, hub } = await hubWith(1);
  assert.deepEqual(hub.groups, []);
  assert.equal((await api('POST', `/hubs/${hub.id}/groups`, { name: 'Игры' }, member.token)).status, 403);
  assert.equal((await api('POST', `/hubs/${hub.id}/groups`, { name: '' }, owner.token)).status, 400);
  const made = await api('POST', `/hubs/${hub.id}/groups`, { name: 'Игровые комнаты' }, owner.token);
  assert.equal(made.body.groups[0].name, 'Игровые комнаты');
  const id = made.body.groups[0].id;
  assert.equal((await api('PATCH', `/hubs/${hub.id}/groups/${id}`, { name: 'Х' }, member.token)).status, 403);
  const renamed = await api('PATCH', `/hubs/${hub.id}/groups/${id}`, { name: 'Рабочие' }, owner.token);
  assert.equal(renamed.body.groups[0].name, 'Рабочие');
});

test('комната входит в группу и выходит из неё; чужая группа не подходит', async () => {
  const { owner, member, hub, room } = await hubWith(2);
  const { body } = await api('POST', `/hubs/${hub.id}/groups`, { name: 'Игры' }, owner.token);
  const group = body.groups[0];
  assert.equal(room.groupId, null);
  assert.equal((await api('PATCH', `/rooms/${room.id}`, { groupId: group.id }, member.token)).status, 403);
  const moved = await api('PATCH', `/rooms/${room.id}`, { groupId: group.id }, owner.token);
  assert.equal(moved.body.groupId, group.id);

  const other = await hubWith(3);
  const foreign = (await api('POST', `/hubs/${other.hub.id}/groups`, { name: 'Чужая' }, other.owner.token)).body.groups[0];
  assert.equal((await api('PATCH', `/rooms/${room.id}`, { groupId: foreign.id }, owner.token)).status, 400);

  const out = await api('PATCH', `/rooms/${room.id}`, { groupId: null }, owner.token);
  assert.equal(out.body.groupId, null);
});

test('комнату можно создать сразу в группе; удаление группы комнаты не трогает', async () => {
  const { owner, member, hub } = await hubWith(4);
  const group = (await api('POST', `/hubs/${hub.id}/groups`, { name: 'Игры' }, owner.token)).body.groups[0];
  const room = (await api('POST', '/rooms', { name: 'внутри', kind: 'text', hubId: hub.id, groupId: group.id }, owner.token)).body;
  assert.equal(room.groupId, group.id);
  assert.equal((await api('DELETE', `/hubs/${hub.id}/groups/${group.id}`, null, member.token)).status, 403);
  const left = await api('DELETE', `/hubs/${hub.id}/groups/${group.id}`, null, owner.token);
  assert.deepEqual(left.body.groups, []);
  const after = await api('PATCH', `/rooms/${room.id}`, { name: 'внутри' }, owner.token);
  assert.equal(after.status, 200, 'комната осталась');
  assert.equal(after.body.groupId, null);
});

test('время разговора идёт от первого вошедшего и не сбрасывается, пока кто-то в голосе', async () => {
  const { owner, member, room } = await hubWith(5);
  const co = connect(owner.token);
  const cm = connect(member.token);
  await Promise.all([co.open, cm.open]);
  assert.equal(room.voiceSince, null);

  const before = Date.now();
  co.send({ type: 'room:join', roomId: room.id, muted: true });
  await co.next('room:joined');
  const first = await cm.next('room:voice');
  assert.ok(first.since >= before);

  await new Promise((r) => setTimeout(r, 30));
  cm.send({ type: 'room:join', roomId: room.id, muted: true });
  await cm.next('room:joined');
  assert.equal((await cm.next('room:voice')).since, first.since, 'второй вошёл — время то же');

  co.send({ type: 'room:leave', roomId: room.id });
  assert.equal((await cm.next('room:voice')).since, first.since, 'первый вышел, разговор идёт');

  cm.send({ type: 'room:leave', roomId: room.id });
  assert.equal((await cm.next('room:voice')).since, null, 'все вышли — разговор закончен');
  co.ws.close();
  cm.ws.close();
});
