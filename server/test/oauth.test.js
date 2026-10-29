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

test('вход и регистрация через Яндекс; Google и VK отключены', async () => {
  const providers = (await api('GET', '/oauth/providers')).body;
  assert.deepEqual(providers.map((p) => p.id), ['yandex']);

  const { body: link } = await api('GET', `/oauth/yandex/url?state=${'s'.repeat(22)}&challenge=${'c'.repeat(43)}`);
  const authUrl = new URL(link.url);
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'http://localhost:47615/callback');
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal((await api('GET', '/oauth/yandex/url?state=x&challenge=y')).status, 400);
  for (const gone of ['google', 'vk'])
    assert.equal((await api('GET', `/oauth/${gone}/url?state=${'s'.repeat(22)}&challenge=${'c'.repeat(43)}`)).status, 404);

  // Без кода приглашения профиль не создаётся, но приходит пропуск — повторно входить в сервис не нужно
  const pending = await oauth('yandex');
  assert.equal(pending.status, 403);
  assert.equal(pending.body.needInvite, true);
  const { ticket } = pending.body;
  assert.equal((await api('GET', '/me', null, ticket)).status, 401, 'пропуск — не токен входа');
  assert.equal((await api('POST', '/signup/complete', { ticket, inviteCode: 'wrong' })).status, 403);
  // Меняем первый символ данных пропуска (не подписи: у последнего символа base64 часть битов не значима)
  const forged = (ticket[0] === 'a' ? 'b' : 'a') + ticket.slice(1);
  assert.equal((await api('POST', '/signup/complete', { ticket: forged, inviteCode: 'friends' })).status, 400);

  const created = await api('POST', '/signup/complete', { ticket, inviteCode: 'friends' });
  assert.equal(created.status, 200);
  assert.equal(created.body.created, true);
  const ivan = created.body.user;
  assert.equal(ivan.username, 'ivan.petrov');
  assert.equal(ivan.displayName, 'Иван Петров');
  assert.equal(ivan.hasPassword, false);
  assert.deepEqual(ivan.identities, [{ provider: 'yandex', email: 'ivan.petrov@yandex.ru' }]);

  // Повторный вход попадает в тот же профиль, код больше не нужен
  const again = await oauth('yandex');
  assert.equal(again.body.user.id, ivan.id);
  assert.equal(again.body.created, undefined);
  const token = again.body.token;

  // Этот Яндекс нельзя привязать к другому профилю
  const other = await api('POST', '/register', { username: 'other_user', password: 'secret1', inviteCode: 'friends' });
  assert.equal((await oauth('yandex', { mode: 'link' }, other.body.token)).status, 409);

  // Неверный код от сервиса — ошибка, а не падение сервера
  assert.equal((await oauth('yandex', { code: 'wrong' })).status, 502);

  // Без пароля нельзя отвязать последний способ входа
  assert.equal((await api('DELETE', '/me/identities/yandex', null, token)).status, 400);
  const withPassword = await api('PATCH', '/me', { newPassword: 'secret1' }, token);
  assert.equal(withPassword.body.hasPassword, true);
  assert.equal((await api('DELETE', '/me/identities/yandex', null, token)).status, 200);

  const login = await api('POST', '/login', { username: 'ivan.petrov', password: 'secret1' });
  assert.equal(login.status, 200);
  assert.deepEqual(login.body.user.identities, []);
});

// В браузере ответ сервиса принимает сервер: редирект на Яндекс, возврат на /api/oauth/…/callback,
// затем переадресация в приложение с токеном (или с пропуском, если нужен код приглашения)
test('вход через Яндекс в браузере: сервер принимает ответ и возвращает токен', async () => {
  const start = await fetch(`${base}/api/oauth/yandex/web`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const authUrl = new URL(start.headers.get('location'));
  assert.equal(authUrl.searchParams.get('redirect_uri'), `${base}/api/oauth/yandex/callback`);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');

  // «Страница Яндекса» сразу возвращает код на наш callback
  const fromProvider = await fetch(authUrl, { redirect: 'manual' });
  assert.equal(fromProvider.status, 302);
  const callback = new URL(fromProvider.headers.get('location'));
  assert.equal(callback.pathname, '/api/oauth/yandex/callback');

  // Профиль новый, а сервер просит код приглашения — приходит пропуск, а не токен
  const pending = await fetch(callback, { redirect: 'manual' });
  assert.equal(pending.status, 302);
  const pendingBack = new URL(pending.headers.get('location'), base);
  const ticket = pendingBack.searchParams.get('oauth_need_invite');
  assert.ok(ticket, 'должен прийти пропуск для кода приглашения');
  assert.equal(pendingBack.searchParams.get('oauth'), null);

  const created = await api('POST', '/signup/complete', { ticket, inviteCode: 'friends' });
  assert.equal(created.status, 200);

  // Теперь профиль есть: повторный браузерный вход сразу даёт токен
  const again = await fetch(`${base}/api/oauth/yandex/web`, { redirect: 'manual' });
  const againAuth = new URL(again.headers.get('location'));
  const againProvider = await fetch(againAuth, { redirect: 'manual' });
  const againCallback = new URL(againProvider.headers.get('location'));
  const done = await fetch(againCallback, { redirect: 'manual' });
  assert.equal(done.status, 302);
  const back = new URL(done.headers.get('location'), base);
  const token = back.searchParams.get('oauth');
  assert.ok(token, 'должен прийти токен');
  assert.equal((await api('GET', '/me', null, token)).status, 200);

  // Неизвестный state — понятная ошибка, а не падение
  const bad = await fetch(`${base}/api/oauth/yandex/callback?state=nope&code=x`, { redirect: 'manual' });
  assert.equal(bad.status, 302);
  const badBack = new URL(bad.headers.get('location'), base);
  assert.ok(badBack.searchParams.get('oauth_error'));
});
