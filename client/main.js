const { execFile, spawn } = require('node:child_process');
const { app, BrowserWindow, Menu, Tray, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeTheme, powerMonitor, screen, session, shell, systemPreferences } = require('electron');
const path = require('node:path');
// Ранний обработчик: preload спрашивает версию до создания окна, иначе X-Client-Version пустой
ipcMain.on('app:version', (event) => { event.returnValue = app.getVersion(); });
// Бета живёт в отдельном профиле и не мешает установленной версии: их можно держать открытыми
// одновременно, настройки и сессии не пересекаются
const IS_BETA = /beta/i.test(app.getVersion());
if (IS_BETA) {
  try {
    app.setPath('userData', path.join(app.getPath('appData'), 'Sozvon Beta'));
  } catch {}
}
const fs = require('node:fs');
const { autoUpdater } = require('electron-updater');
const { listenForOAuth, openOAuthWindow, opensInApp } = require('./oauth-loopback');
const { parseBinding } = require('./renderer/ptt-keys');
const { offerRemoveOldCopy, repairShortcuts } = require('./install-repair');
const { applyPermissions } = require('./permissions');
const { fetchPreview } = require('./link-preview');
const { restoreBounds, readState, trackWindow } = require('./window-state');
const { runStartup, CHECK_TIMEOUT_MS, canAutoInstall } = require('./startup');
const { registerNativeScreen } = require('./screen-native');
const { registerVault } = require('./vault');
const { registerClipboardImage } = require('./clipboard-image');
const { applyChromiumFlags } = require('./chromium-flags');
const { UPDATE_EVERY_MS, checkDue } = require('./update-schedule');

applyChromiumFlags(app);

// --profile=имя запускает отдельный экземпляр со своим входом (удобно, чтобы проверить звонок на одном ПК)
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) app.setPath('userData', path.join(app.getPath('appData'), `Sozvon-${profileArg.split('=')[1]}`));

// Одна копия приложения: повторный запуск ярлыка показывает уже открытое (или спрятанное в трей) окно.
// В бете блокировку не берём: бета и установленная версия — разные копии и должны работать вместе
const primary = IS_BETA || app.requestSingleInstanceLock();
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
// Экран входа: компактное фиксированное окно
const AUTH_SIZE = { width: 1020, height: 700 };
// macOS: приложение запущено прямо из DMG — система держит его в случайной папке (App Translocation).
// Обновление подменить такую копию не может, а после перезагрузки она исчезает
const TRANSLOCATED = process.platform === 'darwin' && /AppTranslocation/i.test(process.execPath);

