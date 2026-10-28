// Окно запоминает размер, место и «развёрнуто» (window-state.js в настоящем окне Electron).
// Запуск: npx electron scripts/e2e-window.js
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { restoreBounds, readState, trackWindow } = require('../window-state');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = { width: 820, height: 540 };

app.whenReady().then(async () => {
  try {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-win-')), 'window.json');
    const area = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({ show: true, width: 1100, height: 720, minWidth: MIN.width, minHeight: MIN.height });
    trackWindow(win, file);

    const want = { x: area.x + 120, y: area.y + 90, width: 960, height: 640 };
    win.setBounds(want);
    await sleep(900);
    const moved = readState(file);
    if (!moved || moved.x !== want.x || moved.width !== want.width || moved.maximized) throw new Error(`Не запомнилось место: ${JSON.stringify(moved)}`);
    console.log('✔ место и размер окна запоминаются');

    win.maximize();
    await sleep(900);
    const max = readState(file);
    if (!max.maximized || max.width !== want.width) throw new Error(`Развёрнутое окно запомнилось не так: ${JSON.stringify(max)}`);
    console.log('✔ «развёрнуто» запоминается, обычный размер сохраняется');

    // Следующий запуск: окно вернётся туда же и развернётся
    const back = restoreBounds(readState(file), screen.getAllDisplays().map((d) => d.workArea), MIN);
    if (!back || back.x !== want.x || !back.maximized) throw new Error(`При запуске вернётся не то: ${JSON.stringify(back)}`);
    console.log('✔ при следующем запуске окно вернётся как было');
    console.log('\nВсе проверки пройдены');
    app.exit(0);
  } catch (err) {
    console.error('✖', err.message);
    app.exit(1);
  }
});
