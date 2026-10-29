// Размер трансляции своим захватом: монитор вписывается в рамку режима, пропорции те же, стороны чётные
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fitSize } = require('../screen-size');

test('широкий монитор 3440×1440 в режиме 1440p — 2560×1072', () => {
  assert.deepEqual(fitSize({ width: 3440, height: 1440 }, { width: 2560, height: 1440 }), { width: 2560, height: 1072 });
});

test('монитор 2560×1440 в режиме 1080p — 1920×1080', () => {
  assert.deepEqual(fitSize({ width: 2560, height: 1440 }, { width: 1920, height: 1080 }), { width: 1920, height: 1080 });
});

test('монитор меньше рамки не растягиваем', () => {
  assert.deepEqual(fitSize({ width: 1920, height: 1080 }, { width: 2560, height: 1440 }), { width: 1920, height: 1080 });
});

test('высокий монитор (портретный) вписывается по высоте, стороны чётные', () => {
  assert.deepEqual(fitSize({ width: 1440, height: 2560 }, { width: 1920, height: 1080 }), { width: 608, height: 1080 });
});
