// Защита входа: длина пароля, раздельные лимиты, перебор одного аккаунта, двухфакторный вход
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const PASSWORD = 'secret-pass1';
let server, api;

before(async () => {
  server = await startServer();
  ({ api } = server);
});

after(() => server.stop());

const register = async (name) => (await api('POST', '/register', { username: name, password: PASSWORD, displayName: name, inviteCode: 'friends' })).body;
const login = (username, extra = {}) => api('POST', '/login', { username, password: PASSWORD, ...extra });

/** Код из приложения-аутентификатора (RFC 6238) */
function totp(secret, step = Math.floor(Date.now() / 30_000)) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = crypto.createHmac('sha1', key).update(counter).digest();
  const at = hash[19] & 15;
  return String((hash.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function enable2fa(user) {
  const setup = (await api('POST', '/me/2fa/setup', { password: PASSWORD }, user.token)).body;
  const done = await api('POST', '/me/2fa/enable', { code: totp(setup.secret) }, user.token);
  assert.equal(done.status, 200);
  return { secret: setup.secret, uri: setup.uri, recovery: done.body.recoveryCodes };
}

test('новый пароль — от 8 символов', async () => {
  const short = await api('POST', '/register', { username: 'pw_short', password: 'short12', inviteCode: 'friends' });
  assert.equal(short.status, 400);
  assert.equal((await api('POST', '/register', { username: 'pw_ok', password: 'long-enough', inviteCode: 'friends' })).status, 200);
});

test('подбор пароля одного аккаунта: после 10 ошибок вход закрыт на время, у других работает', async () => {
  await register('lock_a');
  await register('lock_b');
  for (let i = 0; i < 10; i++) assert.equal((await login('lock_a', { password: 'wrong-pass' })).status, 401);
  assert.equal((await login('lock_a')).status, 429);
  assert.equal((await login('lock_b')).status, 200);
});

test('удачный вход обнуляет счётчик ошибок', async () => {
  await register('lock_c');
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 6; i++) await login('lock_c', { password: 'wrong-pass' });
    assert.equal((await login('lock_c')).status, 200);
  }
});

test('лимиты раздельные: вход не блокирует регистрацию с того же адреса', async () => {
  const s = await startServer({ env: { AUTH_RATE_LIMIT: '3' } });
  for (let i = 0; i < 3; i++) await s.api('POST', '/login', { username: 'nobody', password: 'wrong-pass' });
  assert.equal((await s.api('POST', '/login', { username: 'nobody', password: 'wrong-pass' })).status, 429);
  assert.equal((await s.api('POST', '/register', { username: 'after_limit', password: PASSWORD, inviteCode: 'friends' })).status, 200);
  await s.stop();
});

test('2FA: включение, вход с кодом, без кода и с неверным — нет', async () => {
  const user = await register('tf_a');
  const { secret, uri } = await enable2fa(user);
  assert.match(uri, /^otpauth:\/\/totp\/.*secret=/);
  assert.equal((await api('GET', '/me', null, user.token)).body.twoFactor, true);

  const noCode = await login('tf_a');
  assert.equal(noCode.status, 403);
  assert.equal(noCode.body.needTotp, true);
  assert.equal(noCode.body.token, undefined);
  assert.equal((await login('tf_a', { totpCode: '000000' })).status, 401);

  // Включение уже использовало текущий код: повтор не проходит, следующий проходит
  const step = Math.floor(Date.now() / 30_000);
  assert.equal((await login('tf_a', { totpCode: totp(secret, step) })).status, 401);
  assert.equal((await login('tf_a', { totpCode: totp(secret, step + 1) })).status, 200);
});

test('2FA: включить можно только с паролем и верным кодом', async () => {
  const user = await register('tf_b');
  assert.equal((await api('POST', '/me/2fa/setup', { password: 'wrong-pass' }, user.token)).status, 400);
  await api('POST', '/me/2fa/setup', { password: PASSWORD }, user.token);
  assert.equal((await api('POST', '/me/2fa/enable', { code: '000000' }, user.token)).status, 400);
  assert.equal((await api('GET', '/me', null, user.token)).body.twoFactor, false);
});

test('2FA: резервный код срабатывает один раз; отключить — по коду', async () => {
  const user = await register('tf_c');
  const { secret, recovery } = await enable2fa(user);
  assert.equal(recovery.length, 10);
  assert.equal((await login('tf_c', { totpCode: recovery[0] })).status, 200);
  assert.equal((await login('tf_c', { totpCode: recovery[0] })).status, 401);
  assert.equal((await api('POST', '/me/2fa/disable', { code: '000000' }, user.token)).status, 400);
  assert.equal((await api('POST', '/me/2fa/disable', { code: recovery[1] }, user.token)).status, 200);
  assert.equal((await login('tf_c')).status, 200);
  assert.ok(secret);
});

test('2FA: сброс пароля по почте не выдаёт вход в обход кода', async () => {
  // Почта на тестовом сервере — файл с кодами
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const mailbox = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-mail-')), 'mail.log');
  const s = await startServer({ env: { MAIL_TEST_FILE: mailbox } });
  const email = 'tf@example.com';
  await s.api('POST', '/register/code', { email, inviteCode: 'friends' });
  const code = () => JSON.parse(fs.readFileSync(mailbox, 'utf8').trim().split('\n').at(-1)).code;
  const user = (await s.api('POST', '/register', { email, password: PASSWORD, code: code(), inviteCode: 'friends' })).body;
  const setup = (await s.api('POST', '/me/2fa/setup', { password: PASSWORD }, user.token)).body;
  await s.api('POST', '/me/2fa/enable', { code: totp(setup.secret) }, user.token);

  await s.api('POST', '/password/code', { email });
  const reset = await s.api('POST', '/password/reset', { email, code: code(), password: 'new-password-1' });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.token, undefined);
  assert.equal(reset.body.needLogin, true);
  assert.equal((await s.api('POST', '/login', { username: email, password: 'new-password-1' })).body.needTotp, true);
  await s.stop();
});
