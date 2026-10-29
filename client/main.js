const { app, BrowserWindow, Menu, Tray, clipboard, desktopCapturer, globalShortcut, ipcMain, powerMonitor, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { listenForOAuth, openOAuthWindow, opensInApp } = require('./oauth-loopback');
const { parseBinding } = require('./renderer/ptt-keys');
const { offerRemoveOldCopy, repairShortcuts } = require('./install-repair');
const { applyPermissions } = require('./permissions');
const { fetchPreview } = require('./link-preview');
const { restoreBounds, readState, trackWindow } = require('./window-state');

// --profile=имя запускает отдельный экземпляр со своим входом (удобно, чтобы проверить звонок на одном ПК)
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) app.setPath('userData', path.join(app.getPath('appData'), `Sozvon-${profileArg.split('=')[1]}`));

// Одна копия приложения: повторный запуск ярлыка показывает уже открытое (или спрятанное в трей) окно
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => showWindow());

let win;
let tray = null;
// Выходим по-настоящему (меню трея, установка обновления, завершение Windows): крестик тогда не прячет окно,
// иначе обработчик close заблокирует выход и тихая установка обновления сломается
let quitting = false;

// Сообщение странице. Окно могло быть уже закрыто (например, перед установкой обновления) — тогда молчим
function toPage(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

const TITLEBAR_H = 32; // как .titlebar в styles.css

const WINDOW_MIN = { width: 820, height: 540 };

function createWindow() {
  // Окно открывается там и такого размера, каким его оставили (если тот экран ещё подключён)
  const stateFile = path.join(app.getPath('userData'), 'window.json');
  const saved = restoreBounds(readState(stateFile), screen.getAllDisplays().map((d) => d.workArea), WINDOW_MIN);
  win = new BrowserWindow({
    ...(saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: 1100, height: 720 }),
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    title: 'Созвон',
    backgroundColor: '#17181c',
    autoHideMenuBar: true,
    // Своя полоса окна в цветах темы: системную прячем, кнопки «свернуть, развернуть, закрыть» Windows
    // рисует поверх полосы страницы; их цвета страница присылает при смене темы (window:titlebar)
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07080c', symbolColor: '#c8ccda', height: TITLEBAR_H },
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

  if (saved?.maximized) win.maximize();
  trackWindow(win, stateFile);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  ipcMain.on('window:titlebar', (_e, { color, symbolColor }) => {
    if (/^#[0-9a-f]{6}$/i.test(color) && /^#[0-9a-f]{6}$/i.test(symbolColor)) win.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_H });
  });
  win.on('focus', () => win.flashFrame(false));
  // Крестик прячет окно в трей: звонки, голос и уведомления продолжают работать
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
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

/** Показать и развернуть окно — из трея, второго запуска, щелчка по уведомлению */
function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quitApp() {
  quitting = true;
  app.quit();
}

// ---------- Значок в трее ----------
// Есть всегда, с самого запуска: щелчок — открыть окно, меню — «Открыть Созвон» и «Выйти» (без вопросов)

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'tray.png'));
  tray.setToolTip('Созвон');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть Созвон', click: showWindow },
      { type: 'separator' },
      { label: 'Выйти', click: quitApp },
    ])
  );
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

app.whenReady().then(() => {
  if (!primary) return;
  applyPermissions(session.defaultSession);
  // Демонстрация экрана: что показывать, человек выбирает в окне приложения, а сюда приходит готовый выбор
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const choice = screenChoice;
    screenChoice = null;
    if (!choice) return callback({});
    callback({ video: choice.source, ...(choice.audio && { audio: 'loopback' }) });
  });

  createWindow();
  createTray();
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

// ---------- Рация (push-to-talk) ----------
// Модуль перехвата грузим, только когда рацию включили: если он почему-то не загрузится,
// приложение всё равно работает — просто без рации
let ptt = null;
function loadPtt() {
  if (!ptt) ptt = require('./ptt');
  return ptt;
}

ipcMain.handle('ptt:set', (_event, value) => {
  const binding = parseBinding(value);
  if (!binding && !ptt) return true;
  try {
    loadPtt().configure(binding, (down) => toPage('ptt', down));
    return true;
  } catch (err) {
    console.error('Рация недоступна:', err);
    return false;
  }
});
ipcMain.handle('ptt:capture', () => loadPtt().capture());
ipcMain.handle('ptt:names', () => loadPtt().KEY_NAMES);

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
const UPDATE_EVERY_MS = 4 * 60 * 60 * 1000;

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
    setUpdateStatus({ state: 'available', version: info.version, notes: releaseNotes(info), percent: 0, checkedAt: Date.now() })
  );
  autoUpdater.on('download-progress', (p) => setUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  // Последняя версия — вместе с её описанием: в окне проверки видно, что нового
  autoUpdater.on('update-not-available', (info) => setUpdateStatus({ state: 'latest', notes: releaseNotes(info), checkedAt: Date.now() }));
  autoUpdater.on('update-downloaded', (info) => setUpdateStatus({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => setUpdateStatus({ state: 'error', message: err.message, checkedAt: Date.now() }));

  checkForUpdates();
  // И дальше раз в несколько часов: Созвон неделями живёт в трее, и новую версию иначе не заметить
  setInterval(checkForUpdates, UPDATE_EVERY_MS);
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
  quitting = true;
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

ipcMain.on('focus', showWindow);

// Меню по правой кнопке: скопировать текст и команды правки в полях ввода
ipcMain.handle('clipboard:write', (_event, text) => clipboard.writeText(String(text)));
// Превью ссылки для зашифрованного сообщения — страницу грузит приложение отправителя, а не сервер
ipcMain.handle('preview:fetch', (_event, url) => fetchPreview(String(url)));
const EDIT_COMMANDS = new Set(['cut', 'copy', 'paste', 'selectAll']);
ipcMain.on('edit', (event, command) => {
  if (EDIT_COMMANDS.has(command)) event.sender[command]();
});

// Любой настоящий выход (в том числе quitAndInstall внутри electron-updater) и завершение работы Windows
app.on('before-quit', () => (quitting = true));
app.on('session-end', () => (quitting = true));
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  ptt?.stop();
  tray?.destroy();
});
app.on('window-all-closed', () => app.quit());
