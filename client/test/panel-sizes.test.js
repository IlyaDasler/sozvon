// Ширина боковых панелей: свои пределы, чату всегда остаётся место, сохранённое значение чинится
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PANELS, panelWidth } = require('../renderer/panel-sizes');

test('ширина держится в пределах панели', () => {
  assert.equal(panelWidth('sidebar', 100, { window: 1600 }), PANELS.sidebar.min);
  assert.equal(panelWidth('sidebar', 900, { window: 1600 }), PANELS.sidebar.max);
  assert.equal(panelWidth('members', 300, { window: 1600 }), 300);
});

test('чату остаётся не меньше 380 пикселей, даже если окно узкое', () => {
  // окно 1000: столбец 72 + участники 240 + чат 380 → боковой панели остаётся 308
  assert.equal(panelWidth('sidebar', 420, { window: 1000, other: 240 }), 308);
  // если места совсем нет — не меньше минимума панели
  assert.equal(panelWidth('members', 380, { window: 760, other: 248 }), PANELS.members.min);
});

test('мусор вместо сохранённой ширины — ширина по умолчанию', () => {
  for (const bad of [null, undefined, 'широко', NaN, {}]) assert.equal(panelWidth('members', bad, { window: 1600 }), PANELS.members.default);
});
