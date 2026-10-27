import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const port = 3900 + Math.floor(Math.random() * 90);
const base = `http://localhost:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-test-'));
let proc;

async function api(method, url, body, token) {
  const res = await fetch(base + '/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// Клиент WebSocket с очередью входящих сообщений
function connect(token) {
  const ws = new WebSocket(`ws://localhost:${port}/ws?token=${encodeURIComponent(token)}`);
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.type === msg.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  return {
    ws,
    open: new Promise((r) => ws.once('open', r)),
    send: (msg) => ws.send(JSON.stringify(msg)),
    next(type) {
      const i = queue.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ type, resolve });
        setTimeout(() => reject(new Error(`Не дождались ${type}`)), 3000);
      });
    },
  };
}

before(async () => {
  proc = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, INVITE_CODE: 'friends' },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Сервер не запустился');
});

after(async () => {
  const exited = new Promise((r) => proc.once('exit', r));
  proc.kill();
  await exited;
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

test('регистрация, вход, друзья, сообщения и звонок', async () => {
  const invite = { inviteCode: 'friends' };
  assert.equal((await api('POST', '/register', { username: 'ilya', password: 'secret1' })).status, 403);

  const a = await api('POST', '/register', { username: 'Ilya', password: 'secret1', displayName: 'Илья', ...invite });
  assert.equal(a.status, 200);
  assert.equal(a.body.user.username, 'ilya');

  assert.equal((await api('POST', '/register', { username: 'ilya', password: 'secret1', ...invite })).status, 409);
  assert.equal((await api('POST', '/register', { username: 'x', password: 'secret1', ...invite })).status, 400);
  assert.equal((await api('POST', '/login', { username: 'ilya', password: 'wrong!' })).status, 401);
  assert.equal((await api('GET', '/me', null, 'garbage')).status, 401);

  const b = await api('POST', '/register', { username: 'misha', password: 'secret2', ...invite });
  const login = await api('POST', '/login', { username: 'ILYA', password: 'secret1' });
  assert.equal(login.status, 200);
  const ta = login.body.token;
  const tb = b.body.token;

  const added = await api('POST', '/contacts', { username: 'misha' }, ta);
  assert.equal(added.status, 200);
  assert.equal((await api('GET', '/contacts', null, tb)).body[0].username, 'ilya');

  const ca = connect(ta);
  const cb = connect(tb);
  await Promise.all([ca.open, cb.open]);

  const msg = await api('POST', `/messages/${b.body.user.id}`, { text: 'Привет, го в игру?' }, ta);
  assert.equal(msg.status, 200);
  assert.equal((await cb.next('message')).message.text, 'Привет, го в игру?');
  assert.equal((await api('GET', `/messages/${a.body.user.id}`, null, tb)).body.length, 1);

  ca.send({ type: 'call:invite', to: b.body.user.id });
  const { callId } = await ca.next('call:ringing');
  const incoming = await cb.next('call:incoming');
  assert.equal(incoming.callId, callId);
  assert.equal(incoming.from.displayName, 'Илья');

  cb.send({ type: 'call:accept', callId });
  await ca.next('call:accepted');

  ca.send({ type: 'signal', callId, data: { sdp: { type: 'offer', sdp: 'test' } } });
  assert.deepEqual((await cb.next('signal')).data, { sdp: { type: 'offer', sdp: 'test' } });

  ca.send({ type: 'call:hangup', callId });
  assert.equal((await cb.next('call:ended')).reason, 'hangup');

  const ice = await api('GET', '/ice', null, ta);
  assert.ok(Array.isArray(ice.body.iceServers));

  ca.ws.close();
  assert.equal((await cb.next('presence')).online, false);
  cb.ws.close();
});
