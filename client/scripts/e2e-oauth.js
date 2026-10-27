// Сквозной тест входа через Яндекс и регистрации по почте в интерфейсе приложения.
// Поднимает свой сервер и поддельные сервисы входа; браузер пользователя заменяет обычный HTTP-запрос.
// Запуск: npx electron scripts/e2e-oauth.js   (E2E_SHOTS=папка — сохранить скриншоты)
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { listenForOAuth } = require('../oauth-loopback');

const PORT = 3200;
// Письма с кодами сервер пишет в этот файл вместо отправки
const MAIL_FILE = path.join(os.tmpdir(), `sozvon-e2e-mail-${process.pid}.jsonl`);
const SERVER = `http://localhost:${PORT}`;
const serverDir = path.join(__dirname, '..', '..', 'server');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(win, expr, what, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await win.webContents.executeJavaScript(expr)) return;
    await sleep(200);
  }
  throw new Error(`Не дождались: ${what}`);
}

async function shot(win, name) {
  if (!process.env.E2E_SHOTS) return;
  // Скрытое окно перерисовывается не сразу — просим кадр явно
  win.webContents.invalidate();
  await sleep(1200);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(process.env.E2E_SHOTS, `${name}.png`), image.toPNG());
}

// Нажимает кнопку по тексту, как это сделал бы человек
const click = (win, selector, text) =>
  win.webContents.executeJavaScript(
    `[...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.includes(${JSON.stringify(text)})).click()`
  );

