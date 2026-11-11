// Вкладки друзей: скользящая капсула как в нижнем меню, без лишней кнопки «+».
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

const m = (w) => js(w, `(() => {
  const root = document.getElementById('friend-tabs');
  const ind = root.querySelector('.glass-tab-indicator');
  const active = root.querySelector('button.active');
  const add = document.getElementById('mobile-add-friend');
  const ir = ind ? ind.getBoundingClientRect() : null;
  const ar = active ? active.getBoundingClientRect() : null;
  return JSON.stringify({
    addDisplay: add ? getComputedStyle(add).display : 'absent',
    indHidden: ind ? ind.hidden : null,
    indDisplay: ind ? getComputedStyle(ind).display : null,
    indTransform: ind ? getComputedStyle(ind).transform : null,
    indW: ir ? Math.round(ir.width) : 0,
    indH: ir ? Math.round(ir.height) : 0,
    radius: ind ? getComputedStyle(ind).borderTopLeftRadius : null,
    transition: ind ? getComputedStyle(ind).transitionDuration : null,
    active: active?.dataset.tab || '',
    activeColor: active ? getComputedStyle(active).color : null,
    addTab: Boolean(root.querySelector('[data-tab="add"]')),
    indCovers: Boolean(ir && ar && Math.abs(ir.left - ar.left) < 2 && Math.abs(ir.width - ar.width) < 3),
  });
})()`);

runTest(async () => {
  const a = await register('ft' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('ft', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  let s = JSON.parse(await m(w));
  console.log('friend-tabs', s);
  if (s.addDisplay !== 'none' && s.addDisplay !== 'absent') throw new Error('кнопка «+» в шапке друзей осталась');
  if (!s.addTab) throw new Error('в роллере пропало добавление в друзья');
  if (s.indHidden || s.indDisplay !== 'block') throw new Error('нет капсулы вкладок: ' + JSON.stringify(s));
  if (!s.indCovers) throw new Error('капсула не совпадает с активной вкладкой: ' + JSON.stringify(s));
  if (parseFloat(s.radius) < 8) throw new Error('капсула не скруглена: ' + s.radius);
  if (!s.transition.includes('0.38s')) throw new Error('нет анимации: ' + s.transition);

  const before = s.indTransform;
  await js(w, `document.querySelector('#friend-tabs [data-tab="all"]').click(); true`);
  await sleep(450);
  s = JSON.parse(await m(w));
  console.log('friend-tabs-all', s);
  if (s.active !== 'all') throw new Error('вкладка «Все» не активна');
  if (s.indTransform === before) throw new Error('капсула не поехала');
  if (!s.indCovers) throw new Error('капсула не встала под «Все»');

  await js(w, `document.querySelector('#friend-tabs [data-tab="add"]').click(); true`);
  await sleep(450);
  s = JSON.parse(await m(w));
  console.log('friend-tabs-add', s);
  if (s.active !== 'add') throw new Error('вкладка добавления не активна');
  if (!s.indCovers) throw new Error('капсула не встала под добавление');
  const under = await js(w, `(() => { const b = document.querySelector('#friend-tabs button.active'); return getComputedStyle(b, '::after').display + '|' + getComputedStyle(b, '::after').content; })()`);
  console.log('underline', under);
  if (!under.startsWith('none')) throw new Error('подчёркивание активной вкладки осталось: ' + under);
  await sleep(500);
  const visible = JSON.parse(await js(w, `(() => {
    const root = document.getElementById('friend-tabs');
    const a = root.querySelector('button.active');
    const rr = root.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    return JSON.stringify({ scrollLeft: Math.round(root.scrollLeft), left: Math.round(ar.left), right: Math.round(ar.right), viewLeft: Math.round(rr.left), viewRight: Math.round(rr.right), visible: ar.left >= rr.left - 1 && ar.right <= rr.right + 1 });
  })()`));
  console.log('tabs-scroll', JSON.stringify(visible));
  if (!visible.visible) throw new Error('активная вкладка не докручена в роллере: ' + JSON.stringify(visible));
  if (visible.scrollLeft <= 0) throw new Error('роллер не сдвинулся к добавлению: ' + JSON.stringify(visible));
});
