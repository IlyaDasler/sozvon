// Устройства: приложение подключается по одноразовому билету, список устройств в настройках, отключённое устройство
// выходит сразу, смена пароля не выбрасывает это устройство. Запуск (сервер должен работать): npx electron scripts/e2e-sessions.js
const { api, register, js, waitFor, sleep, openClient, runTest, ACCEPT_DIALOGS } = require('./e2e-lib');

const online = `document.getElementById('conn-dot').classList.contains('ok')`;

runTest(async () => {
  const a = await register('ses', 'Аня');
  const second = (await api('POST', '/login', { username: a.user.username, password: 'test-pass-1' })).token;
  const win = await openClient('ses', a);
  const other = await openClient('ses2', { ...a, token: second });
  await waitFor(win, online, 'на связи');

  if ((await js(win, 'socket.ws.url')).includes('token=')) throw new Error('Токен в адресе соединения');
  console.log('✔ соединение — по билету, токена в адресе нет');

  await js(win, ACCEPT_DIALOGS);
  await js(win, `openSettings(); showSettingsTab('account'); true`);
  await waitFor(win, `document.querySelectorAll('#device-list .identity-row').length === 2`, 'два устройства в списке');
  if (!(await js(win, `document.getElementById('device-list').textContent.includes('это устройство')`))) throw new Error('Не отмечено это устройство');
  await js(win, `document.querySelector('#device-list .btn').click(); true`);
  await waitFor(other, `document.getElementById('auth-error').textContent.includes('войдите заново') || !state.me`, 'отключённое устройство вышло', 8000);
  await waitFor(win, `document.querySelectorAll('#device-list .identity-row').length === 1`, 'в списке одно устройство');
  console.log('✔ отключённое устройство сразу выходит');

  // Смена пароля: это устройство остаётся в сети, запросы работают
  await js(win, `Api.patch('/me', { currentPassword: 'test-pass-1', newPassword: 'новый-пароль-1' }).then(() => true)`);
  await sleep(500);
  if (!(await js(win, online))) throw new Error('Смена пароля оборвала это устройство');
  if (!(await js(win, `Api.get('/me').then((u) => u.id)`))) throw new Error('После смены пароля запросы не идут');
  console.log('✔ смена пароля не выбрасывает это устройство');
});