async function run(serverEnv) {
  // Вместо браузера: переходим по ссылке входа, поддельный сервис сразу перенаправляет на localhost
  ipcMain.handle('oauth', async (_e, authUrl) => {
    const pending = await listenForOAuth(authUrl);
    await fetch(authUrl, { redirect: 'follow' });
    return pending.result;
  });

  const ses = session.fromPartition('e2e-oauth');
  const win = new BrowserWindow({
    // E2E_SHOW=1 — показать окно: скриншоты скрытого окна иногда отстают на кадр
    show: process.env.E2E_SHOW === '1',
    width: 1100,
    height: 720,
    webPreferences: { session: ses, preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await win.webContents.executeJavaScript(
    `localStorage.clear(); document.getElementById('server-url').value = '${SERVER}';
     document.getElementById('server-url').dispatchEvent(new Event('change')); true`
  );
  await waitFor(win, `document.querySelectorAll('.oauth-btn').length === 1`, 'кнопка Яндекса');
  if (await win.webContents.executeJavaScript(`[...document.querySelectorAll('.oauth-btn')].some((b) => /Google|VK/.test(b.textContent))`))
    throw new Error('Кнопки Google или VK всё ещё на экране');
  await shot(win, 'oauth-login');
  console.log('✔ на экране входа только Яндекс, Google и VK убраны');

  // Вход через Яндекс без профиля: приложение просит только код приглашения, повторно входить не нужно
  await click(win, '.oauth-btn', 'Яндекс');
  await waitFor(
    win,
    `Boolean(state.pendingSignup) && document.getElementById('auth-subtitle').textContent.includes('подтверждён') &&
     document.getElementById('username-field').classList.contains('hidden') &&
     !document.getElementById('invite-field').classList.contains('hidden')`,
    'экран ввода кода приглашения'
  );
  await shot(win, 'oauth-pending');
  console.log('✔ после входа через Яндекс приложение просит только код приглашения');

  await win.webContents.executeJavaScript(`document.getElementById('auth-invite').value = 'wrong'; true`);
  await click(win, '#auth-submit', 'Создать профиль');
  await waitFor(win, `document.getElementById('auth-error').textContent.includes('Неверный код')`, 'ошибка неверного кода');
  console.log('✔ с неверным кодом профиль не создаётся');

  await win.webContents.executeJavaScript(`document.getElementById('auth-invite').value = 'friends'; true`);
  await click(win, '#auth-submit', 'Создать профиль');
  await waitFor(win, `!document.getElementById('main').classList.contains('hidden')`, 'вход в приложение');
  const me = await win.webContents.executeJavaScript('state.me');
  if (me.username !== 'ivan.petrov' || me.displayName !== 'Иван Петров') throw new Error(`Не тот профиль: ${JSON.stringify(me)}`);
  console.log(`✔ регистрация через Яндекс: профиль «${me.displayName}», логин ${me.username}`);

  // Аватарка: рисуем картинку 640×480 и загружаем тем же кодом, что и кнопка «Загрузить фото»
  await win.webContents.executeJavaScript('openSettings()');
  await win.webContents.executeJavaScript(`(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const g = c.getContext('2d'); g.fillStyle = '#ff7a00'; g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#1b2a6b'; g.beginPath(); g.arc(320, 240, 170, 0, Math.PI * 2); g.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await uploadAvatar(new File([blob], 'photo.png', { type: 'image/png' }));
  })()`);
  await waitFor(win, `/^\\/api\\/avatars\\/[a-f0-9]{32}\\.webp$/.test(state.me.avatarUrl || '')`, 'загрузка аватарки');
  const avatarOk = await win.webContents.executeJavaScript(`(async () => {
    const res = await fetch(Api.base + state.me.avatarUrl);
    const bmp = await createImageBitmap(await res.blob());
    const el = document.getElementById('set-avatar');
    const css = getComputedStyle(el);
    return res.ok && bmp.width === 256 && bmp.height === 256 && el.textContent === '' &&
      css.backgroundImage.includes(state.me.avatarUrl) && css.backgroundSize === 'cover';
  })()`);
  if (!avatarOk) throw new Error('Аватарка не отдаётся или не 256×256');
  await shot(win, 'oauth-settings');
  await win.webContents.executeJavaScript('closeSettings()');
  console.log('✔ аватарка загружена, обрезана до 256×256 и показана в профиле');

  // Выходим и входим заново через Яндекс — должен открыться тот же профиль
  await win.webContents.executeJavaScript(`document.getElementById('logout-btn').click(); true`);
  await click(win, '.oauth-btn', 'Яндекс');
  await waitFor(win, `state.me?.username === 'ivan.petrov'`, 'вход через Яндекс');
  console.log('✔ вход через Яндекс открывает тот же профиль');

  // Регистрация по своей почте: код приходит в письме (здесь — в файл), его вводят и создают аккаунт
  const set = (id, value) => win.webContents.executeJavaScript(`document.getElementById('${id}').value = ${JSON.stringify(value)}; true`);
  const lastCode = (purpose) => {
    const lines = fs.existsSync(MAIL_FILE) ? fs.readFileSync(MAIL_FILE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    return lines.filter((l) => l.purpose === purpose).at(-1)?.code;
  };
  await win.webContents.executeJavaScript(`document.getElementById('logout-btn').click(); true`);
  await click(win, '#auth-toggle', 'Зарегистрироваться');
  await waitFor(
    win,
    `!document.getElementById('email-field').classList.contains('hidden') && !document.getElementById('code-field').classList.contains('hidden') &&
     document.getElementById('username-field').classList.contains('hidden')`,
    'поля регистрации по почте'
  );
  await set('auth-email', 'Anna@Mail.ru');
  await set('auth-display', 'Аня');
  await set('auth-password', 'secret1');
  await set('auth-invite', 'friends');
  await click(win, '#auth-submit', 'Создать аккаунт'); // кода ещё нет — отправляет его
  await waitFor(win, `document.getElementById('code-hint').textContent.includes('Код отправлен')`, 'письмо с кодом');
  await shot(win, 'email-register');
  await set('auth-code', lastCode('register'));
  await click(win, '#auth-submit', 'Создать аккаунт');
  await waitFor(win, `state.me?.email === 'anna@mail.ru' && state.me.displayName === 'Аня'`, 'регистрация по почте');
  console.log(`✔ регистрация по почте с кодом из письма: логин ${await win.webContents.executeJavaScript('state.me.username')}`);

  // Вход по почте и смена забытого пароля
  await win.webContents.executeJavaScript(`document.getElementById('logout-btn').click(); true`);
  await set('auth-username', 'anna@mail.ru');
  await click(win, '#auth-forgot', 'Забыли пароль');
  await waitFor(win, `state.authMode === 'reset' && document.getElementById('auth-email').value === 'anna@mail.ru'`, 'экран смены пароля');
  await set('auth-password', 'newpass1');
  await click(win, '#auth-submit', 'Сменить пароль');
  await waitFor(win, `document.getElementById('code-hint').textContent.includes('Код отправлен')`, 'письмо для смены пароля');
  await set('auth-code', lastCode('reset'));
  await click(win, '#auth-submit', 'Сменить пароль');
  await waitFor(win, `state.me?.email === 'anna@mail.ru'`, 'вход после смены пароля');
  await win.webContents.executeJavaScript(`document.getElementById('logout-btn').click(); true`);
  await set('auth-username', 'anna@mail.ru');
  await set('auth-password', 'newpass1');
  await click(win, '#auth-submit', 'Войти');
  await waitFor(win, `state.me?.email === 'anna@mail.ru'`, 'вход по почте с новым паролем');
  console.log('✔ «Забыли пароль?» меняет пароль по коду из письма, вход по почте работает');
}

app.whenReady().then(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-e2e-oauth-'));
  const { startMockOAuth, oauthEnv } = await import(pathToFileURL(path.join(serverDir, 'test', 'mock-oauth.js')));
  const mock = await startMockOAuth();
  const server = spawn('node', ['src/index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      INVITE_CODE: 'friends',
      AUTH_RATE_LIMIT: '100',
      MAIL_TEST_FILE: MAIL_FILE,
      ...oauthEnv(mock.address().port),
    },
    stdio: 'ignore',
  });
  let code = 0;
  try {
    for (let i = 0; i < 50 && !(await fetch(`${SERVER}/api/health`).then((r) => r.ok, () => false)); i++) await sleep(100);
    await run();
    console.log('\nВсе проверки пройдены');
  } catch (err) {
    console.error('✖', err.message);
    code = 1;
  }
  server.kill();
  mock.close();
  await sleep(500);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  fs.rmSync(MAIL_FILE, { force: true });
  app.exit(code);
});
