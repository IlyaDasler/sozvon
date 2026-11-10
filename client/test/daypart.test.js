const test = require('node:test');
const assert = require('node:assert/strict');
const {
  phaseAt,
  sceneSet,
  GLASS_SCENES,
  FUJI_SCENES,
} = require('../renderer/daypart-core');

const utc = (hour, minute = 0) => Date.UTC(2026, 0, 15, hour, minute);
const phaseAtUtc = (hour, minute = 0) => phaseAt(utc(hour, minute), 'UTC');

test('фазы времени суток: границы рассвета, утра, дня, заката и ночи', () => {
  assert.equal(phaseAtUtc(4, 59), 'night');
  assert.equal(phaseAtUtc(5), 'dawn');
  assert.equal(phaseAtUtc(6, 59), 'dawn');
  assert.equal(phaseAtUtc(7), 'morning');
  assert.equal(phaseAtUtc(11, 59), 'morning');
  assert.equal(phaseAtUtc(12), 'day');
  assert.equal(phaseAtUtc(16, 59), 'day');
  assert.equal(phaseAtUtc(17), 'sunset');
  assert.equal(phaseAtUtc(20, 59), 'sunset');
  assert.equal(phaseAtUtc(21), 'night');
});

test('у Фуджи день — дневной кадр, а не закат', () => {
  assert.equal(FUJI_SCENES.day, 'fuji-day.jpg');
  assert.equal(FUJI_SCENES.morning, 'fuji-dawn.jpg');
  assert.equal(FUJI_SCENES.sunset, 'fuji-sunset.jpg');
  assert.equal(FUJI_SCENES.night, 'fuji-night.jpg');
});

test('Совон и Фуджи получают разные наборы сцен', () => {
  assert.equal(sceneSet('fuji'), FUJI_SCENES);
  assert.equal(sceneSet('glass'), GLASS_SCENES);
  assert.equal(GLASS_SCENES.morning, 'glass-morning.jpg');
});
