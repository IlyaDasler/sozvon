// Веб-версия (без preload и window.desktop): повторное нажатие на кнопку
// показа экрана должно останавливать трансляцию, а не запускать новую.
const path = require('node:path');
const { BrowserWindow } = require('electron');
const { js, sleep, runTest } = require('./e2e-lib');

runTest(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 700,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await sleep(800);
    const webMode = await js(win, `typeof window.desktop`);
    if (webMode !== 'undefined') throw new Error(`тест не в веб-режиме: window.desktop=${webMode}`);

    const stopped = await js(win, `(() => {
      window.__webScreenStopped = false;
      state.me = { id: 1 };
      state.call = {
        session: {
          local: { tracks: { screen: { id: 'fake-screen' } } },
          stopScreen() { window.__webScreenStopped = true; },
        },
      };
      voiceAllowed = () => ({ video: true });
      toggleScreen();
      return window.__webScreenStopped;
    })()`);
    if (!stopped) throw new Error('Повторное нажатие в вебе не остановило показ экрана');
    console.log('✔ веб: повторное нажатие останавливает трансляцию');
  } finally {
    win.destroy();
  }
});
