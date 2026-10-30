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
  const other = await api('POST', '/register', { username: 'other_user', password: 'secret11', inviteCode: 'friends' });
  assert.equal((await oauth('yandex', { mode: 'link' }, other.body.token)).status, 409);

  // Неверный код от сервиса — ошибка, а не падение сервера
  assert.equal((await oauth('yandex', { code: 'wrong' })).status, 502);

  // Без пароля нельзя отвязать последний способ входа
  assert.equal((await api('DELETE', '/me/identities/yandex', null, token)).status, 400);
  const withPassword = await api('PATCH', '/me', { newPassword: 'secret11' }, token);
  assert.equal(withPassword.body.hasPassword, true);
  assert.equal((await api('DELETE', '/me/identities/yandex', null, token)).status, 200);

  const login = await api('POST', '/login', { username: 'ivan.petrov', password: 'secret11' });
  assert.equal(login.status, 200);
  assert.deepEqual(login.body.user.identities, []);
});

// В браузере ответ сервиса принимает сервер: редирект на Яндекс, возврат на /api/oauth/…/callback, затем на страницу
// с одноразовым кодом. Токен в адрес не попадает, вернуться может только браузер, начавший вход
test('вход через Яндекс в браузере: одноразовый код вместо токена в адресе', async () => {
  // Шаги до возврата со стороны сервиса; cookie — как у браузера, начавшего вход
  async function viaProvider() {
    const start = await fetch(`${base}/api/oauth/yandex/web`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const cookie = start.headers.get('set-cookie').split(';')[0];
    assert.match(start.headers.get('set-cookie'), /HttpOnly/);
    const authUrl = new URL(start.headers.get('location'));
    assert.equal(authUrl.searchParams.get('redirect_uri'), `${base}/api/oauth/yandex/callback`);
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    const fromProvider = await fetch(authUrl, { redirect: 'manual' });
    const callback = new URL(fromProvider.headers.get('location'));
    assert.equal(callback.pathname, '/api/oauth/yandex/callback');
    return { callback, cookie };
  }
  const finish = async ({ callback, cookie }) => {
    const res = await fetch(callback, { redirect: 'manual', headers: { cookie } });
    assert.equal(res.status, 302);
    return new URL(res.headers.get('location'), base).searchParams;
  };

  // Профиль новый, а сервер просит код приглашения — вместо входа приходит пропуск
  const first = await finish(await viaProvider());
  assert.equal(first.get('oauth'), null);
  const pending = await api('POST', '/oauth/web/exchange', { code: first.get('oauth_code') });
  assert.equal(pending.status, 200);
  assert.ok(pending.body.ticket, 'должен прийти пропуск для кода приглашения');
  assert.equal(pending.body.token, undefined);
  assert.equal((await api('POST', '/signup/complete', { ticket: pending.body.ticket, inviteCode: 'friends' })).status, 200);

  // Профиль есть: код меняется на обычную сессию, второй раз не срабатывает
  const again = await finish(await viaProvider());
  assert.equal(again.get('oauth'), null);
  const code = again.get('oauth_code');
  const done = await api('POST', '/oauth/web/exchange', { code });
  assert.equal(done.status, 200);
  assert.equal((await api('GET', '/me', null, done.body.token)).status, 200);
  assert.equal((await api('GET', '/sessions', null, done.body.token)).body.filter((s) => s.current).length, 1);
  assert.equal((await api('POST', '/oauth/web/exchange', { code })).status, 400);

  // Чужой браузер по ссылке с чужим state в профиль не попадёт
  const stolen = await viaProvider();
  const foreign = await finish({ ...stolen, cookie: 'sozvon_oauth=other' });
  assert.ok(foreign.get('oauth_error'));
  assert.equal(foreign.get('oauth_code'), null);

  // Неизвестный state — понятная ошибка, а не падение
  const bad = await finish({ callback: new URL(`${base}/api/oauth/yandex/callback?state=nope&code=x`), cookie: '' });
  assert.ok(bad.get('oauth_error'));
});
