// Что прочитано, хранит сервер: счётчики переживают перезапуск и совпадают на всех устройствах человека
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, connect, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, connect, befriend, reg } = server);
});

after(() => server.stop());

const unread = async (token) => (await api('GET', '/unread', null, token)).body;

test('личный чат: непрочитанное считается, своё — нет, «прочитано» обнуляет и доходит до других устройств', async () => {
  const a = await reg('rs_a');
  const b = await reg('rs_b');
  await befriend(a, b);
  const first = (await api('POST', `/messages/${b.user.id}`, { text: 'раз' }, a.token)).body;
  await api('POST', `/messages/${b.user.id}`, { text: 'два' }, a.token);
  await api('POST', `/messages/${a.user.id}`, { text: 'ответ' }, b.token);

  assert.deepEqual((await unread(b.token)).dm, [{ peerId: a.user.id, count: 2, lastRead: first.id - 1 }]);
  assert.equal((await unread(a.token)).dm[0].count, 1);

  const otherDevice = connect(b.token);
  await otherDevice.open;
  assert.equal((await api('POST', '/read', { conv: `dm:${a.user.id}` }, b.token)).status, 200);
  assert.equal((await otherDevice.next('read')).conv, `dm:${a.user.id}`);
  assert.deepEqual((await unread(b.token)).dm, []);

  await api('POST', `/messages/${b.user.id}`, { text: 'три' }, a.token);
  assert.equal((await unread(b.token)).dm[0].count, 1);
});

test('комната: считается только у участника; чужую комнату отметить нельзя', async () => {
  const a = await reg('rr_a');
  const b = await reg('rr_b');
  const c = await reg('rr_c');
  await befriend(a, b);
  const room = (await api('POST', '/rooms', { name: 'общая', kind: 'text', memberIds: [b.user.id] }, a.token)).body;
  await api('POST', `/rooms/${room.id}/messages`, { text: 'всем' }, a.token);

  assert.equal((await unread(b.token)).rooms.find((r) => r.roomId === room.id).count, 1);
  assert.equal((await unread(a.token)).rooms.length, 0);
  assert.equal((await unread(c.token)).rooms.length, 0);
  assert.equal((await api('POST', '/read', { conv: `room:${room.id}` }, c.token)).status, 404);
  assert.equal((await api('POST', '/read', { conv: 'мусор' }, c.token)).status, 400);

  await api('POST', '/read', { conv: `room:${room.id}` }, b.token);
  assert.equal((await unread(b.token)).rooms.length, 0);
});

test('сообщения до появления счётчиков непрочитанными не считаются', async () => {
  const dataDir = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'sozvon-read-'));
  let s = await startServer({ dataDir });
  const a = await s.reg('rb_a');
  const b = await s.reg('rb_b');
  await s.befriend(a, b);
  await s.api('POST', `/messages/${b.user.id}`, { text: 'старое' }, a.token);
  await s.stop({ keepData: true });

  // База как до обновления: таблицы счётчиков ещё нет
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync((await import('node:path')).join(dataDir, 'sozvon.db'));
  db.exec('DROP TABLE read_state; DROP TABLE read_baseline');
  db.close();

  s = await startServer({ dataDir });
  assert.deepEqual((await s.api('GET', '/unread', null, b.token)).body.dm, []);
  await s.api('POST', `/messages/${b.user.id}`, { text: 'новое' }, a.token);
  assert.equal((await s.api('GET', '/unread', null, b.token)).body.dm[0].count, 1);
  await s.stop();
});
