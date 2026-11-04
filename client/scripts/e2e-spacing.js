// Аудит отступов и слипаний: ищем элементы, вылезающие за родителя, слишком близкие
// друг к другу и текст, который не по центру своей кнопки. Работает в теме стекла.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

const AUDIT = `(() => {
  const issues = [];
  const rect = (el) => el.getBoundingClientRect();
  const px = (n) => Math.round(n);

  // 1. Дети не должны вылезать за контентную коробку родителя
  for (const sel of ['#settings .set-block', '#settings .modal-card', '.sidebar', '.content', '#room-view', '.ccall', '.thread-panel']) {
    for (const box of document.querySelectorAll(sel)) {
      if (!box.getClientRects().length) continue;
      const cs = getComputedStyle(box);
      if (cs.overflow === 'visible') continue;
      const b = rect(box);
      const padLeft = b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
      const padRight = b.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
      for (const child of box.children) {
        if (!child.getClientRects().length) continue;
        if (getComputedStyle(child).position === 'absolute') continue;
        const c = rect(child);
        if (c.left < padLeft - 1.5 || c.right > padRight + 1.5)
          issues.push(sel + ' → ' + (child.className || child.tagName) + ': ' + px(c.left) + '..' + px(c.right) + ' вне ' + px(padLeft) + '..' + px(padRight));
      }
    }
  }

  // 2. Подписи и поля не слипаются: зазор не меньше 4 px
  for (const field of document.querySelectorAll('#settings .field')) {
    if (!field.getClientRects().length) continue;
    const label = field.querySelector('span');
    // Основной контрол поля: ползунок, стеклянный список, поле ввода или текстовая область\n    const input = field.querySelector('input[type=range], .gs-select, textarea, input[type=text], input[type=password], select:not(.gs-native)');
    if (!label || !input || !label.getClientRects().length || !input.getClientRects().length) continue;
    const gap = rect(input).top - rect(label).bottom;
    if (gap < 3) issues.push('field: зазор подписи и поля ' + px(gap) + 'px (' + (field.textContent || '').trim().slice(0, 24) + ')');
  }

  // 3. Текст в кнопках по вертикали по центру
  for (const btn of document.querySelectorAll('#set-nav button, .members-head button, .composer-bar button')) {
    if (!btn.getClientRects().length) continue;
    const b = rect(btn);
    const range = document.createRange();
    range.selectNodeContents(btn);
    const t = range.getBoundingClientRect();
    if (!t.height) continue;
    const d = Math.abs((t.top + t.bottom) / 2 - (b.top + b.bottom) / 2);
    if (d > 2) issues.push('кнопка не по центру: ' + (btn.textContent || btn.id).trim().slice(0, 20) + ' (' + px(d) + 'px)');
  }

  // 4. Ползунки: поле внутри своей обёртки и не шире контента
  for (const input of document.querySelectorAll('input[type=range]')) {
    if (!input.getClientRects().length) continue;
    const wrap = input.parentElement;
    const i = rect(input);
    const w = rect(wrap);
    if (i.left < w.left - 1 || i.right > w.right + 1) issues.push('ползунок вылезает за обёртку');
  }

  // 5. Соседние блоки не перекрывают друг друга
  for (const container of document.querySelectorAll('#settings .set-block, #settings .set-pane, #settings .rs-body')) {
    const kids = [...container.children].filter((c) => c.getClientRects().length && getComputedStyle(c).position !== 'absolute');
    for (let i = 1; i < kids.length; i++) {
      const prev = rect(kids[i - 1]);
      const cur = rect(kids[i]);
      if (cur.top < prev.bottom - 1.5)
        issues.push('наложение блоков: ' + (kids[i - 1].className || '?') + ' и ' + (kids[i].className || '?'));
    }
  }
  return JSON.stringify(issues.slice(0, 12));
})()`;

runTest(async () => {
  const a = await register('sp' + Math.random().toString(36).slice(2, 4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Отступы' }, a.token);
  const room = await api('POST', '/rooms', { hubId: hub.id, name: 'Проверка', kind: 'text' }, a.token);
  const win = await openClient('spa', a);
  await sleep(1500);
  win.setSize(1400, 860);
  await sleep(300);
  win.show();
  win.focus();
  await js(win, `document.documentElement.dataset.theme='glass'; applyGlass(); applyUiShape(); openHub(${hub.id}); openRoom(${room.id}); true`);
  await sleep(700);

  const screens = [
    ['чат', `openRoom(${room.id})`],
    ['настройки: оформление', `openSettings('look')`],
    ['настройки: профиль', `openSettings('profile')`],
    ['настройки: план', `openSettings('plan')`],
  ];
  for (const [name, open] of screens) {
    await js(win, `document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); ${open}; true`);
    await sleep(600);
    const raw = await js(win, AUDIT);
    const issues = JSON.parse(raw);
    if (issues.length) throw new Error(`${name}: ${issues.join(' | ')}`);
  }
  // Новые компоненты: размеры и центрирование
  await js(win, `document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); openSettings('look'); true`);
  await sleep(600);
  const sizes = JSON.parse(await js(win, `(() => {
    const out = {};
    const box = document.querySelector('#settings .gs-select');
    if (box) {
      const b = box.getBoundingClientRect();
      const v = box.querySelector('.gs-value').getBoundingClientRect();
      out.select = { h: Math.round(b.height), centered: Math.abs((v.top + v.bottom) / 2 - (b.top + b.bottom) / 2) <= 2 };
    }
    const num = document.querySelector('#settings .number-field');
    if (num) {
      const n = num.getBoundingClientRect();
      const field = num.closest('.field').getBoundingClientRect();
      out.number = { h: Math.round(n.height), inside: n.right <= field.right + 1 };
    }
    const head = document.querySelector('#settings .collapse-head');
    if (head) {
      const h = head.getBoundingClientRect();
      const title = head.querySelector('.collapse-title').getBoundingClientRect();
      out.collapse = { h: Math.round(h.height), centered: Math.abs((title.top + title.bottom) / 2 - (h.top + h.bottom) / 2) <= 2 };
    }
    return JSON.stringify(out);
  })()`));
  if (sizes.select && (sizes.select.h < 38 || sizes.select.h > 42 || !sizes.select.centered))
    throw new Error('стеклянный Select: размер или центрирование');
  if (sizes.number && (sizes.number.h < 28 || sizes.number.h > 32 || !sizes.number.inside))
    throw new Error('Number Field: размер или выход за поле');
  if (sizes.collapse && (sizes.collapse.h < 24 || !sizes.collapse.centered))
    throw new Error('Collapsible: заголовок не по центру');

  console.log('✔ отступы и центрирование: наложений и слипаний нет');
});
