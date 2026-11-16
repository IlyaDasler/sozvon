// Окно запоминает размер, место и «развёрнуто»: при запуске возвращаем как было, но только на видимый экран
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restoreBounds, trackWindow } = require('../window-state');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }];
const MIN = { width: 820, height: 540 };

test('сохранённое окно на видимом экране возвращается как было', () => {
  const saved = { x: 100, y: 80, width: 1300, height: 800, maximized: true };
  assert.deepEqual(restoreBounds(saved, screens, MIN), saved);
});

test('экран, где было окно, отключили — окно влезает в основной экран', () => {
  assert.deepEqual(restoreBounds({ x: 2500, y: 100, width: 1200, height: 800 }, screens, MIN), {
    x: 710,
    y: 100,
    width: 1200,
    height: 800,
    maximized: false,
  });
});

test('окно шире монитора не оставляет кнопки окна за краем экрана', () => {
  const wide = [{ x: 0, y: 0, width: 3440, height: 1400 }];
  assert.deepEqual(restoreBounds({ x: 1, y: 394, width: 3438, height: 999 }, wide, MIN), {
    x: 10,
    y: 391,
    width: 3420,
    height: 999,
    maximized: false,
  });
});

test('мусор и слишком маленькое окно — по умолчанию или не меньше допустимого', () => {
  assert.equal(restoreBounds(null, screens, MIN), null);
  assert.equal(restoreBounds({ x: 'a', y: 0, width: 900, height: 600 }, screens, MIN), null);
  assert.deepEqual(restoreBounds({ x: 10, y: 10, width: 300, height: 200 }, screens, MIN), { x: 10, y: 10, width: 820, height: 540, maximized: false });
});

test('второй монитор слева (отрицательные координаты) — окно там и остаётся', () => {
  const two = [...screens, { x: -1600, y: 0, width: 1600, height: 860 }];
  assert.deepEqual(restoreBounds({ x: -1500, y: 50, width: 1000, height: 700 }, two, MIN), { x: -1500, y: 50, width: 1000, height: 700, maximized: false });
});

test('экран входа не перезаписывает привычный размер окна', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-window-'));
  const file = path.join(dir, 'window.json');
  const win = new EventEmitter();
  Object.assign(win, {
    isDestroyed: () => false,
    isMinimized: () => false,
    isFullScreen: () => false,
    isMaximized: () => false,
    getNormalBounds: () => ({ x: 11, y: 22, width: 1020, height: 700 }),
  });
  let enabled = false;
  trackWindow(win, file, { enabled: () => enabled });
  win.emit('resize');
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(fs.existsSync(file), false);
  enabled = true;
  win.emit('resize');
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { x: 11, y: 22, width: 1020, height: 700, maximized: false });
  fs.rmSync(dir, { recursive: true, force: true });
});
