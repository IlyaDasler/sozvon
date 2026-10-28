// Общее для сквозных тестов: окна приложения с виртуальными микрофоном и камерой, вход, ожидание условий
const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { applyPermissions } = require('../permissions');
const { fetchPreview } = require('../link-preview');

const SERVER = process.argv.find((a) => /^https?:\/\//.test(a)) || 'http://127.0.0.1:3000'; // localhost клиент считает старым адресом и сбрасывает вход

app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body, token) {
  const res = await fetch(`${SERVER}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

// Дружба — через заявку: a зовёт, b принимает
async function befriend(a, b) {
  await api('POST', '/contacts', { username: b.user.username }, a.token);
  await api('POST', `/friend-requests/${a.user.id}/accept`, null, b.token);
}

async function register(name, displayName) {
  const suffix = Date.now().toString(36).slice(-5);
  // E2E_INVITE — код приглашения, если сервер его требует
  return api('POST', '/register', {
    username: `e2e_${name}_${suffix}`,
    password: 'test123',
    displayName,
    inviteCode: process.env.E2E_INVITE,
  });
}

const js = (win, code) => win.webContents.executeJavaScript(code);

async function waitFor(win, expr, what, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await js(win, expr)) return;
    await sleep(200);
  }
  throw new Error(`Не дождались: ${what}`);
}

// Выбор экрана — как в main.js приложения: список источников и выбранный источник для getDisplayMedia
let screenSources = new Map();
let screenChoice = null;
let windowCount = 0;
ipcMain.handle('screen:sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 400, height: 225 }, fetchWindowIcons: true });
  screenSources = new Map(sources.map((s) => [s.id, s]));
  return sources
    .filter((s) => s.name)
    .map((s) => ({
      id: s.id,
      name: s.name,
      screen: s.id.startsWith('screen:'),
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));
});
ipcMain.handle('screen:choose', (_e, id) => {
  screenChoice = screenSources.get(id) || null;
  return Boolean(screenChoice);
});
ipcMain.handle('update:status', () => ({ state: 'idle', current: 'e2e' }));
ipcMain.handle('preview:fetch', (_e, url) => fetchPreview(String(url)));

// root — папка с preload.js и renderer/ (по умолчанию текущая версия; для проверки совместимости — старая)
async function openClient(name, auth, root = path.join(__dirname, '..')) {
  const ses = session.fromPartition(`e2e-${name}`);
  applyPermissions(ses);
  ses.setDisplayMediaRequestHandler((_req, cb) => {
    const source = screenChoice;
    screenChoice = null;
    cb(source ? { video: source } : {});
  });
  const win = new BrowserWindow({
    show: process.env.E2E_SHOW === '1',
    width: 1100,
    height: 720,
    x: 40 + 60 * windowCount,
    y: 40 + 40 * windowCount++,
    webPreferences: {
      session: ses,
      preload: path.join(root, 'preload.js'),
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // Ошибки страницы — в вывод теста, иначе падение видно только как «не дождались»
  const ownCode = root === path.join(__dirname, '..');
  win.webContents.on('console-message', (e) => {
    if (e.level !== 'error') return;
    const line = `[${name}] ${e.message} (${path.basename(e.sourceId || '')}:${e.lineNumber})`;
    console.error(`  ${line}`);
    if (ownCode && e.message.startsWith('Uncaught')) pageErrors.push(line);
  });
  await win.loadFile(path.join(root, 'renderer', 'index.html'));
  await js(win, `localStorage.setItem('session', ${JSON.stringify(JSON.stringify({ base: SERVER, token: auth.token }))}); location.reload()`);
  await sleep(500);
  await waitFor(win, `document.getElementById('conn-dot').classList.contains('ok')`, `${name}: подключение`);
  return win;
}

// Сколько байт пришло от каждого собеседника: { id: { audio, video } }
const received = (win) =>
  js(
    win,
    `(async () => {
      const out = {};
      for (const p of activeSession().peers.values()) {
        const stats = await p.link.pc.getStats();
        const r = { audio: 0, video: 0 };
        stats.forEach((s) => { if (s.type === 'inbound-rtp') r[s.kind] += s.bytesReceived; });
        out[p.id] = r;
      }
      return out;
    })()`
  );

// Видео в плитке действительно показывает кадры
const tilePlaying = (win, key) =>
  `(() => { const v = document.querySelector('.tile[data-key="${key}"] video'); return Boolean(v && v.srcObject && v.videoWidth > 0 && !v.paused); })()`;

async function screenshot(win, name) {
  if (!process.env.E2E_SHOTS) return;
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(process.env.E2E_SHOTS, `${name}.png`), image.toPNG());
  } catch (err) {
    // Пока идёт захват экрана, Electron иногда не может снять окно — тест от этого не падает
    console.warn(`  (скриншот ${name} не получился: ${err.message})`);
  }
}

// Необработанные ошибки на страницах текущей версии: тест с ними не считается пройденным
const pageErrors = [];

function runTest(run) {
  app.whenReady().then(async () => {
    try {
      await run();
      if (pageErrors.length) throw new Error(`Ошибки на странице: ${[...new Set(pageErrors)].join('; ')}`);
      console.log('\nВсе проверки пройдены');
      app.exit(0);
    } catch (err) {
      console.error('✖', err.message, process.env.E2E_DEBUG ? err.stack : '');
      app.exit(1);
    }
  });
}

module.exports = { SERVER, api, befriend, register, js, waitFor, sleep, openClient, received, tilePlaying, screenshot, runTest };
