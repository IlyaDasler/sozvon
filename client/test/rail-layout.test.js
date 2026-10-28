// Раскладка столбца сходок: личный порядок и группы, починка сохранённых данных и перетаскивание
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLayout, groupHubs, moveItem, updateFolder, ungroup, hubOrder } = require('../renderer/rail-layout');

const folder = (id, hubs, extra = {}) => ({ folder: id, name: '', color: null, collapsed: false, hubs, ...extra });

test('новые сходки — в конец, ушедшие пропадают, порядок сохраняется', () => {
  assert.deepEqual(normalizeLayout({ items: [3, 1] }, [1, 2, 3]), { items: [3, 1, 2] });
  assert.deepEqual(normalizeLayout({ items: [3, folder('a', [1, 4]), 2] }, [1, 2, 3, 5]), { items: [3, 1, 2, 5] });
  assert.deepEqual(normalizeLayout(undefined, [2, 1]), { items: [2, 1] });
});

test('битые данные не ломают столбец', () => {
  for (const raw of [null, 'мусор', 42, { items: 'нет' }, { items: [null, 'x', {}, { folder: 5 }, [1]] }])
    assert.deepEqual(normalizeLayout(raw, [1, 2]), { items: [1, 2] });
  // Повторы, сходка в двух местах, папка внутри папки
  assert.deepEqual(
    normalizeLayout({ items: [1, 1, folder('a', [1, 2, 2, folder('b', [3])]), 3] }, [1, 2, 3]),
    { items: [1, 2, 3] }
  );
  // Поля папки чистятся: длинное имя обрезается, чужой цвет и не-булево свёрнутое сбрасываются
  const fixed = normalizeLayout({ items: [folder('a', [1, 2], { name: 'я'.repeat(50), color: 'red', collapsed: 'да' })] }, [1, 2]);
  assert.deepEqual(fixed.items[0], folder('a', [1, 2], { name: 'я'.repeat(32) }));
  // Две папки с одним id — вторая получает новый
  const twins = normalizeLayout({ items: [folder('a', [1, 2]), folder('a', [3, 4])] }, [1, 2, 3, 4]);
  assert.notEqual(twins.items[0].folder, twins.items[1].folder);
});

test('перетащить сходку на сходку — группа на месте цели', () => {
  const layout = { items: [1, 2, 3] };
  assert.deepEqual(groupHubs(layout, 3, 1, 'g'), { items: [folder('g', [1, 3]), 2] });
  // На сходку внутри группы — в ту же группу, сразу после неё
  const inFolder = { items: [folder('g', [1, 3]), 2] };
  assert.deepEqual(groupHubs(inFolder, 2, 1, 'h'), { items: [folder('g', [1, 2, 3])] });
  // На саму себя — ничего не меняется
  assert.deepEqual(groupHubs(layout, 2, 2, 'g'), layout);
});

test('порядок перетаскиванием и вытаскивание из группы', () => {
  const layout = { items: [1, folder('g', [2, 3]), 4] };
  // Сходку — перед другой
  assert.deepEqual(moveItem(layout, 4, 1), { items: [4, 1, folder('g', [2, 3])] });
  // В конец
  assert.deepEqual(moveItem(layout, 1, null), { items: [folder('g', [2, 3]), 4, 1] });
  // Из группы наружу; в группе осталась одна — группа распадается
  assert.deepEqual(moveItem(layout, 3, 4), { items: [1, 2, 3, 4] });
  // Внутри группы — перед другой сходкой этой группы
  const three = { items: [folder('g', [2, 3, 5])] };
  assert.deepEqual(moveItem(three, 5, 2), { items: [folder('g', [5, 2, 3])] });
  // Группу целиком; «перед сходкой в группе» для группы — перед этой группой
  assert.deepEqual(moveItem(layout, 'g', 1), { items: [folder('g', [2, 3]), 1, 4] });
  assert.deepEqual(moveItem({ items: [folder('a', [1, 2]), folder('b', [3, 4])] }, 'b', 2), {
    items: [folder('b', [3, 4]), folder('a', [1, 2])],
  });
});

test('название, цвет и свёрнутость группы; разгруппировать', () => {
  const layout = { items: [folder('g', [1, 2]), 3] };
  assert.deepEqual(updateFolder(layout, 'g', { name: 'Игры', color: '#30a46c', collapsed: true }), {
    items: [folder('g', [1, 2], { name: 'Игры', color: '#30a46c', collapsed: true }), 3],
  });
  assert.deepEqual(ungroup(layout, 'g'), { items: [1, 2, 3] });
  assert.deepEqual(hubOrder({ items: [3, folder('g', [1, 2])] }), [3, 1, 2]);
});
