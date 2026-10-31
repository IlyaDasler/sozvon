// Выбор области фото: квадрат всегда внутри картинки и движется за рукой
const test = require('node:test');
const assert = require('node:assert/strict');
const { cropRect, panCrop, startCrop, zoomCrop } = require('../renderer/crop-math');

test('сначала — середина широкой и высокой картинки', () => {
  assert.deepEqual(cropRect(startCrop(1000, 400)), { x: 300, y: 0, side: 400 });
  assert.deepEqual(cropRect(startCrop(400, 1000)), { x: 0, y: 300, side: 400 });
});

test('картинку тянут вправо — показывается то, что левее', () => {
  const view = panCrop(startCrop(1000, 400), 100, 0, 200); // 200 точек окна = 400 пикселей картинки
  assert.equal(cropRect(view).x, 100);
});

test('за край уйти нельзя, и обратный сдвиг срабатывает сразу', () => {
  let view = panCrop(startCrop(1000, 400), 9000, 9000, 200);
  assert.deepEqual(cropRect(view), { x: 0, y: 0, side: 400 });
  view = panCrop(view, -50, 0, 200);
  assert.equal(cropRect(view).x, 100);
});

test('увеличение: квадрат меньше, центр на месте, пределы соблюдены', () => {
  const view = zoomCrop(startCrop(1000, 400), 2);
  assert.deepEqual(cropRect(view), { x: 400, y: 100, side: 200 });
  assert.equal(zoomCrop(view, 99).zoom, 4);
  assert.equal(zoomCrop(view, 0.1).zoom, 1);
});

test('уменьшение у края не выводит квадрат за картинку', () => {
  const view = zoomCrop(panCrop(zoomCrop(startCrop(1000, 400), 4), -9000, -9000, 200), 1);
  const { x, y, side } = cropRect(view);
  assert.ok(x + side <= 1000 && y + side <= 400 && x >= 0 && y >= 0);
});
