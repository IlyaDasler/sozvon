// Нижнее меню в стиле Telegram: плавающая капсула, скользящая подсветка, анимации.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

const metrics = (w) => js(w, `(() => {
  const nav = document.getElementById('mobile-nav');
  const pill = nav.querySelector('.mobile-nav-pill');
  const active = nav.querySelector('button.active');
  const icon = active?.querySelector('.mobile-nav-icon');
  const nr = nav.getBoundingClientRect();
  const pr = pill.getBoundingClientRect();
  const cs = getComputedStyle(nav);
  return JSON.stringify({
    vw: innerWidth, vh: innerHeight,
    left: Math.round(nr.left), right: Math.round(nr.right), bottom: Math.round(nr.bottom),
    h: Math.round(nr.height), radius: cs.borderTopLeftRadius, pos: cs.position,
    pillX: Math.round(pr.left), pillW: Math.round(pr.width), pillTransition: getComputedStyle(pill).transitionDuration,
    iconTransition: icon ? getComputedStyle(icon).transitionDuration : null,
    active: active?.dataset.mobile || '', activeColor: icon ? getComputedStyle(icon).color : null,
    inactiveColor: getComputedStyle(nav.querySelector('button:not(.active) .mobile-nav-icon')).color,
  });
})()`);

runTest(async () => {
  const a = await register('tg' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('tg', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  let m = JSON.parse(await metrics(w));
  console.log('nav-telegram', JSON.stringify(m));
  if (m.pos !== 'fixed') throw new Error('меню не fixed');
  if (m.left < 6 || m.right > m.vw - 6) throw new Error('меню не плавающее по бокам: ' + JSON.stringify(m));
  if (m.bottom > m.vh - 6) throw new Error('меню прижато к низу без отступа: ' + JSON.stringify(m));
  if (parseFloat(m.radius) < 18) throw new Error('меню не капсула: radius=' + m.radius);
  if (!m.pillW || m.pillX < m.left) throw new Error('нет скользящей подсветки');
  if (!/0\.[0-9]+s/.test(m.pillTransition) || m.pillTransition === '0s') throw new Error('нет анимации подсветки: ' + m.pillTransition);
  if (!m.iconTransition || m.iconTransition === '0s') throw new Error('нет анимации иконки');
  if (m.activeColor === m.inactiveColor) throw new Error('активная вкладка не выделена цветом');

  const startPill = m.pillX;
  const startActive = m.active;
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(450);
  m = JSON.parse(await metrics(w));
  console.log('nav-telegram-channels', JSON.stringify(m));
  if (m.active !== 'channels') throw new Error('вкладка «Каналы» не активна');
  if (m.pillX <= startPill) throw new Error('подсветка не сдвинулась: ' + startPill + ' → ' + m.pillX);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(450);
  m = JSON.parse(await metrics(w));
  console.log('nav-telegram-settings', JSON.stringify(m));
  if (m.active !== 'settings') throw new Error('вкладка «Настройки» не активна');
  if (m.pillX <= startPill) throw new Error('подсветка не доехала до настроек');
  if (m.right > m.vw - 6 || m.bottom > m.vh - 6) throw new Error('меню сломалось в настройках');
});