/** show: false — окно грузится за окошком загрузки и показывается, когда запуск закончен */
function createWindow({ show = true } = {}) {
  // Окно открывается там и такого размера, каким его оставили (если тот экран ещё подключён)
  const stateFile = path.join(app.getPath('userData'), 'window.json');
  const saved = restoreBounds(readState(stateFile), screen.getAllDisplays().map((d) => d.workArea), WINDOW_MIN);
  win = new BrowserWindow({
    ...(saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: 1100, height: 720 }),
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    title: 'Созвон',
    show,
    backgroundColor: '#17181c',
    autoHideMenuBar: true,
    // Своя полоса окна в цветах темы: системную прячем, кнопки «свернуть, развернуть, закрыть» Windows
    // рисует поверх полосы страницы; их цвета страница присылает при смене темы (window:titlebar)
    // macOS: hiddenInset оставляет системные «светофоры» поверх страницы, отступ делаем в CSS.
    // Windows: системные кнопки окна поверх полосы — у них работают Snap Layouts Windows 11.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#17181c', symbolColor: '#d6d4cf', height: TITLEBAR_H } } : {}),
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

  if (saved?.maximized) show ? win.maximize() : win.once('show', () => win.maximize());
  trackWindow(win, stateFile);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Кнопки окна — системные (Windows Snap Layouts), но их цвета берём из темы
  ipcMain.on('window:titlebar', (_event, colors) => {
    if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
    const color = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(String(colors?.color || '')) ? colors.color : '#17181c';
    const symbolColor = /^#[0-9a-f]{6}$/i.test(String(colors?.symbolColor || '')) ? colors.symbolColor : '#d6d4cf';
    win.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_H });
  });
  ipcMain.on('window:minimize', () => win.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    // На экране входа разворачивать нельзя
    if (!win.isResizable()) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('window:close', () => win.close());
  // До входа окно фиксированное: размер «как при запуске», без растягивания и во весь экран.
  // После входа — обычное окно: тянется за край, разворачивается, работает полный экран
  ipcMain.on('window:auth-mode', (_event, locked) => {
    if (!win) return;
    if (locked) {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
      win.setFullScreenable(false);
      win.setMaximizable(false);
      win.setResizable(false);
      // размер ставим после разблокировки: на Windows setSize у неменяемого окна игнорируется
      win.setResizable(true);
      win.setSize(AUTH_SIZE.width, AUTH_SIZE.height, false);
      win.center();
      win.setResizable(false);
    } else {
      win.setResizable(true);
      win.setMaximizable(true);
      win.setFullScreenable(true);
    }
    sendWindowState();
  });
  const sendWindowState = () => win.webContents.send('window:state', { maximized: win.isMaximized() });
  win.on('maximize', sendWindowState);
  win.on('unmaximize', sendWindowState);
  win.webContents.once('did-finish-load', sendWindowState);
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
  // Запустили из образа: просим перетащить в «Программы», иначе обновления не заработают
  if (TRANSLOCATED) {
    dialog
      .showMessageBox({
        type: 'info',
        message: 'Созвон запущен из образа',
        detail:
          'Перетащите «Созвон» в папку «Программы» и запустите оттуда. Иначе обновления не смогут установиться, а после перезагрузки приложение придётся открывать заново.',
        buttons: ['Открыть «Программы»', 'Продолжить'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) shell.openPath('/Applications');
      })
      .catch(() => {});
  }
  applyPermissions(session.defaultSession);
  // Встроенные плееры (YouTube, Vimeo): у страницы из file:// нет Referer, и YouTube отвечает
  // «Ошибка настройки 153». Подставляем адрес сайта приложения — для плееров это обычное встраивание
  const SITE_REFERER = 'https://sozvon.sslip.io/';
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://*.vimeo.com/*', '*://*.instagram.com/*', '*://*.tiktok.com/*'] },
    (details, callback) => {
      if (!details.requestHeaders.Referer) details.requestHeaders.Referer = SITE_REFERER;
      callback({ requestHeaders: details.requestHeaders });
    }
  );
  // Демонстрация экрана: что показывать, человек выбирает в окне приложения, а сюда приходит готовый выбор
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const choice = screenChoice;
    screenChoice = null;
    if (!choice) return callback({});
    callback({ video: choice.source, ...(choice.audio && { audio: 'loopback' }) });
  });

  // Собранное приложение открывается через окошко загрузки (SOZVON_SPLASH=1 — посмотреть его при разработке)
  const useSplash = app.isPackaged || process.env.SOZVON_SPLASH === '1';
  if (useSplash) openSplash();
  createWindow({ show: !useSplash });
  createTray();
  setupUpdater({ checkNow: !useSplash });
  if (useSplash) startWithSplash();
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

// Обновления проверяем при запуске и дальше сами (update-schedule.js); кнопка «Проверить обновления» — в любой момент
let updateStatus = { state: 'idle' };
let lastUpdateCheck = 0;

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

let updateRetried = false;

function checkForUpdates() {
  if (!app.isPackaged) {
    setUpdateStatus({ state: 'unsupported' });
    return;
  }
  // Из образа обновление поставить нельзя — не предлагаем и не висим
  if (TRANSLOCATED) return;
  // Пока качаем или уже скачали, повторно не проверяем
  if (updateStatus.state === 'downloading' || updateStatus.state === 'ready') return;
  lastUpdateCheck = Date.now();
  autoUpdater.checkForUpdates().catch(() => {}); // ошибка придёт через событие 'error'
}

// На macOS автообновление ставится только подписанному приложению (Squirrel.Mac сверяет подпись).
// Сертификата Apple нет, поэтому обновление делает наш модуль: качает zip с GitHub, подменяет
// бандл и перезапускает приложение. Цена — macOS заново спросит разрешения после обновления
const macUpdate = require('./mac-update');
const manualUpdate = () => process.platform === 'darwin';
let macUpdateApp = null;

// Описание релиза с GitHub приходит строкой HTML или списком по версиям
function releaseNotes(info) {
  const notes = info.releaseNotes;
  if (Array.isArray(notes)) return notes.map((n) => n.note || '').join('\n');
  return typeof notes === 'string' ? notes : '';
}

