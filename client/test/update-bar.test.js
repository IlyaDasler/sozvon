const test = require('node:test');
const assert = require('node:assert/strict');

test('плашка совпадает с панелью «В голосе»', async () => {
  const { updateBarBox } = await import('../renderer/update-bar.mjs');
  assert.deepEqual(updateBarBox({ left: 81, width: 183 }, { left: 80, width: 199 }), {
    left: 81,
    width: 183,
    radius: '15px'
  });
});

test('без голосовой панели плашка выравнивается по сайдбару', async () => {
  const { updateBarBox } = await import('../renderer/update-bar.mjs');
  assert.deepEqual(updateBarBox(null, { left: 72, width: 200 }, '14px'), {
    left: 80,
    width: 184,
    radius: '14px'
  });
});

test('скрытая панель не даёт геометрию', async () => {
  const { updateBarBox } = await import('../renderer/update-bar.mjs');
  assert.equal(updateBarBox({ left: 0, width: 0 }, null), null);
});
