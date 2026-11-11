// Профиль участника на телефоне — полноэкранный непрозрачный лист, не десктопный поповер.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('pf' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Профиль' }, a.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const w = await openClient('pf', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500);
  await js(w, `selectRoom(${room.id}); true`);
  await sleep(700);
  await js(w, `document.querySelector('.members-toggle')?.click(); true`);
  await sleep(500);

  await js(w, `document.querySelector('#members-panel .member-item[data-profile]')?.click(); true`);
  await sleep(500);
  const d = JSON.parse(await js(w, `(() => {
    const card = document.getElementById('profile-card');
    const r = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const center = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
    return JSON.stringify({
      hidden: card.classList.contains('hidden'), mobile: card.classList.contains('mobile-profile'),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight,
      bg: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter,
      z: cs.zIndex, nav: getComputedStyle(document.getElementById('mobile-nav')).display,
      back: Boolean(document.getElementById('pc-mobile-back')),
      top: center ? (center.id || center.className || center.tagName) : '',
      body: document.body.className,
    });
  })()`));
  console.log('mobile-profile', JSON.stringify(d));
  if (d.hidden || !d.mobile) throw new Error('профиль не открылся как мобильный лист');
  if (d.x > 1 || d.y > 1 || Math.abs(d.w - d.vw) > 2 || Math.abs(d.h - d.vh) > 2) throw new Error('профиль не полноэкранный: ' + JSON.stringify(d));
  if (/rgba\(0, 0, 0, 0\)|transparent/.test(d.bg)) throw new Error('фон профиля прозрачный: ' + d.bg);
  if (d.blur && d.blur !== 'none') throw new Error('blur у профиля: ' + d.blur);
  if (d.nav !== 'none') throw new Error('нижнее меню осталось поверх профиля');
  if (!d.back) throw new Error('нет кнопки назад');
  if (/scrim/.test(d.top)) throw new Error('профиль под скримом: ' + d.top);

  await js(w, `document.getElementById('pc-mobile-back').click(); true`);
  await sleep(300);
  const closed = JSON.parse(await js(w, `JSON.stringify({ hidden: document.getElementById('profile-card').classList.contains('hidden'), nav: getComputedStyle(document.getElementById('mobile-nav')).display, body: document.body.className })`));
  console.log('profile-closed', JSON.stringify(closed));
  if (!closed.hidden || closed.nav === 'none' || closed.body.includes('mobile-profile-open')) throw new Error('профиль не закрылся: ' + JSON.stringify(closed));

  // Системный back тоже закрывает.
  await js(w, `document.querySelector('#members-panel .member-item[data-profile]')?.click(); true`);
  await sleep(400);
  await js(w, `window.sozvonBack(); true`);
  await sleep(300);
  if (!(await js(w, `document.getElementById('profile-card').classList.contains('hidden')`))) throw new Error('системный back не закрыл профиль');
});
