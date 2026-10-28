// Удаление сообщений: своё — всегда, чужое в комнате — тот, кто настраивает комнату и старше автора.
// Собеседники узнают сразу, а вложения удалённого сообщения перестают раздаваться
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, connect, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, connect, befriend, reg } = server);
});

after(() => server.stop());

async function upload(token, name, type, bytes) {
  const res = await fetch(`${server.base}/api/uploads?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': type, Authorization: `Bearer ${token}` },
    body: bytes,
  });
  return res.json();
}

test('личные сообщения: удалить можно только своё, собеседник узнаёт, файл больше не отдаётся', async () => {
  const a = await reg('del_a');
  const b = await reg('del_b');
  await befriend(a, b);
  const cb = connect(b.token);
  await cb.open;

  const file = await upload(a.token, 'план.txt', 'text/plain', Buffer.from('секретный план'));
  const sent = (await api('POST', `/messages/${b.user.id}`, { text: 'смотри', attachmentIds: [file.id] }, a.token)).body;
  await cb.next('message');
  const fileUrl = `${server.base}${sent.attachments[0].url}`;
  assert.equal((await fetch(fileUrl)).status, 200);

  // Чужое удалить нельзя
  assert.equal((await api('DELETE', `/messages/${a.user.id}/${sent.id}`, null, b.token)).status, 403);
  // Своё — можно; собеседник получает событие, в истории сообщения больше нет
  assert.equal((await api('DELETE', `/messages/${b.user.id}/${sent.id}`, null, a.token)).status, 200);
  const gone = await cb.next('message:deleted');
  assert.deepEqual(gone, { type: 'message:deleted', id: sent.id, fromId: a.user.id, toId: b.user.id });
  assert.deepEqual((await api('GET', `/messages/${a.user.id}`, null, b.token)).body, []);
  assert.equal((await fetch(fileUrl)).status, 404);
  // Повторно — уже нечего удалять
  assert.equal((await api('DELETE', `/messages/${b.user.id}/${sent.id}`, null, a.token)).status, 404);
  // Сообщение другой переписки через чужой адрес не удалить
  const other = (await api('POST', `/messages/${b.user.id}`, { text: 'ещё' }, a.token)).body;
  const c = await reg('del_c');
  await befriend(a, c);
  assert.equal((await api('DELETE', `/messages/${c.user.id}/${other.id}`, null, a.token)).status, 404);
  cb.ws.close();
});

test('комнаты: своё удаляет автор, чужое — тот, кто настраивает комнату и старше', async () => {
  const owner = await reg('delr_owner');
  const mod = await reg('delr_mod');
  const guest = await reg('delr_guest');
  await befriend(owner, mod);
  await befriend(owner, guest);
  const room = (await api('POST', '/rooms', { name: 'Чат', kind: 'text', memberIds: [mod.user.id, guest.user.id] }, owner.token)).body;
  const roles = (await api('POST', `/rooms/${room.id}/roles`, { name: 'Модер', perms: 8 | 128 }, owner.token)).body.roles;
  await api('PUT', `/rooms/${room.id}/members/${mod.user.id}/role`, { roleId: roles.find((r) => r.name === 'Модер').id }, owner.token);
  const cg = connect(guest.token);
  await cg.open;

  const say = async (who, text) => (await api('POST', `/rooms/${room.id}/messages`, { text }, who.token)).body;
  const fromGuest = await say(guest, 'спам');
  const fromOwner = await say(owner, 'правила');
  const fromMod = await say(mod, 'привет');

  // Участник без права не удаляет чужое, модератор не трогает создателя
  assert.equal((await api('DELETE', `/rooms/${room.id}/messages/${fromMod.id}`, null, guest.token)).status, 403);
  assert.equal((await api('DELETE', `/rooms/${room.id}/messages/${fromOwner.id}`, null, mod.token)).status, 403);
  // Модератор удаляет сообщение участника — все в комнате узнают
  assert.equal((await api('DELETE', `/rooms/${room.id}/messages/${fromGuest.id}`, null, mod.token)).status, 200);
  assert.deepEqual(await cg.next('room:message:deleted'), { type: 'room:message:deleted', roomId: room.id, id: fromGuest.id });
  // Своё может удалить каждый
  assert.equal((await api('DELETE', `/rooms/${room.id}/messages/${fromMod.id}`, null, mod.token)).status, 200);
  const left = (await api('GET', `/rooms/${room.id}/messages`, null, owner.token)).body.map((m) => m.id);
  assert.deepEqual(left, [fromOwner.id]);
  // Не участник комнаты — комнаты для него нет
  const stranger = await reg('delr_stranger');
  assert.equal((await api('DELETE', `/rooms/${room.id}/messages/${fromOwner.id}`, null, stranger.token)).status, 404);
  cg.ws.close();
});
