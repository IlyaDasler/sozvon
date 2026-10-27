const { app, BrowserWindow, globalShortcut, ipcMain, session, shell } = require('electron');
const path = require('node:path');

// --profile=имя запускает отдельный экземпляр со своим входом (удобно, чтобы проверить звонок на одном ПК)
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) app.setPath('userData', path.join(app.getPath('appData'), `Sozvon-${profileArg.split('=')[1]}`));

const ALLOWED_PERMISSIONS = ['media', 'notifications', 'speaker-selection'];

let win;

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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.includes(permission))
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.includes(permission));

  createWindow();

  // Глобальные клавиши работают, даже когда в фокусе игра
  globalShortcut.register('CommandOrControl+Shift+M', () => win?.webContents.send('hotkey', 'toggle-mute'));
  globalShortcut.register('CommandOrControl+Shift+D', () => win?.webContents.send('hotkey', 'toggle-deafen'));
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
