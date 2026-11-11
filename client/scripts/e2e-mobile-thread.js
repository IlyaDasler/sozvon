// Тред на телефоне: полноэкранный непрозрачный лист, без blur,
// без наложения на нижнее меню, без автофокуса, back закрывает.
const { api, befriend, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('th' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('thb' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Треды' }, a.token);
  const room = await api('POST', '/rooms', { name: 'Чат', kind: 'text', hubId: hub.id }, a.token);
  const msg = await api('POST', `/rooms/${room.id}/messages`, { text: 'корень треда' }, a.token);

  const w = await openClient('th', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await waitFor(w, `e2eeReady()`, 'ключ');
  await js(w, `openHub(${hub.id}); selectRoom(${room.id}); true`);
  await sleep(600);
  await waitFor(w, `[...document.querySelectorAll('#room-messages .msg')].some((m) => m.textContent.includes('корень треда'))`, 'сообщение в комнате', 6000);
  const navBefore = await js(w, `getComputedStyle(document.getElementById('mobile-nav')).display`);
  await js(w, `openThread({ id: ${msg.id}, roomId: ${room.id}, threadRoot: ${msg.id} }, { roomId: ${room.id} }); true`);
  await waitFor(w, `document.getElementById('thread-panel').classList.contains('thread-open')`, 'тред открылся', 4000);
  await sleep(400);

  const g = JSON.parse(await js(w, `(() => {
    const p = document.getElementById('thread-panel');
    const cs = getComputedStyle(p);
    const r = p.getBoundingClientRect();
    const nav = document.getElementById('mobile-nav');
    const back = document.getElementById('thread-back');
    const close = document.getElementById('thread-close');
    const form = p.querySelector('.thread-form');
    const fr = form.getBoundingClientRect();
    return JSON.stringify({
      pos: cs.position,
      top: Math.round(r.top),
      left: Math.round(r.left),
      w: Math.round(r.width),
      h: Math.round(r.height),
      vw: innerWidth, vh: innerHeight,
      blur: cs.backdropFilter || cs.webkitBackdropFilter,
      bg: cs.backgroundColor,
      navDisplay: nav ? getComputedStyle(nav).display : 'none',
      backDisplay: back ? getComputedStyle(back).display : 'none',
      closeDisplay: close ? getComputedStyle(close).display : 'none',
      formBottom: Math.round(fr.bottom),
      formTop: Math.round(fr.top),
      overflowX: p.scrollWidth > p.clientWidth + 2,
    });
  })()`));
  console.log('thread', JSON.stringify(g));

  if (g.pos !== 'fixed') throw new Error('тред не fixed: ' + g.pos);
  if (Math.abs(g.top) > 1 || Math.abs(g.left) > 1) throw new Error('тред не прижат к экрану: ' + JSON.stringify(g));
  if (Math.abs(g.w - g.vw) > 2) throw new Error('тред не на всю ширину: ' + g.w + ' vs ' + g.vw);
  if (Math.abs(g.h - g.vh) > 2) throw new Error('тред не на всю высоту: ' + g.h + ' vs ' + g.vh);
  if (g.blur && g.blur !== 'none') throw new Error('у треда остался blur: ' + g.blur);
  if (/rgba\(0, 0, 0, 0\)|transparent/.test(g.bg)) throw new Error('фон треда прозрачный: ' + g.bg);
  if (g.navDisplay !== 'none') throw new Error('нижнее меню просвечивает под тредом: ' + g.navDisplay);
  if (g.backDisplay === 'none') throw new Error('нет кнопки «Назад» в треде');
  if (g.closeDisplay !== 'none') throw new Error('в треде остался крестик');
  if (g.formBottom > g.vh + 1) throw new Error('поле ввода вылезает за экран: ' + g.formBottom + ' > ' + g.vh);
  if (g.overflowX) throw new Error('тред скроллится по горизонтали');

  const focused = await js(w, `(() => { const e = document.activeElement; return e ? e.tagName + '#' + (e.id || '') : ''; })()`);
  if (/TEXTAREA|INPUT/.test(focused)) throw new Error('автофокус в треде: ' + focused);
  console.log('ok thread layout/no-autofocus', focused || '(body)');

  // Системный back закрывает тред, а не уводит из чата.
  const back = JSON.parse(await js(w, `(() => { const r = window.sozvonBack(); return JSON.stringify({ r, hidden: document.getElementById('thread-panel').classList.contains('hidden'), nav: getComputedStyle(document.getElementById('mobile-nav')).display }); })()`));
  if (!back.r || !back.hidden) throw new Error('back не закрыл тред: ' + JSON.stringify(back));
  if (back.nav !== navBefore) throw new Error('нижнее меню не вернулось после закрытия треда: ' + navBefore + ' -> ' + back.nav);
  console.log('ok thread back', JSON.stringify(back));
});
