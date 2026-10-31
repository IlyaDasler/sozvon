// Роли живут в канале: одна роль действует во всех его комнатах, включая будущие; старые роли комнат переносятся сами
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, befriend, reg } = server);
});

after(() => server.stop());

async function hubWith(prefix, ...names) {
  const owner = await reg(`${prefix}_o`);
  const people = [];
  const hub = (await api('POST', '/hubs', { name: prefix }, owner.token)).body;
  for (const name of names) {
    const u = await reg(`${prefix}_${name}`);
    await befriend(owner, u);
    await api('POST', `/hubs/${hub.id}/invites`, { userIds: [u.user.id] }, owner.token);
    await api('POST', `/hub-invites/${hub.id}/accept`, null, u.token);
    people.push(u);
  }
  const room = async (name) => (await api('POST', '/rooms', { name, kind: 'text', hubId: hub.id }, owner.token)).body;
  return { owner, hub, people, room };
}

const canWrite = async (room, user) => (await api('POST', `/rooms/${room.id}/messages`, { text: 'привет' }, user.token)).status === 200;
const roleNamed = (hub, name) => hub.roles.find((r) => r.name === name);

test('роль канала действует во всех комнатах, и в созданной позже', async () => {
  const { owner, hub, people: [mute], room } = await hubWith('hr', 'mute');
  const first = await room('первая');
  const second = await room('вторая');
  const made = await api('POST', `/hubs/${hub.id}/roles`, { name: 'Молчун', color: '#30a46c', perms: 1 }, owner.token);
  assert.equal(made.status, 200);
  const role = roleNamed(made.body, 'Молчун');
  assert.equal((await api('PUT', `/hubs/${hub.id}/members/${mute.user.id}/role`, { roleId: role.id }, owner.token)).status, 200);

  assert.equal(await canWrite(first, mute), false);
  assert.equal(await canWrite(second, mute), false);
  assert.equal(await canWrite(await room('третья'), mute), false);

  const seen = (await api('GET', '/rooms', null, mute.token)).body.find((r) => r.id === first.id);
  assert.equal(roleNamed(seen, 'Молчун').id, role.id);
  assert.equal(seen.members.find((m) => m.id === mute.user.id).roleId, role.id);

  await api('PUT', `/hubs/${hub.id}/members/${mute.user.id}/role`, { roleId: null }, owner.token);
  assert.equal(await canWrite(first, mute), true);
});

test('права по умолчанию задаются на весь канал', async () => {
  const { owner, hub, people: [guest], room } = await hubWith('hd', 'guest');
  const first = await room('первая');
  const second = await room('вторая');
  assert.equal((await api('PATCH', `/hubs/${hub.id}`, { defaultPerms: 1 }, owner.token)).status, 200);
  assert.equal(await canWrite(first, guest), false);
  assert.equal(await canWrite(second, guest), false);
  assert.equal((await api('GET', `/hubs/${hub.id}`, null, owner.token)).status !== 500, true);
});

test('роль меняют только те, кому можно; админку раздаёт только создатель', async () => {
  const { owner, hub, people: [mod, guest] } = await hubWith('hp', 'mod', 'guest');
  assert.equal((await api('POST', `/hubs/${hub.id}/roles`, { name: 'Хочу', perms: 1 }, guest.token)).status, 403);
  const made = (await api('POST', `/hubs/${hub.id}/roles`, { name: 'Модератор', perms: 128 | 8 }, owner.token)).body;
  await api('PUT', `/hubs/${hub.id}/members/${mod.user.id}/role`, { roleId: roleNamed(made, 'Модератор').id }, owner.token);
  // Роль с правом настройки управляет ролями канала
  assert.equal((await api('POST', `/hubs/${hub.id}/roles`, { name: 'Гость', perms: 1 }, mod.token)).status, 200);
  assert.equal((await api('POST', `/hubs/${hub.id}/roles`, { name: 'Админ', perms: 256 }, mod.token)).status, 403);
  const admin = roleNamed(made, 'Администратор');
  assert.ok(admin, 'у канала есть готовая роль администратора');
  assert.equal((await api('PUT', `/hubs/${hub.id}/members/${guest.user.id}/role`, { roleId: admin.id }, mod.token)).status, 403);
});

