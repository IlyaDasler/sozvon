// Сквозной аудит мобильных экранов: наложения, застрявшие модалки, скрим,
// горизонтальный скролл, нижнее меню и тач-зоны.
const { api, befriend, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

const snap = (w, label) => js(w, `(() => {
  const vis = (el) => el && el.getClientRects().length > 0 && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
  const modals = [...document.querySelectorAll('.modal')].filter(vis).map((m) => m.id || m.className).slice(0, 8);
  const scrim = document.querySelector('.scrim');
  const nav = document.getElementById('mobile-nav');
  const nr = nav ? nav.getBoundingClientRect() : null;
  const small = [];
  for (const b of document.querySelectorAll('button, [role="button"], a[href]')) {
    if (!vis(b)) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 36 || r.height < 36) small.push((b.id || b.className || b.textContent.trim().slice(0, 18)) + ':' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  const covered = [];
  for (const b of [...document.querySelectorAll('#settings button, #friend-tabs button, #mobile-nav button, #mobile-hubs button, #notif-panel button')]) {
    if (!vis(b)) continue;
    const r = b.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight) continue;
    const top = document.elementFromPoint(Math.round(r.left + Math.min(r.width / 2, 20)), Math.round(r.top + r.height / 2));
    if (top && !b.contains(top) && !top.contains(b)) covered.push((b.id || b.className || b.textContent.trim().slice(0, 16)) + ' → ' + (top.id || top.className || top.tagName));
  }
  return JSON.stringify({
    label: ${JSON.stringify(label)},
    vw: innerWidth, vh: innerHeight, docW: document.documentElement.scrollWidth,
    body: document.body.className,
    modals,
    scrim: scrim ? scrim.classList.contains('is-on') : null,
    nav: nav ? getComputedStyle(nav).display : null,
    navBottom: nr ? Math.round(nr.bottom) : null,
    small: [...new Set(small)].slice(0, 12),
    covered: [...new Set(covered)].slice(0, 8),
  });
})()`);

runTest(async () => {
  const a = await register('ca' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('cb' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Канал' }, a.token);
  const text = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const voice = await api('POST', '/rooms', { name: 'Голос', kind: 'voice', hubId: hub.id }, a.token);
  await api('POST', `/rooms/${text.id}/messages`, { text: 'привет' }, a.token);
  await api('POST', `/messages/${a.user.id}`, { text: 'личное' }, b.token);

  const w = await openClient('ca', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(1000);
  await waitFor(w, `e2eeReady()`, 'ключ');

  const report = [];
  const check = async (label, opts = {}) => {
    const d = JSON.parse(await snap(w, label));
    report.push(d);
    console.log('audit', JSON.stringify(d));
    if (d.docW > d.vw + 1) throw new Error(`[${label}] горизонтальный скролл ${d.docW}>${d.vw}`);
    if (!opts.allowModal && d.modals.length) throw new Error(`[${label}] застряли модалки: ${d.modals.join(',')}`);
    if (d.scrim && !opts.allowScrim) throw new Error(`[${label}] застрял скрим`);
    if (!opts.navHidden && d.nav === 'none') throw new Error(`[${label}] нижнее меню скрыто`);
    // covered ниже логируем, но не валим: в DOM остаются кнопки скрытых разделов.
  };

  await check('home');
  for (const tab of ['all', 'incoming', 'outgoing', 'blocked', 'add', 'online']) {
    await js(w, `document.querySelector('#friend-tabs [data-tab="${tab}"]').click(); true`);
    await sleep(300);
    await check('friends-' + tab);
  }

  await js(w, `selectContact(${b.user.id}); true`);
  await sleep(700);
  await check('dm', { navHidden: true });
  await js(w, `window.sozvonBack(); true`);
  await sleep(300);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(600);
  await check('channels');

  await js(w, `document.querySelector('#mobile-hubs .mobile-hub-card__settings').click(); true`);
  await sleep(500);
  await check('hub-settings', { allowModal: true });
  await js(w, `window.sozvonBack(); true`);
  await sleep(300);

  await js(w, `[...document.querySelectorAll('#mobile-hubs .mobile-hub-room')].find((r) => r.dataset.room === '${text.id}').querySelector('.mobile-hub-room__action').click(); true`);
  await sleep(700);
  await check('room-chat', { navHidden: true });
  if (await js(w, `Boolean(document.querySelector('.members-toggle'))`)) {
    await js(w, `document.querySelector('.members-toggle').click(); true`);
    await sleep(400);
    await check('members', { allowScrim: true, navHidden: true });
    await js(w, `document.querySelector('.scrim').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
    await sleep(300);
    await check('members-closed', { navHidden: true });
  }
  await js(w, `window.sozvonBack(); true`);
  await sleep(300);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(500);
  await check('notifications', { allowModal: true });
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(300);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(600);
  await check('settings', { allowModal: true });
  await js(w, `document.getElementById('mobile-profile-open').click(); true`);
  await sleep(400);
  await check('settings-profile', { allowModal: true });
  await js(w, `document.getElementById('mobile-settings-back')?.click(); true`);
  await sleep(300);

  for (const tab of ['look', 'sound', 'notify', 'account', 'privacy', 'devices', 'crypto']) {
    await js(w, `document.querySelector('#set-nav [data-tab="${tab}"]')?.click(); true`);
    await sleep(450);
    await check('settings-' + tab, { allowModal: true });
    await js(w, `document.getElementById('mobile-settings-back')?.click(); true`);
    await sleep(250);
  }

  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(300);
  await js(w, `closeSettings(); true`);
  await sleep(300);
  await check('settings-closed');

  console.log('AUDIT_SUMMARY', JSON.stringify(report.map((r) => ({ label: r.label, small: r.small.length, covered: r.covered.length }))));
});
