// Короткий обрыв связи не должен рвать разговор: сервер держит место участника, пока идёт окно
// ожидания, а вернувшееся приложение просит вернуть его в тот же звонок (call:resume).
// Звук при этом идёт напрямую между компьютерами, поэтому секундный обрыв вообще не влияет на разговор
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, connect, befriend, reg;

before(async () => {
  // Окно ожидания короткое, чтобы тест не ждал двадцать секунд
  server = await startServer({ env: { CALL_RECONNECT_GRACE_MS: '700' } });
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

async function call(a, b) {
  a.ws.send({ type: 'call:invite', to: b.user.id });
  const { callId } = await a.ws.next('call:ringing');
  await b.ws.next('call:incoming');
  b.ws.send({ type: 'call:accept', callId });
  await a.ws.next('call:accepted');
  return callId;
}

test('секундный обрыв связи не рвёт звонок: собеседник видит «переподключается», разговор продолжается', async () => {
  const [a, b] = await people('rc_anna', 'rc_boris');
  await befriend(a, b);
  const callId = await call(a, b);

  a.ws.ws.close();
  const away = await b.ws.next('call:member');
  assert.equal(away.state, 'reconnecting');
  assert.equal(away.userId, a.user.id);

  // Приложение вернулось и просит вернуть его в тот же звонок
  a.ws = connect(a.token);
  await a.ws.open;
  a.ws.send({ type: 'call:resume', callId });
  const resumed = await a.ws.next('call:resumed');
  assert.equal(resumed.callId, callId);

  const back = await b.ws.next('call:member');
  assert.equal(back.state, 'joined');

  // Сигналы снова доходят до вернувшегося: новое соединение привязано к тому же звонку
  b.ws.send({ type: 'signal', callId, data: { type: 'offer', sdp: 'v=0' } });
  const signal = await a.ws.next('signal');
  assert.equal(signal.data.sdp, 'v=0');
});

test('если за окно ожидания человек не вернулся — звонок завершается, как раньше', async () => {
  const [c, d] = await people('rc_vera', 'rc_gleb');
  await befriend(c, d);
  await call(c, d);

  c.ws.ws.close();
  const away = await d.ws.next('call:member');
  assert.equal(away.state, 'reconnecting');

  const ended = await d.ws.next('call:ended');
  assert.equal(ended.reason, 'disconnected');
});

test('вернувшийся опоздал: ему говорят, что звонок уже завершён, а не молчат', async () => {
  const [e, f] = await people('rc_dina', 'rc_egor');
  await befriend(e, f);
  const callId = await call(e, f);

  e.ws.ws.close();
  await f.ws.next('call:ended');

  e.ws = connect(e.token);
  await e.ws.open;
  e.ws.send({ type: 'call:resume', callId });
  const answer = await e.ws.next('call:ended');
  assert.equal(answer.reason, 'disconnected');
});
