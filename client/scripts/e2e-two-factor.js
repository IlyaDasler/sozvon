// Двухфакторный вход глазами человека: включил в настройках по QR-коду, сохранил резервные коды, вошёл с кодом, отключил.
// Запуск (сервер должен работать): npx electron scripts/e2e-two-factor.js [адрес сервера]
const crypto = require('crypto');
const { SERVER, register, js, waitFor, openClient, runTest } = require('./e2e-lib');

function totp(secret, step) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = crypto.createHmac('sha1', key).update(counter).digest();
  return String((hash.readUInt32BE(hash[19] & 15) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const click = (id) => `document.getElementById('${id}').click(); true`;
const fill = (id, value) => `document.getElementById('${id}').value = ${JSON.stringify(value)}; true`;
const shown = (id) => `!document.getElementById('${id}').classList.contains('hidden')`;

runTest(async () => {
  const a = await register('tfa', 'Аня');
  const win = await openClient('tfa', a);
  await js(win, `openSettings(); showSettingsTab('account'); true`);
  await js(win, click('tf-start'));
  await js(win, fill('tf-password', 'test-pass-1'));
  await js(win, click('tf-next'));
  await waitFor(win, shown('tf-scan-step'), 'шаг с QR-кодом');
  if (!(await js(win, `Boolean(document.querySelector('#tf-qr svg'))`))) throw new Error('Нет QR-кода');
  const secret = await js(win, `document.getElementById('tf-secret').textContent`);
  const step = Math.floor(Date.now() / 30_000);

  await js(win, fill('tf-code', '000000'));
  await js(win, click('tf-confirm'));
  await waitFor(win, `document.getElementById('tf-error').textContent.includes('Неверный код')`, 'ошибка при неверном коде');

  await js(win, fill('tf-code', totp(secret, step)));
  await js(win, click('tf-confirm'));
  await waitFor(win, shown('tf-codes-step'), 'резервные коды');
  const recovery = (await js(win, `document.getElementById('tf-recovery').textContent`)).split('\n');
  if (recovery.length !== 10) throw new Error('Резервных кодов не 10');
  await js(win, click('tf-done'));
  if (await js(win, shown('tf-start'))) throw new Error('Кнопка «Включить» при включённом входе');
  console.log('✔ включение в настройках: QR-код, проверка кода, резервные коды');

  // Вход: сначала пароль, потом поле для кода
  await js(win, 'closeSettings(); logout(); true');
  await waitFor(win, shown('auth-form'), 'экран входа');
  await js(win, fill('server-url', SERVER));
  await js(win, fill('auth-username', a.user.username));
  await js(win, fill('auth-password', 'test-pass-1'));
  await js(win, `document.getElementById('auth-form').requestSubmit(); true`);
  await waitFor(win, shown('totp-field'), 'поле кода при входе');
  await js(win, fill('auth-totp', '000000'));
  await js(win, `document.getElementById('auth-form').requestSubmit(); true`);
  await waitFor(win, `document.getElementById('auth-error').textContent.includes('Неверный код')`, 'неверный код при входе');
  await js(win, fill('auth-totp', recovery[0]));
  await js(win, `document.getElementById('auth-form').requestSubmit(); true`);
  await waitFor(win, `Boolean(state.me)`, 'вход с резервным кодом');
  console.log('✔ вход: пароль, затем код; неверный не проходит, резервный подходит');

  await js(win, `openSettings(); showSettingsTab('account'); true`);
  await js(win, click('tf-stop'));
  await js(win, fill('tf-off-code', recovery[1]));
  await js(win, click('tf-off'));
  await waitFor(win, `state.me.twoFactor === false && ${shown('tf-start')}`, 'отключение');
  console.log('✔ отключение по коду');
});
