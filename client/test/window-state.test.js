// Окно запоминает размер, место и «развёрнуто»: при запуске возвращаем как было, но только на видимый экран
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restoreBounds } = require('../window-state');

const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }];
const MIN = { width: 820, height: 540 };

test('сохранённое окно на видимом экране возвращается как было', () => {
  const saved = { x: 100, y: 80, width: 1300, height: 800, maximized: true };
  assert.deepEqual(restoreBounds(saved, screens, MIN), saved);
});

test('экран, где было окно, отключили — окно по умолчанию (по центру основного)', () => {
  assert.equal(restoreBounds({ x: 2500, y: 100, width: 1200, height: 800 }, screens, MIN), null);
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
