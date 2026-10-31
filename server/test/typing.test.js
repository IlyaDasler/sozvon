// «Печатает»: сервер передаёт только факт набора и только тем, кто в этой переписке; текст никуда не уходит
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, connect, befriend, reg;

before(async () => {
  server = await startServer();
  ({ api, connect, befriend, reg } = server);
});

after(() => server.stop());

const online = async (user) => {
  const client = connect(user.token);
  await client.open;
  return client;
};
const silent = (client) => assert.rejects(client.next('typing'), /Не дождались/);

test('личный чат: собеседник видит, с кем идёт набор, чужой человек ничего не шлёт', async () => {
  const a = await reg('ty_a');
  const b = await reg('ty_b');
  const stranger = await reg('ty_c');
  await befriend(a, b);
  const [ca, cb] = [await online(a), await online(b)];
  const cs = await online(stranger);

  ca.send({ type: 'typing', to: b.user.id });
  assert.deepEqual(await cb.next('typing'), { type: 'typing', conv: `dm:${a.user.id}`, userId: a.user.id });

  cs.send({ type: 'typing', to: b.user.id });
  await silent(cb);
});

test('комната: видят участники кроме самого пишущего, посторонний и без права писать — нет', async () => {
  const a = await reg('tr_a');
  const b = await reg('tr_b');
  const c = await reg('tr_c');
  await befriend(a, b);
  await befriend(a, c);
  const room = (await api('POST', '/rooms', { name: 'общая', kind: 'text', memberIds: [b.user.id] }, a.token)).body;
  const [ca, cb, cc] = [await online(a), await online(b), await online(c)];

  ca.send({ type: 'typing', roomId: room.id });
  assert.deepEqual(await cb.next('typing'), { type: 'typing', conv: `room:${room.id}`, userId: a.user.id });
  await silent(ca);

  cc.send({ type: 'typing', roomId: room.id });
  await silent(cb);
});
