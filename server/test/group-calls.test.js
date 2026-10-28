// Групповые звонки: в личный звонок добавляют друзей. Звонок на двоих идёт ровно как раньше (старые версии
// его понимают), а для троих и больше сигналы адресуются конкретному участнику, как в голосовых комнатах
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, connect, befriend, reg;

before(async () => {
  server = await startServer();
  ({ connect, befriend, reg } = server);
});

after(() => server.stop());

async function people(...names) {
  const list = [];
  for (const n of names) {
    const u = await reg(n);
    u.ws = connect(u.token);
    await u.ws.open;
    list.push(u);
  }
  return list;
}

// Звонок a → b, b принимает; group — версия умеет групповые звонки
async function call(a, b, { group = true } = {}) {
  a.ws.send({ type: 'call:invite', to: b.user.id, group });
  const { callId } = await a.ws.next('call:ringing');
  await b.ws.next('call:incoming');
  b.ws.send({ type: 'call:accept', callId, group });
  await a.ws.next('call:accepted');
  return callId;
}

test('звонок на двоих — как раньше; добавленный участник соединяется с каждым', async () => {
  const [a, b, c] = await people('gc_a', 'gc_b', 'gc_c');
  await befriend(a, b);
  await befriend(a, c);
  const callId = await call(a, b);

  // Сигнал без адресата (старые версии) — второму участнику, с пометкой от кого
  a.ws.send({ type: 'signal', callId, data: { hello: 1 } });
  assert.deepEqual(await b.ws.next('signal'), { type: 'signal', callId, from: a.user.id, data: { hello: 1 } });

  // Аня зовёт Вову: у него звонок со списком тех, кто уже разговаривает
  a.ws.send({ type: 'call:add', callId, to: c.user.id });
  const incoming = await c.ws.next('call:incoming');
  assert.equal(incoming.callId, callId);
  assert.equal(incoming.from.id, a.user.id);
  assert.equal(incoming.group, true);
  assert.deepEqual(incoming.others.map((u) => u.id).sort(), [a.user.id, b.user.id].sort());
  for (const u of [a, b]) assert.deepEqual(await u.ws.next('call:member'), { type: 'call:member', callId, userId: c.user.id, state: 'ringing' });

  // Вова принимает: ему — с кем соединяться, остальным — что он вошёл
  c.ws.send({ type: 'call:accept', callId, group: true });
  const joined = await c.ws.next('call:joined');
  assert.deepEqual(joined.peers.sort(), [a.user.id, b.user.id].sort());
  for (const u of [a, b]) assert.deepEqual(await u.ws.next('call:member'), { type: 'call:member', callId, userId: c.user.id, state: 'joined' });

  // Адресный сигнал доходит только до адресата
  c.ws.send({ type: 'signal', callId, to: b.user.id, data: { offer: 'c→b' } });
  assert.deepEqual(await b.ws.next('signal'), { type: 'signal', callId, from: c.user.id, data: { offer: 'c→b' } });

  // Боря ушёл — звонок продолжается у двоих
  b.ws.send({ type: 'call:hangup', callId });
  for (const u of [a, c]) assert.deepEqual(await u.ws.next('call:member'), { type: 'call:member', callId, userId: b.user.id, state: 'left' });
  // Аня ушла — Вова остался один, звонок закончен
  a.ws.send({ type: 'call:hangup', callId });
  assert.equal((await c.ws.next('call:ended')).reason, 'hangup');
  for (const u of [a, b, c]) u.ws.ws.close();
});

test('позвать в звонок: только друга, не старую версию; отказ видят все', async () => {
  const [a, b, c, d, old] = await people('gc2_a', 'gc2_b', 'gc2_c', 'gc2_d', 'gc2_old');
  for (const u of [b, c, old]) await befriend(a, u);
  const callId = await call(a, b);

  // Не друг — нельзя
  a.ws.send({ type: 'call:add', callId, to: d.user.id });
  assert.deepEqual(await a.ws.next('call:add:failed'), { type: 'call:add:failed', callId, to: d.user.id, reason: 'not-contact' });

  // Чужой звонок не расширить
  c.ws.send({ type: 'call:add', callId, to: c.user.id });
  // Отказ: все в звонке узнают
  a.ws.send({ type: 'call:add', callId, to: c.user.id });
  await c.ws.next('call:incoming');
  c.ws.send({ type: 'call:decline', callId });
  await a.ws.next('call:member'); // ringing
  assert.deepEqual(await a.ws.next('call:member'), { type: 'call:member', callId, userId: c.user.id, state: 'declined' });
  assert.equal((await b.ws.next('call:member')).state, 'ringing');
  assert.equal((await b.ws.next('call:member')).state, 'declined');

  // Старая версия, принявшая групповой звонок, в него не попадает
  a.ws.send({ type: 'call:add', callId, to: old.user.id });
  await old.ws.next('call:incoming');
  old.ws.send({ type: 'call:accept', callId });
  assert.equal((await old.ws.next('call:ended')).reason, 'old-version');
  for (const u of [a, b, c, d, old]) u.ws.ws.close();
});

test('в звонок со старой версией добавить нельзя', async () => {
  const [a, b, c] = await people('gc3_a', 'gc3_b', 'gc3_c');
  await befriend(a, b);
  await befriend(a, c);
  const callId = await call(a, b, { group: false });
  a.ws.send({ type: 'call:add', callId, to: c.user.id });
  assert.deepEqual(await a.ws.next('call:add:failed'), { type: 'call:add:failed', callId, to: c.user.id, reason: 'old-version' });
  for (const u of [a, b, c]) u.ws.ws.close();
});
