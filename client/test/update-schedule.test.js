// Обновления замечаем сами: таймер каждые 10 минут, при возврате в окно (если давно не проверяли) и после сна
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { UPDATE_EVERY_MS, checkDue } = require('../update-schedule');

const min = 60 * 1000;

test('таймер проверяет каждые 10 минут, а не раз в несколько часов', () => {
  assert.equal(UPDATE_EVERY_MS, 10 * min);
  assert.equal(checkDue('timer', 0, 10 * min), true);
});

test('вернулись в окно — проверяем, если с прошлой проверки прошло больше 2 минут', () => {
  assert.equal(checkDue('focus', 0, 1 * min), false);
  assert.equal(checkDue('focus', 0, 3 * min), true);
});

test('компьютер проснулся — проверяем сразу', () => {
  assert.equal(checkDue('resume', 0, 10), true);
});
