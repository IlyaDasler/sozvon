// Регистрация по почте с кодом подтверждения и сброс пароля. Письма вместо отправки пишутся в файл (MAIL_TEST_FILE).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 4100 + Math.floor(Math.random() * 90);
const base = `http://localhost:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-email-'));
const mailFile = path.join(dataDir, 'mail.jsonl');
let proc;

async function api(method, url, body, token) {
  const res = await fetch(base + '/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const letters = () => (fs.existsSync(mailFile) ? fs.readFileSync(mailFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);
const lastCode = (to, purpose) => letters().filter((l) => l.to === to && l.purpose === purpose).at(-1)?.code;

before(async () => {
  proc = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, AUTH_RATE_LIMIT: '100', MAIL_TEST_FILE: mailFile, INVITE_CODE: '' },
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

test('регистрация по почте с кодом, вход по почте и сброс пароля', async () => {
  assert.equal((await api('GET', '/health')).body.emailCodes, true);

  // Без кода и с плохим адресом не регистрирует
  assert.equal((await api('POST', '/register/code', { email: 'не почта' })).status, 400);
  assert.equal((await api('POST', '/register', { email: 'anna@mail.ru', password: 'secret1', displayName: 'Аня' })).status, 400);

  assert.equal((await api('POST', '/register/code', { email: ' Anna@Mail.ru ' })).status, 200);
  const code = lastCode('anna@mail.ru', 'register');
  assert.match(code, /^\d{6}$/);
  // Повторно — не раньше чем через минуту
  assert.equal((await api('POST', '/register/code', { email: 'anna@mail.ru' })).status, 429);

  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal((await api('POST', '/register', { email: 'anna@mail.ru', password: 'secret1', code: wrong })).status, 400);
  const reg = await api('POST', '/register', { email: 'ANNA@mail.ru', password: 'secret1', displayName: 'Аня', code });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.created, true);
  assert.equal(reg.body.user.email, 'anna@mail.ru');
  assert.equal(reg.body.user.username, 'anna');
  assert.equal(reg.body.user.displayName, 'Аня');
  // Код одноразовый, почта занята
  assert.equal((await api('POST', '/register', { email: 'anna@mail.ru', password: 'secret1', code })).status, 409);
  assert.equal((await api('POST', '/register/code', { email: 'anna@mail.ru' })).status, 409);

  // Вход по почте (в любом регистре) и по логину
  assert.equal((await api('POST', '/login', { username: 'Anna@Mail.RU', password: 'secret1' })).status, 200);
  assert.equal((await api('POST', '/login', { username: 'anna', password: 'secret1' })).status, 200);
  assert.equal((await api('POST', '/login', { username: 'anna@mail.ru', password: 'wrong12' })).status, 401);

  // Сброс пароля: на чужую почту письмо не уходит, но и ошибки нет — чтобы нельзя было проверять, кто зарегистрирован
  const before = letters().length;
  assert.equal((await api('POST', '/password/code', { email: 'nobody@mail.ru' })).status, 200);
  assert.equal(letters().length, before);
  assert.equal((await api('POST', '/password/code', { email: 'anna@mail.ru' })).status, 200);
  const reset = lastCode('anna@mail.ru', 'reset');
  assert.equal((await api('POST', '/password/reset', { email: 'anna@mail.ru', code: wrong === reset ? '222222' : wrong, password: 'newpass1' })).status, 400);
  const done = await api('POST', '/password/reset', { email: 'anna@mail.ru', code: reset, password: 'newpass1' });
  assert.equal(done.status, 200);
  assert.ok(done.body.token);
  assert.equal((await api('POST', '/login', { username: 'anna@mail.ru', password: 'secret1' })).status, 401);
  assert.equal((await api('POST', '/login', { username: 'anna@mail.ru', password: 'newpass1' })).status, 200);

  // Старые версии приложения регистрируются по логину, как раньше
  const legacy = await api('POST', '/register', { username: 'old_client', password: 'secret1', displayName: 'Старый' });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.user.email, null);
});
