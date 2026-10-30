// Сессии: каждый вход — отдельное устройство, его можно отключить; смена пароля отключает всех остальных;
// токены старых версий живут до первого такого действия. Проверка пароля не останавливает сервер.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from './helpers.js';

const PASSWORD = 'secret-pass1';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-sessions-'));
let server, api, connect, reg;

before(async () => {
  server = await startServer({ dataDir });
  ({ api, connect, reg } = server);
});

after(() => server.stop());

const login = async (username, password = PASSWORD) => (await api('POST', '/login', { username, password })).body;
const alive = async (token) => (await api('GET', '/me', null, token)).status === 200;

/** Сокет закрылся сервером */
const closed = (client) => new Promise((resolve, reject) => {
  client.ws.once('close', resolve);
  setTimeout(() => reject(new Error('Сокет не закрылся')), 3000);
});

async function register(name) {
  const body = (await api('POST', '/register', { username: name, password: PASSWORD, displayName: name, inviteCode: 'friends' })).body;
  return body;
}

/** Токен, какой выдавали версии до сессий: без sid */
function legacyToken(userId) {
  const secret = fs.readFileSync(path.join(dataDir, 'secret.key'), 'utf8').trim();
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + 86_400_000 })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

test('проверка пароля не останавливает сервер: пока она идёт, успевает другая работа', async () => {
  process.env.DATA_DIR ||= dataDir;
  const { hashPassword, verifyPassword } = await import('../src/auth.js');
  const stored = await hashPassword('пароль');
  let otherWork = false;
  const check = verifyPassword('пароль', stored);
  setImmediate(() => (otherWork = true));
  assert.equal(await check, true);
  assert.equal(otherWork, true);
  assert.equal(await verifyPassword('другой', stored), false);
  assert.equal(await verifyPassword('пароль', ''), false);
});

test('каждый вход — отдельное устройство, отключённое теряет доступ сразу', async () => {
  const first = await register('s_dev');
  const second = await login('s_dev');
  const list = (await api('GET', '/sessions', null, second.token)).body;
  assert.equal(list.length, 2);
  assert.equal(list.filter((s) => s.current).length, 1);
  assert.ok(list.every((s) => s.id && s.device && s.createdAt && s.lastSeen));

  const firstSession = list.find((s) => !s.current);
  const socket = connect(first.token);
  await socket.open;
  const gone = closed(socket);
  assert.equal((await api('DELETE', `/sessions/${firstSession.id}`, null, second.token)).status, 200);
  await gone;
  assert.equal(await alive(first.token), false);
  assert.equal(await alive(second.token), true);
});

test('чужую сессию отключить нельзя', async () => {
  const a = await register('s_a');
  const b = await register('s_b');
  const id = (await api('GET', '/sessions', null, a.token)).body[0].id;
  assert.equal((await api('DELETE', `/sessions/${id}`, null, b.token)).status, 404);
  assert.equal(await alive(a.token), true);
});

test('«выйти везде»: остальные отключены, это устройство работает', async () => {
  const first = await register('s_all');
  const second = await login('s_all');
  assert.equal((await api('POST', '/sessions/revoke-others', null, second.token)).status, 200);
  assert.equal(await alive(first.token), false);
  assert.equal(await alive(second.token), true);
});

test('смена пароля отключает остальные устройства и старые токены, это устройство остаётся', async () => {
  const first = await register('s_pw');
  const second = await login('s_pw');
  const old = legacyToken(first.user.id);
  assert.equal(await alive(old), true);
  const changed = await api('PATCH', '/me', { currentPassword: PASSWORD, newPassword: 'another-pass2' }, second.token);
  assert.equal(changed.status, 200);
  assert.equal(await alive(first.token), false);
  assert.equal(await alive(old), false);
  assert.equal(await alive(second.token), true);
  assert.equal(changed.body.token, undefined);
});

test('смена пароля с токеном старой версии: токен заменяется новым', async () => {
  const first = await register('s_pw2');
  const old = legacyToken(first.user.id);
  const changed = await api('PATCH', '/me', { currentPassword: PASSWORD, newPassword: 'another-pass2' }, old);
  assert.equal(await alive(old), false);
  assert.equal(await alive(changed.body.token), true);
});

test('токен старой версии работает и после «выйти везде» не работает', async () => {
  const first = await register('s_old');
  const old = legacyToken(first.user.id);
  assert.equal(await alive(old), true);
  const result = await api('POST', '/sessions/revoke-others', null, old);
  assert.equal(result.status, 200);
  assert.equal(await alive(old), false);
  assert.equal(await alive(first.token), false);
  assert.equal(await alive(result.body.token), true);
});

test('билет WebSocket: одноразовый, без токена в адресе; отключённой сессии сокет не открыть', async () => {
  const user = await register('s_ws');
  const { ticket } = (await api('POST', '/ws-ticket', null, user.token)).body;
  const open = (t) => new Promise((resolve) => {
    const ws = new WebSocket(`${server.base.replace('http', 'ws')}/ws?ticket=${encodeURIComponent(t)}`);
    ws.once('open', () => {
      ws.close();
      resolve(true);
    });
    ws.once('error', () => resolve(false));
  });
  assert.equal(await open(ticket), true);
  assert.equal(await open(ticket), false);
  assert.equal(await open('чужой'), false);
});
