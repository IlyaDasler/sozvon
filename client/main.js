const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, powerMonitor, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { listenForOAuth, openOAuthWindow, opensInApp } = require('./oauth-loopback');
const { offerRemoveOldCopy, repairShortcuts } = require('./install-repair');

// --profile=имя запускает отдельный экземпляр со своим входом (удобно, чтобы проверить звонок на одном ПК)
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) app.setPath('userData', path.join(app.getPath('appData'), `Sozvon-${profileArg.split('=')[1]}`));

const ALLOWED_PERMISSIONS = ['media', 'notifications', 'speaker-selection', 'display-capture'];

let win;

// Сообщение странице. Окно могло быть уже закрыто (например, перед установкой обновления) — тогда молчим
function toPage(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 540,
    title: 'Созвон',
    backgroundColor: '#17181c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Звонок не должен замирать, когда окно свёрнуто и ты в игре
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('focus', () => win.flashFrame(false));
  // Ссылки из чата открываются в обычном браузере, а само окно никуда не уходит со своей страницы
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return;
    event.preventDefault();
    openOutside(url);
  });
}

const openOutside = (url) => /^(https?:\/\/|mailto:)/i.test(url) && shell.openExternal(url);

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.includes(permission))
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.includes(permission));
  // Демонстрация экрана: что показывать, человек выбирает в окне приложения, а сюда приходит готовый выбор
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const choice = screenChoice;
    screenChoice = null;
    if (!choice) return callback({});
    callback({ video: choice.source, ...(choice.audio && { audio: 'loopback' }) });
  });

  createWindow();
  setupUpdater();
  if (app.isPackaged && process.platform === 'win32') {
    repairShortcuts();
    win.webContents.once('did-finish-load', () => setTimeout(() => offerRemoveOldCopy(win).catch(() => {}), 3000));
  }

  watchIdle();

  // Глобальные клавиши работают, даже когда в фокусе игра
  globalShortcut.register('CommandOrControl+Shift+M', () => toPage('hotkey', 'toggle-mute'));
  globalShortcut.register('CommandOrControl+Shift+D', () => toPage('hotkey', 'toggle-deafen'));
});

// ---------- Статус «Неактивен» ----------
// 10 минут без мыши и клавиатуры или заблокированный экран — сообщаем странице, она передаст серверу

const IDLE_AFTER_SEC = 10 * 60;
let idleNow = false;

function setIdle(idle) {
  if (idle === idleNow) return;
  idleNow = idle;
  toPage('idle', idle);
}

function watchIdle() {
  setInterval(() => setIdle(powerMonitor.getSystemIdleTime() >= IDLE_AFTER_SEC), 30_000);
  powerMonitor.on('lock-screen', () => setIdle(true));
  powerMonitor.on('unlock-screen', () => setIdle(false));
}

// ---------- Автообновление ----------
// Новая версия скачивается в фоне с GitHub Releases; ставится по кнопке или при следующем закрытии приложения.

// Обновления проверяем один раз при запуске, дальше — только по кнопке «Проверить обновления»
let updateStatus = { state: 'idle' };

function setUpdateStatus(status) {
  updateStatus = { ...updateStatus, ...status };
  toPage('update', updateStatus);
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'update.log'),
      `${new Date().toISOString()} ${JSON.stringify(updateStatus)}\n`
    );
  } catch {}
}

function checkForUpdates() {
  if (!app.isPackaged) {
    setUpdateStatus({ state: 'unsupported' });
    return;
  }
  // Пока качаем или уже скачали, повторно не проверяем
  if (updateStatus.state === 'downloading' || updateStatus.state === 'ready') return;
  autoUpdater.checkForUpdates().catch(() => {}); // ошибка придёт через событие 'error'
}

// Описание релиза с GitHub приходит строкой HTML или списком по версиям
function releaseNotes(info) {
  const notes = info.releaseNotes;
  if (Array.isArray(notes)) return notes.map((n) => n.note || '').join('\n');
  return typeof notes === 'string' ? notes : '';
}

function setupUpdater() {
  // Сами не качаем: сначала спрашиваем пользователя в окне обновления
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking', message: '' }));
  autoUpdater.on('update-available', (info) =>
    setUpdateStatus({ state: 'available', version: info.version, notes: releaseNotes(info), percent: 0 })
  );
  autoUpdater.on('download-progress', (p) => setUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-not-available', () => setUpdateStatus({ state: 'latest' }));
  autoUpdater.on('update-downloaded', (info) => setUpdateStatus({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => setUpdateStatus({ state: 'error', message: err.message }));

  checkForUpdates();
}

ipcMain.handle('update:status', () => ({ ...updateStatus, current: app.getVersion() }));
ipcMain.on('update:check', checkForUpdates);
ipcMain.on('update:download', () => {
  if (updateStatus.state !== 'available' && updateStatus.state !== 'error') return;
  setUpdateStatus({ state: 'downloading', percent: 0 });
  autoUpdater.downloadUpdate().catch(() => {}); // ошибка придёт через событие 'error'
});
// true, true — установить молча, без окна установщика, и сразу запустить новую версию.
// Что идёт обновление, человек видит в самом приложении («Устанавливаем обновление…») перед его закрытием.
// Окно приложения закрываем заранее: установщик не должен застать Созвон ещё запущенным
ipcMain.on('update:install', () => {
  if (updateStatus.state !== 'ready') return;
  app.removeAllListeners('window-all-closed');
  win?.destroy();
  autoUpdater.quitAndInstall(true, true);
});

// Вход через Яндекс: страница входа открывается в окне приложения, присылает ответ на localhost
// и окно закрывается само
let pendingOAuth = null;
ipcMain.handle('oauth', async (_event, authUrl) => {
  pendingOAuth?.close();
  const pending = (pendingOAuth = await listenForOAuth(authUrl));
  try {
    if (opensInApp(authUrl)) openOAuthWindow(authUrl, pending, win);
    else await shell.openExternal(authUrl);
    return await pending.result;
  } finally {
    if (pendingOAuth === pending) pendingOAuth = null;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  }
});

// ---------- Демонстрация экрана ----------

let screenSources = new Map();
let screenChoice = null;

// Экраны и окна приложений. Свёрнутые окна приходят без картинки — их не прячем, показываем значок приложения
ipcMain.handle('screen:sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 400, height: 225 },
    fetchWindowIcons: true,
  });
  screenSources = new Map(sources.map((s) => [s.id, s]));
  return sources
    .filter((s) => s.name && (s.id.startsWith('screen:') || s.name !== win?.getTitle()))
    .map((s) => ({
      id: s.id,
      name: s.name,
      screen: s.id.startsWith('screen:'),
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));
});

// audio — передавать и звук компьютера (Windows умеет захватывать весь системный звук)
ipcMain.handle('screen:choose', (_event, id, audio) => {
  const source = screenSources.get(id);
  screenChoice = source ? { source, audio: Boolean(audio) && process.platform === 'win32' } : null;
  return Boolean(source);
});

ipcMain.on('attention', () => {
  if (win && !win.isFocused()) win.flashFrame(true);
});

ipcMain.on('focus', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