// Windows-обновления больше не ходят через GitHub: у российских провайдеров
// release-assets.githubusercontent.com отдаёт 504. Наш сервер отдаёт latest.yml
// и установщик из /updates/win, как macOS.
const UPDATE_SERVER = 'https://135-106-226-12.sslip.io';
function configureUpdateFeed() {
  if (process.platform === 'win32') {
    autoUpdater.setFeedURL({ provider: 'generic', url: `${UPDATE_SERVER}/updates/win` });
  } else if (process.platform === 'darwin') {
    // Даже проверку обновлений не пускаем на GitHub: у российских провайдеров
    // release-assets отдаёт 504. Сама установка на macOS всё равно идёт через mac-update.
    autoUpdater.setFeedURL({ provider: 'generic', url: `${UPDATE_SERVER}/updates/mac` });
  }
}

function setupUpdater({ checkNow = true } = {}) {
  configureUpdateFeed();
  // Сами не качаем: сначала спрашиваем пользователя в окне обновления
  autoUpdater.autoDownload = false;
  // Автоустановка при выходе — только Windows: на macOS Squirrel.Mac ставит лишь подписанное
  // приложение и на неподписанном просто зависает на заставке «Устанавливаем…»
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'darwin';
  autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking', message: '' }));
  autoUpdater.on('update-available', (info) =>
    setUpdateStatus({
      state: 'available',
      version: info.version,
      // На macOS ставим сами: предупреждаем, что система заново спросит разрешения
      notes: manualUpdate()
        ? `${releaseNotes(info)}\n\nПосле обновления macOS заново спросит доступ к микрофону, камере и экрану — это нормально.`
        : releaseNotes(info),
      percent: 0,
      checkedAt: Date.now(),
    })
  );
  autoUpdater.on('download-progress', (p) => setUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  // Последняя версия — вместе с её описанием: в окне проверки видно, что нового
  autoUpdater.on('update-not-available', (info) => {
    updateRetried = false;
    setUpdateStatus({ state: 'latest', notes: releaseNotes(info), checkedAt: Date.now() });
  });
  autoUpdater.on('update-downloaded', (info) => {
    // macOS ставит обновление только через mac-update; Squirrel здесь не источник ready.
    if (process.platform === 'darwin') return;
    setUpdateStatus({ state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    const message = String(err?.message || '');
    // Нет файла обновлений — значит просто нет релиза для этой платформы: это не ошибка
    if (/404|cannot find|not found/i.test(message)) {
      updateRetried = false;
      setUpdateStatus({ state: 'latest', checkedAt: Date.now() });
      return;
    }
    // Сеть моргнула — один раз пробуем ещё, и только потом говорим об ошибке
    if (!updateRetried) {
      updateRetried = true;
      setTimeout(() => checkForUpdates(), 1500);
      return;
    }
    updateRetried = false;
    setUpdateStatus({ state: 'error', message, checkedAt: Date.now() });
  });

  if (checkNow) checkForUpdates();
  // И дальше сами: каждые 10 минут, при возврате в окно и после сна — Созвон неделями живёт в трее
  setInterval(checkForUpdates, UPDATE_EVERY_MS);
  win.on('focus', () => checkDue('focus', lastUpdateCheck, Date.now()) && checkForUpdates());
  powerMonitor.on('resume', checkForUpdates);
}

// ---------- Окошко загрузки ----------
// Как у Discord: при запуске видно, что приложение проверяет обновления, качает новую версию или запускается

let splash = null;
let splashStatus = null;

function openSplash() {
  splash = new BrowserWindow({
    width: 300, height: 340, frame: false, resizable: false, maximizable: false, center: true, show: false,
    title: 'Созвон', backgroundColor: '#14151c',
  });
  splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'), { query: { v: app.getVersion() } });
  splash.once('ready-to-show', () => splash?.show());
  splash.webContents.on('did-finish-load', () => splashStatus && showSplashStatus(splashStatus));
  splash.on('closed', () => (splash = null));
}

function showSplashStatus(status) {
  splashStatus = status;
  if (!splash || splash.webContents.isLoading()) return;
  splash.webContents.executeJavaScript(`showStatus(${JSON.stringify(status)})`).catch(() => {});
}

async function startWithSplash() {
  const result = await runStartup(autoUpdater, { onStatus: showSplashStatus, timeoutMs: app.isPackaged ? CHECK_TIMEOUT_MS : 1500, platform: process.platform });
  // Страховка: что бы ни случилось с обновлением, приложение обязано открыться
  const showWindow = () => {
    if (quitting) return;
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.show());
    else win.show();
    splash?.close();
  };
  const watchdog = setTimeout(showWindow, 12000);
  // На macOS обновление ставим своим механизмом, а не Squirrel: quitAndInstall здесь
  // не отвечает и оставляет человека на заставке навсегда
  if (canAutoInstall(process.platform, result)) {
    quitting = true;
    clearTimeout(watchdog);
    app.removeAllListeners('window-all-closed');
    win?.destroy();
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 600); // «Устанавливаем…» успевают увидеть
    return;
  }
  // Приложение показываем, когда его страница готова, — без белой вспышки
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  clearTimeout(watchdog);
  win.show();
  splash?.close();
}

ipcMain.handle('update:status', () => ({ ...updateStatus, current: app.getVersion() }));
ipcMain.on('update:check', checkForUpdates);
ipcMain.on('update:download', (_event, clientBase) => {
  // macOS: качаем архив с GitHub сами, потому что системный автоапдейтер без подписи не работает
  if (manualUpdate()) {
    downloadMacUpdate(clientBase);
    return;
  }
  if (updateStatus.state !== 'available' && updateStatus.state !== 'error') return;
  setUpdateStatus({ state: 'downloading', percent: 0 });
  autoUpdater.downloadUpdate().catch(() => {}); // ошибка придёт через событие 'error'
});

// Обновление для macOS: скачать zip и распаковать рядом во временной папке
async function downloadMacUpdate(clientBase = '') {
  if (updateStatus.state === 'downloading') return;
  setUpdateStatus({ state: 'downloading', percent: 0 });
  try {
    macUpdateApp = await macUpdate.prepare({
      version: updateStatus.version,
      base: clientBase,
      onProgress: (percent) => setUpdateStatus({ state: 'downloading', percent }),
      onStage: () => setUpdateStatus({ state: 'unpacking', percent: 100 }),
    });
    setUpdateStatus({ state: 'ready', version: updateStatus.version });
  } catch (err) {
    macUpdateApp = null;
    setUpdateStatus({ state: 'error', message: `${err.message}. Можно скачать новую версию со страницы релиза` });
  }
}
// true, true — установить молча, без окна установщика, и сразу запустить новую версию.
// Что идёт обновление, человек видит в самом приложении («Устанавливаем обновление…») перед его закрытием.
// Окно приложения закрываем заранее: установщик не должен застать Созвон ещё запущенным
ipcMain.on('update:install', () => {
  if (updateStatus.state !== 'ready') return;
  // macOS: подменяем бандл скриптом после выхода и запускаем заново
  if (manualUpdate()) {
    const bundle = macUpdate.bundlePath();
    const result =
      macUpdateApp && bundle
        ? macUpdate.apply({
            newApp: macUpdateApp,
            app: bundle,
            onQuit: () => {
              quitting = true;
              app.removeAllListeners('window-all-closed');
              win?.destroy();
              app.quit();
            },
          })
        : { ok: false, reason: 'Обновление не скачано' };
    if (!result.ok) setUpdateStatus({ state: 'error', message: `${result.reason}. Скачайте новую версию со страницы релиза` });
    return;
  }
  quitting = true;
  app.removeAllListeners('window-all-closed');
  win?.destroy();
  autoUpdater.quitAndInstall(true, true);
});

// Вход через Яндекс: страница входа открывается в окне приложения, присылает ответ на localhost
// и окно закрывается само
let pendingOAuth = null;
// ---------- Цвета из системы: акцент и тёмная/светлая тема ----------
// Приложение подстраивается под ОС: акцент берём из системных настроек, чтобы интерфейс
// не выбивался из остальных окон на Mac и Windows
function systemThemeInfo() {
  let accent = '';
  try {
    const raw = systemPreferences.getAccentColor?.();
    if (raw && /^[0-9a-f]{6,8}$/i.test(String(raw))) accent = `#${String(raw).slice(0, 6)}`;
  } catch {}
  return { accent, dark: nativeTheme.shouldUseDarkColors };
}

let lastSystemTheme = '';
function broadcastSystemTheme() {
  const info = systemThemeInfo();
  const key = `${info.accent}|${info.dark}`;
  if (key === lastSystemTheme) return;
  lastSystemTheme = key;
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('system:theme', info);
}


// ---------- Запущенные игры ----------
// Каталог процессов популярных игр: имя процесса → как показывать в профиле
const GAME_PROCESSES = {
  'cs2.exe': 'Counter-Strike 2',
  'csgo.exe': 'CS:GO',
  'valorant.exe': 'VALORANT',
  'valorant-win64-shipping.exe': 'VALORANT',
  'dota2.exe': 'Dota 2',
  'league of legends.exe': 'League of Legends',
  'gta5.exe': 'GTA V',
  'gta5_enhanced.exe': 'GTA V',
  'rdr2.exe': 'Red Dead Redemption 2',
  'minecraft.exe': 'Minecraft',
  'javaw.exe': 'Minecraft',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'r5apex.exe': 'Apex Legends',
  'rustclient.exe': 'Rust',
  'escapefromtarkov.exe': 'Escape from Tarkov',
  'tslgame.exe': 'PUBG',
  'cod.exe': 'Call of Duty',
  'warzone.exe': 'Warzone',
  'cyberpunk2077.exe': 'Cyberpunk 2077',
  'witcher3.exe': 'The Witcher 3',
  'eldenring.exe': 'Elden Ring',
  'bg3.exe': "Baldur's Gate 3",
  'overwatch.exe': 'Overwatch 2',
  'rocketleague.exe': 'Rocket League',
  'destiny2.exe': 'Destiny 2',
  'rainbowsix.exe': 'Rainbow Six Siege',
  'rainbowsix_dx11.exe': 'Rainbow Six Siege',
  'payday3.exe': 'Payday 3',
  'helldivers2.exe': 'Helldivers 2',
  'starfield.exe': 'Starfield',
  'palworld.exe': 'Palworld',
};

/** Список запущенных игр: читаем список процессов Windows и сопоставляем с каталогом */
function detectGames() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile(
      'tasklist',
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 4000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout) return resolve([]);
        const found = new Set();
        for (const line of String(stdout).split(/\r?\n/)) {
          const name = line.split('","')[0]?.replace(/^"/, '').trim().toLowerCase();
          if (name && GAME_PROCESSES[name]) found.add(GAME_PROCESSES[name]);
        }
        resolve([...found]);
      }
    );
  });
}

