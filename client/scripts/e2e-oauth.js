// Сквозной тест входа через Google / Яндекс / VK в интерфейсе приложения.
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
  await sleep(800); // скрытое окно перерисовывается не сразу
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
    show: false,
    width: 1100,
    height: 720,
    webPreferences: { session: ses, preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await win.webContents.executeJavaScript(
    `localStorage.clear(); document.getElementById('server-url').value = '${SERVER}';
     document.getElementById('server-url').dispatchEvent(new Event('change')); true`
  );
  await waitFor(win, `document.querySelectorAll('.oauth-btn').length === 3`, 'кнопки входа');
  await shot(win, 'oauth-login');
  console.log('✔ на экране входа есть кнопки Google, Яндекс и VK');

  // Без кода приглашения новый профиль не создаётся
  await click(win, '.oauth-btn', 'Google');
  await waitFor(win, `document.getElementById('auth-error').textContent.includes('код приглашения')`, 'ошибка про код');
  console.log('✔ без кода приглашения профиль не создаётся');

  await click(win, '#auth-toggle', 'Зарегистрироваться');
  await win.webContents.executeJavaScript(`document.getElementById('auth-invite').value = 'friends'; true`);
  await shot(win, 'oauth-register');
  await click(win, '.oauth-btn', 'Google');
  await waitFor(win, `!document.getElementById('main').classList.contains('hidden')`, 'вход в приложение');
  const me = await win.webContents.executeJavaScript('state.me');
  if (me.username !== 'ivan.petrov' || me.displayName !== 'Иван Петров') throw new Error(`Не тот профиль: ${JSON.stringify(me)}`);
  console.log(`✔ регистрация через Google: профиль «${me.displayName}», логин ${me.username}`);

  await win.webContents.executeJavaScript('openSettings()');
  await click(win, '.identity-row .btn', 'Привязать'); // первая непривязанная — Яндекс
  await waitFor(win, 'state.me.identities.length === 2', 'привязка Яндекса');
  await shot(win, 'oauth-settings');
  await win.webContents.executeJavaScript('closeSettings()');
  console.log('✔ Яндекс привязан в настройках');

  // Выходим и входим заново через Яндекс — должен открыться тот же профиль
  await win.webContents.executeJavaScript(`document.getElementById('logout-btn').click(); true`);
  await click(win, '.oauth-btn', 'Яндекс');
  await waitFor(win, `state.me?.username === 'ivan.petrov'`, 'вход через Яндекс');
  console.log('✔ вход через Яндекс открывает тот же профиль');

  // VK: другой человек, другой профиль
  await win.webContents.executeJavaScript(`document.getElementById('logout-btn').click(); true`);
  await click(win, '#auth-toggle', 'Зарегистрироваться');
  await win.webContents.executeJavaScript(`document.getElementById('auth-invite').value = 'friends'; true`);
  await click(win, '.oauth-btn', 'VK');
  await waitFor(win, `state.me?.username === 'maria'`, 'регистрация через VK');
  console.log('✔ регистрация через VK создаёт отдельный профиль');
}

app.whenReady().then(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-e2e-oauth-'));
  const { startMockOAuth, oauthEnv } = await import(pathToFileURL(path.join(serverDir, 'test', 'mock-oauth.js')));
  const mock = await startMockOAuth();
  const server = spawn('node', ['src/index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, INVITE_CODE: 'friends', ...oauthEnv(mock.address().port) },
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
  app.exit(code);
});
