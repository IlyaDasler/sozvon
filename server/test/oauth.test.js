import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { oauthEnv, startMockOAuth } from './mock-oauth.js';

const port = 3990 + Math.floor(Math.random() * 9);
const base = `http://localhost:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-oauth-'));
const verifier = 'v'.repeat(43);
let proc;
let mock;

async function api(method, url, body, token) {
  const res = await fetch(base + '/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// Имитируем то, что делает приложение после возврата из браузера
const oauth = (provider, extra = {}, token) =>
  api(
    'POST',
    `/oauth/${provider}`,
    { code: `${provider}-code`, codeVerifier: verifier, state: 's'.repeat(22), mode: 'login', ...extra },
    token
  );

before(async () => {
  mock = await startMockOAuth();
  proc = spawn(process.execPath, ['src/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      INVITE_CODE: 'friends',
      AUTH_RATE_LIMIT: '100',
      ...oauthEnv(mock.address().port),
    },
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
  mock.close();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

test('регистрация, вход и привязка через Google, Яндекс и VK', async () => {
  const providers = (await api('GET', '/oauth/providers')).body;
  assert.deepEqual(providers.map((p) => p.id), ['google', 'yandex', 'vk']);

  const { body: link } = await api('GET', `/oauth/google/url?state=${'s'.repeat(22)}&challenge=${'c'.repeat(43)}`);
  const authUrl = new URL(link.url);
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'http://127.0.0.1:47615/callback');
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal((await api('GET', '/oauth/google/url?state=x&challenge=y')).status, 400);
  assert.equal((await api('GET', `/oauth/github/url?state=${'s'.repeat(22)}&challenge=${'c'.repeat(43)}`)).status, 404);

  // Без кода приглашения профиль не создаётся, но приходит пропуск — повторно входить в сервис не нужно
  const pending = await oauth('google');
  assert.equal(pending.status, 403);
  assert.equal(pending.body.needInvite, true);
  const { ticket } = pending.body;
  assert.equal((await api('GET', '/me', null, ticket)).status, 401, 'пропуск — не токен входа');
  assert.equal((await api('POST', '/signup/complete', { ticket, inviteCode: 'wrong' })).status, 403);
  assert.equal((await api('POST', '/signup/complete', { ticket: ticket.replace(/.$/, 'A'), inviteCode: 'friends' })).status, 400);

  const created = await api('POST', '/signup/complete', { ticket, inviteCode: 'friends' });
  assert.equal(created.status, 200);
  assert.equal(created.body.created, true);
  const ivan = created.body.user;
  assert.equal(ivan.username, 'ivan.petrov');
  assert.equal(ivan.displayName, 'Иван Петров');
  assert.equal(ivan.hasPassword, false);
  assert.deepEqual(ivan.identities, [{ provider: 'google', email: 'ivan.petrov@gmail.com' }]);

  // Повторный вход попадает в тот же профиль, код больше не нужен
  const again = await oauth('google');
  assert.equal(again.body.user.id, ivan.id);
  assert.equal(again.body.created, undefined);
  const token = again.body.token;

  // Привязываем Яндекс и входим через него
  const linked = await oauth('yandex', { mode: 'link' }, token);
  assert.equal(linked.status, 200);
  assert.equal(linked.body.identities.length, 2);
  assert.equal((await oauth('yandex')).body.user.id, ivan.id);
  assert.equal((await oauth('yandex', { mode: 'link' })).status, 401);

  // VK создаёт отдельный профиль, и его нельзя привязать к Ивану
  const maria = await oauth('vk', { inviteCode: 'friends', deviceId: 'device-1' });
  assert.equal(maria.status, 200);
  assert.equal(maria.body.user.username, 'maria');
  assert.equal((await oauth('vk', { mode: 'link', deviceId: 'device-1' }, token)).status, 409);

  // Неверный код от сервиса — ошибка, а не падение сервера
  assert.equal((await oauth('google', { code: 'wrong' })).status, 502);

  // Без пароля нельзя отвязать последний способ входа
  assert.equal((await api('DELETE', '/me/identities/google', null, token)).status, 200);
  assert.equal((await api('DELETE', '/me/identities/yandex', null, token)).status, 400);
  const withPassword = await api('PATCH', '/me', { newPassword: 'secret1' }, token);
  assert.equal(withPassword.body.hasPassword, true);
  assert.equal((await api('DELETE', '/me/identities/yandex', null, token)).status, 200);

  const login = await api('POST', '/login', { username: 'ivan.petrov', password: 'secret1' });
  assert.equal(login.status, 200);
  assert.deepEqual(login.body.user.identities, []);
});