ipcMain.handle('games:running', () => detectGames());
ipcMain.handle('system:theme', () => systemThemeInfo());
nativeTheme.on('updated', broadcastSystemTheme);
// На macOS смена акцента приходит отдельным уведомлением, на Windows — опрос раз в 20 секунд
try {
  systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', broadcastSystemTheme);
} catch {}
setInterval(broadcastSystemTheme, 20_000).unref();
function telegramDesktopPath() {
  if (process.platform !== 'win32') return '';
  const candidates = [
    path.join(app.getPath('appData'), 'Telegram Desktop', 'Telegram.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Telegram Desktop', 'Telegram.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Telegram Desktop', 'Telegram.exe'),
    path.join(process.env.ProgramFiles || '', 'Telegram Desktop', 'Telegram.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Telegram Desktop', 'Telegram.exe'),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

ipcMain.handle('open-external', async (_event, rawUrl) => {
  const url = String(rawUrl || '');
  if (!/^https:\/\/t\.me\//i.test(url) && !/^tg:\/\/resolve\?/i.test(url)) {
    return { ok: false, error: 'Ссылка не разрешена' };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('open-telegram', async (_event, rawUrl) => {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    return { ok: false, error: 'Некорректная ссылка Telegram' };
  }
  if (url.protocol !== 'https:' || url.hostname !== 't.me' || !/^\/[A-Za-z0-9_]{4,}$/.test(url.pathname)) {
    return { ok: false, error: 'Ссылка не разрешена' };
  }
  const username = url.pathname.slice(1);
  const start = url.searchParams.get('start') || '';
  const tgUrl = `tg://resolve?domain=${encodeURIComponent(username)}${start ? `&start=${encodeURIComponent(start)}` : ''}`;
  const executable = telegramDesktopPath();
  if (executable) {
    try {
      spawn(executable, [tgUrl], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, mode: 'desktop' };
    } catch {}
  }
  try {
    await shell.openExternal(tgUrl);
    return { ok: true, mode: 'desktop' };
  } catch {}
  try {
    await shell.openExternal(url.toString());
    return { ok: true, mode: 'web' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('oauth', async (_event, authUrl) => {
  // Только https: адрес приходит из ответа сервера, открывать по нему что попало нельзя
  if (!/^https:\/\/[^\s]+$/i.test(String(authUrl || ''))) throw new Error('Неверный адрес входа');
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
  // Список мониторов и окон раздельно: если WGC завис на окнах, сам выбор
  // экрана всё равно должен открыться. Раньше общий getSources ждал вечно.
  const screens = await Promise.race([
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 400, height: 225 } }),
    new Promise((resolve) => setTimeout(() => resolve([]), 3000)),
  ]);
  let windows = [];
  try {
    windows = await Promise.race([
      desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 400, height: 225 } }),
      new Promise((resolve) => setTimeout(() => resolve([]), 2500)),
    ]);
  } catch {}
  const sources = [...screens, ...windows];
  screenSources = new Map(sources.map((s) => [s.id, s]));
  return sources
    .filter((s) => s.name && (s.id.startsWith('screen:') || s.name !== win?.getTitle()))
    .map((s) => ({
      id: s.id,
      name: s.name,
      screen: s.id.startsWith('screen:'),
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      icon: null,
    }));
});

// audio — передавать и звук компьютера (Windows умеет захватывать весь системный звук)
registerNativeScreen(() => screenChoice?.source);

ipcMain.handle('screen:choose', (_event, id, audio) => {
  const source = screenSources.get(id);
  // Звук экрана умеют и Windows, и macOS 14.2+ (Chromium берёт его через CoreAudio Tap).
  // На более старых macOS система просто не даст дорожке звука данных — тогда показываем без звука
  screenChoice = source ? { source, audio: Boolean(audio) && (process.platform === 'win32' || process.platform === 'darwin') } : null;
  return Boolean(source);
});

ipcMain.on('attention', () => {
  if (win && !win.isFocused()) win.flashFrame(true);
});

ipcMain.on('focus', showWindow);

// Меню по правой кнопке: скопировать текст и команды правки в полях ввода
// Превью ссылки для зашифрованного сообщения — страницу грузит приложение отправителя, а не сервер
ipcMain.handle('preview:fetch', (_event, url) => fetchPreview(String(url)));
registerVault();
registerClipboardImage();

// ---------- Плавающее окно трансляции ----------
// Отдельное окно Windows: его можно растянуть за края, унести на другой монитор и оставить поверх остальных.
// Картинку шлём кадрами из главного окна — видео остаётся одно, звук идёт как обычно

let pipWin = null;

function closePip() {
  if (pipWin && !pipWin.isDestroyed()) pipWin.close();
}

function pipTitle(text) {
  if (pipWin && !pipWin.isDestroyed()) pipWin.webContents.send('pip:title', String(text || ''));
}

ipcMain.handle('pip:open', (_event, opts = {}) => {
  if (pipWin && !pipWin.isDestroyed()) {
    pipTitle(opts.title);
    pipWin.focus();
    return { ok: true };
  }
  const bounds = opts.bounds && typeof opts.bounds === 'object' ? opts.bounds : {};
  const main = win && !win.isDestroyed() ? win.getBounds() : { x: 100, y: 100, width: 1100, height: 720 };
  pipWin = new BrowserWindow({
    width: Math.max(240, Math.round(bounds.width || 480)),
    height: Math.max(150, Math.round(bounds.height || 300)),
    x: Number.isFinite(bounds.x) ? Math.round(bounds.x) : main.x + 60,
    y: Number.isFinite(bounds.y) ? Math.round(bounds.y) : main.y + 60,
    minWidth: 240,
    minHeight: 150,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: '#07080c',
    title: 'Созвон — трансляция',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  pipWin.loadFile(path.join(__dirname, 'renderer', 'pip.html'));
  pipWin.webContents.once('did-finish-load', () => pipTitle(opts.title));
  // Место и размер окна запоминаем: в следующий раз откроется там же
  pipWin.on('close', () => {
    if (win && !win.isDestroyed()) win.webContents.send('pip:closed', pipWin.getBounds());
  });
  pipWin.on('closed', () => {
    pipWin = null;
  });
  return { ok: true };
});

ipcMain.on('pip:frame', (_event, dataUrl) => {
  if (pipWin && !pipWin.isDestroyed() && typeof dataUrl === 'string') pipWin.webContents.send('pip:frame', dataUrl);
});
ipcMain.on('pip:close', () => closePip());

const EDIT_COMMANDS = new Set(['cut', 'copy', 'paste', 'selectAll']);
ipcMain.on('edit', (event, command) => {
  if (EDIT_COMMANDS.has(command)) event.sender[command]();
});

// Любой настоящий выход (в том числе quitAndInstall внутри electron-updater) и завершение работы Windows
app.on('before-quit', () => {
  quitting = true;
  closePip();
});
app.on('session-end', () => (quitting = true));
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  ptt?.stop();
  tray?.destroy();
});
app.on('window-all-closed', () => app.quit());
