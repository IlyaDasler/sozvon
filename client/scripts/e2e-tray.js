// Сквозной тест трея: запускает настоящий main.js (с отдельным профилем) и проверяет, что крестик прячет окно
// в трей, приложение живо, значок есть с самого запуска, щелчок, двойной щелчок, «Открыть Созвон» и повторный
// запуск возвращают окно, а «Выйти» закрывает приложение без вопросов.
// Запуск: npx electron scripts/e2e-tray.js
const { spawn } = require('node:child_process');
const Module = require('node:module');
const path = require('node:path');
const { app, BrowserWindow, Tray } = require('electron');

const PROFILE = '--profile=e2e-tray';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Подменяем Tray только для main.js: так видно созданные значки и их меню
const trays = [];
// Значок — объект Electron со своим прототипом, поэтому меню запоминаем через свойство самого значка
class TrackedTray extends Tray {
  constructor(...args) {
    super(...args);
    trays.push(this);
    const setMenu = this.setContextMenu;
    this.setContextMenu = (menu) => {
      this.menu = menu;
      return setMenu.call(this, menu);
    };
  }
}
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  const real = load.call(this, request, parent, ...rest);
  if (request === 'electron' && parent?.filename === path.join(__dirname, '..', 'main.js'))
    return new Proxy(real, { get: (target, key) => (key === 'Tray' ? TrackedTray : target[key]) });
  return real;
};

process.argv.push(PROFILE);
require('../main.js');

async function until(check, what, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return;
    await sleep(100);
  }
  throw new Error(`Не дождались: ${what}`);
}

function fail(err) {
  console.error('✖', err.message);
  app.exit(1);
}

const menuItem = (label) => trays[0].menu.items.find((i) => i.label === label);

app.whenReady().then(async () => {
  try {
    await until(() => BrowserWindow.getAllWindows().length === 1, 'окно приложения');
    const win = BrowserWindow.getAllWindows()[0];
    await until(() => trays.length === 1, 'значок в трее');
    if (!win.isVisible()) throw new Error('Окно не показано при запуске');
    console.log('✔ при запуске есть и окно, и значок в трее');
    if (!menuItem('Открыть Созвон') || !menuItem('Выйти')) throw new Error('В меню значка нет «Открыть Созвон» и «Выйти»');

    // Крестик — прячет, а не закрывает
    const hide = async () => {
      win.close();
      await until(() => !win.isVisible(), 'окно спряталось');
      await sleep(300);
      if (win.isDestroyed()) throw new Error('Окно закрылось вместо того, чтобы спрятаться');
    };
    await hide();
    if (trays[0].isDestroyed()) throw new Error('Значок пропал');
    console.log('✔ крестик прячет окно в трей, приложение работает');

    for (const [how, open] of [
      ['щелчок по значку', () => trays[0].emit('click')],
      ['двойной щелчок', () => trays[0].emit('double-click')],
      ['«Открыть Созвон»', () => menuItem('Открыть Созвон').click()],
    ]) {
      open();
      await until(() => win.isVisible() && !win.isMinimized(), `окно вернулось: ${how}`);
      await hide();
    }
    console.log('✔ щелчок, двойной щелчок и «Открыть Созвон» возвращают окно');

    // Свёрнутое окно тоже разворачивается
    win.show();
    win.minimize();
    await until(() => win.isMinimized(), 'окно свернулось');
    trays[0].emit('click');
    await until(() => win.isVisible() && !win.isMinimized(), 'свёрнутое окно развернулось');
    await hide();

    // Повторный запуск ярлыка: вторая копия сразу закрывается, а спрятанное окно показывается
    const second = spawn(process.execPath, [path.join(__dirname, '..'), PROFILE], { stdio: 'ignore' });
    const exited = new Promise((r) => second.once('exit', r));
    await until(() => win.isVisible(), 'повторный запуск показал окно', 20000);
    await Promise.race([exited, sleep(10000).then(() => Promise.reject(new Error('Вторая копия не закрылась')))]);
    console.log('✔ повторный запуск показывает спрятанное окно, вторая копия не остаётся');

    // «Выйти» закрывает приложение по-настоящему, без вопросов
    await hide();
    app.once('will-quit', () => console.log('✔ «Выйти» закрывает приложение\n\nВсе проверки пройдены'));
    setTimeout(() => fail(new Error('«Выйти» не закрыло приложение')), 8000).unref();
    menuItem('Выйти').click();
  } catch (err) {
    fail(err);
  }
});
