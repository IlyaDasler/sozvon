// Рация (push-to-talk): какие клавиши и кнопки мыши можно назначить, как они называются и что им соответствует
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bindingFrom, matches, bindingLabel, parseBinding } = require('../renderer/ptt-keys');

// Названия клавиш, как их отдаёт глобальный перехватчик (uiohook): код → имя
const NAMES = { 57: 'Space', 41: 'Backquote', 29: 'Ctrl', 47: 'V', 59: 'F1' };

test('клавишу и боковую кнопку мыши можно назначить, левую и правую кнопку мыши — нет', () => {
  assert.deepEqual(bindingFrom({ kind: 'key', keycode: 57 }), { type: 'key', code: 57 });
  assert.deepEqual(bindingFrom({ kind: 'mouse', button: 4 }), { type: 'mouse', code: 4 });
  assert.equal(bindingFrom({ kind: 'mouse', button: 1 }), null);
  assert.equal(bindingFrom({ kind: 'mouse', button: 2 }), null);
  assert.equal(bindingFrom({ kind: 'key', keycode: 0 }), null);
});

test('событие подходит, только если совпадают и тип, и код', () => {
  const v = { type: 'key', code: 47 };
  assert.equal(matches(v, { kind: 'key', keycode: 47 }), true);
  assert.equal(matches(v, { kind: 'key', keycode: 57 }), false);
  assert.equal(matches(v, { kind: 'mouse', button: 47 }), false);
  assert.equal(matches(null, { kind: 'key', keycode: 47 }), false);
});

test('название для настроек: имя клавиши или «Кнопка мыши N»', () => {
  assert.equal(bindingLabel({ type: 'key', code: 41 }, NAMES), '`');
  assert.equal(bindingLabel({ type: 'key', code: 57 }, NAMES), 'Пробел');
  assert.equal(bindingLabel({ type: 'key', code: 47 }, NAMES), 'V');
  assert.equal(bindingLabel({ type: 'mouse', code: 5 }, NAMES), 'Кнопка мыши 5');
  assert.equal(bindingLabel({ type: 'key', code: 999 }, NAMES), 'Клавиша 999');
  assert.equal(bindingLabel(null, NAMES), 'не назначена');
});

test('сохранённую привязку проверяем: мусор — нет привязки', () => {
  assert.deepEqual(parseBinding({ type: 'key', code: 57 }), { type: 'key', code: 57 });
  for (const bad of [null, 'Space', { type: 'mouse', code: 1 }, { type: 'joystick', code: 3 }, { type: 'key', code: -1 }]) assert.equal(parseBinding(bad), null);
});