test('удаление роли снимает её у всех; кик и бан остаются на комнату', async () => {
  const { owner, hub, people: [mute], room } = await hubWith('hx', 'mute');
  const first = await room('первая');
  const second = await room('вторая');
  const made = (await api('POST', `/hubs/${hub.id}/roles`, { name: 'Молчун', perms: 1 }, owner.token)).body;
  const role = roleNamed(made, 'Молчун');
  await api('PUT', `/hubs/${hub.id}/members/${mute.user.id}/role`, { roleId: role.id }, owner.token);
  assert.equal((await api('DELETE', `/hubs/${hub.id}/roles/${role.id}`, null, owner.token)).status, 200);
  assert.equal(await canWrite(first, mute), true);

  await api('POST', `/rooms/${first.id}/timeouts/${mute.user.id}`, { seconds: 60 }, owner.token);
  await api('POST', `/rooms/${first.id}/bans`, { userId: mute.user.id }, owner.token);
  assert.equal(await canWrite(second, mute), true, 'наказание в одной комнате не трогает другую');
});

test('старые адреса ролей комнаты работают и меняют роль канала', async () => {
  const { owner, people: [mute], room } = await hubWith('ho', 'mute');
  const first = await room('первая');
  const second = await room('вторая');
  const made = (await api('POST', `/rooms/${first.id}/roles`, { name: 'Старая', perms: 1 }, owner.token)).body;
  await api('PUT', `/rooms/${first.id}/members/${mute.user.id}/role`, { roleId: roleNamed(made, 'Старая').id }, owner.token);
  assert.equal(await canWrite(second, mute), false);
});

test('миграция: роли комнат становятся ролями канала, база цела', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-roles-'));
  let s = await startServer({ dataDir });
  const owner = await s.reg('mg_o');
  const mod = await s.reg('mg_m');
  await s.befriend(owner, mod);
  const hub = (await s.api('POST', '/hubs', { name: 'Старый' }, owner.token)).body;
  await s.api('POST', `/hubs/${hub.id}/invites`, { userIds: [mod.user.id] }, owner.token);
  await s.api('POST', `/hub-invites/${hub.id}/accept`, null, mod.token);
  const a = (await s.api('POST', '/rooms', { name: 'а', kind: 'text', hubId: hub.id }, owner.token)).body;
  const b = (await s.api('POST', '/rooms', { name: 'б', kind: 'text', hubId: hub.id }, owner.token)).body;
  await s.stop({ keepData: true });

  // База как до 2.6.3: роли в комнатах, ролей канала ещё нет
  const db = new DatabaseSync(path.join(dataDir, 'sozvon.db'));
  db.exec('DROP TABLE hub_roles; ALTER TABLE hub_members DROP COLUMN role_id; ALTER TABLE hubs DROP COLUMN default_perms; DELETE FROM room_roles');
  const add = db.prepare('INSERT INTO room_roles (room_id, name, color, perms, created_at) VALUES (?, ?, ?, ?, 1)');
  const roleA = add.run(a.id, 'Модер', '#30a46c', 128 | 8 | 1).lastInsertRowid;
  add.run(b.id, 'Модер', '#30a46c', 128 | 8 | 1);
  add.run(a.id, 'Администратор', '#e5484d', 256);
  add.run(b.id, 'Только тут', '#123456', 1);
  db.prepare('UPDATE room_members SET role_id = ? WHERE room_id = ? AND user_id = ?').run(roleA, a.id, mod.user.id);
  db.prepare('UPDATE rooms SET default_perms = 15 WHERE hub_id = ?').run(hub.id);
  db.close();

  s = await startServer({ dataDir });
  const seen = (await s.api('GET', '/rooms', null, owner.token)).body.find((r) => r.id === b.id);
  assert.deepEqual(seen.roles.map((r) => r.name).sort(), ['Администратор', 'Модер', 'Только тут']);
  assert.equal(seen.defaultPerms, 15);
  assert.equal(seen.roles.find((r) => r.id === seen.members.find((m) => m.id === mod.user.id).roleId).name, 'Модер');
  await s.stop({ keepData: true });

  // Второй запуск ничего не дублирует
  s = await startServer({ dataDir });
  assert.equal((await s.api('GET', '/rooms', null, owner.token)).body.find((r) => r.id === a.id).roles.length, 3);
  await s.stop();
});

test('участники канала показывают свою роль', async () => {
  const { owner, hub, people: [mod] } = await hubWith('hv', 'mod');
  const role = roleNamed((await api('POST', `/hubs/${hub.id}/roles`, { name: 'Модер', perms: 1 }, owner.token)).body, 'Модер');
  const assigned = (await api('PUT', `/hubs/${hub.id}/members/${mod.user.id}/role`, { roleId: role.id }, owner.token)).body;
  assert.equal(assigned.members.find((m) => m.id === mod.user.id).roleId, role.id);
  const seen = (await api('GET', '/hubs', null, owner.token)).body.find((h) => h.id === hub.id);
  assert.equal(seen.members.find((m) => m.id === mod.user.id).roleId, role.id);
});
