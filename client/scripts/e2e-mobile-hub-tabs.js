// Мобильная проверка вкладок «Настройки канала» и формы «Создать событие»:
// всё в одну колонку, без горизонтального переполнения, вкладки реально переключаются.
const fs = require('fs');
const { api, register, js, sleep, openClient, runTest, screenshot, waitFor } = require('./e2e-lib');

const overflow = (w) => js(w, `(() => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('#hub-settings .rs-body *, #event-create .event-form *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right > vw + 2 || r.left < -2) bad.push({ id: el.id || '', cls: (el.className || '').toString().slice(0, 32), left: Math.round(r.left), right: Math.round(r.right), vw });
  }
  return JSON.stringify({ bad, vw, bodyOverflowX: getComputedStyle(document.body).overflowX, hsBody: (() => { const b = document.getElementById('hs-body'); return b ? [b.scrollWidth, b.clientWidth] : null; })() });
})()`);

runTest(async () => {
  const a = await register('mht' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Мобильный канал' }, a.token);
  await api('POST', '/rooms', { name: 'Чат', kind: 'text', hubId: hub.id }, a.token);
  await api('POST', '/rooms', { name: 'Голос', kind: 'voice', hubId: hub.id }, a.token);
  const w = await openClient('mht', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.documentElement.style.setProperty('--safe-area-inset-top','36px'); true`);
  await sleep(200);

  await js(w, `openHub(${hub.id}); true`);
  await sleep(600);
  await js(w, `openHubSettings(${hub.id}); true`);
  await waitFor(w, `!document.getElementById('hub-settings').classList.contains('hidden')`, 'настройки канала открылись');

  for (const tab of ['events', 'roles', 'emojis', 'members', 'bans', 'overview']) {
    await js(w, `document.querySelector('#hs-nav [data-tab="${tab}"]').click(); true`);
    await sleep(250);
    const active = await js(w, `document.querySelector('#hs-nav [data-tab="${tab}"]').classList.contains('active')`);
    if (!active) throw new Error('вкладка не стала активной: ' + tab);
    const o = JSON.parse(await overflow(w));
    if (o.bad.length) throw new Error('переполнение на вкладке ' + tab + ': ' + JSON.stringify(o.bad));
    if (o.hsBody && o.hsBody[0] > o.hsBody[1] + 2) throw new Error('hs-body скроллится по X на ' + tab + ': ' + JSON.stringify(o.hsBody));
    console.log('ok tab', tab, JSON.stringify(o));
    if (process.env.E2E_SHOTS) await screenshot(w, 'hub-tab-' + tab);
  }

  // Форма создания события
  await js(w, `document.querySelector('#hs-nav [data-tab="events"]').click(); true`);
  await sleep(200);
  await js(w, `[...document.querySelectorAll('#hs-body .btn')].find((b) => b.textContent === 'Создать событие')?.click(); true`);
  await sleep(300);
  if (!(await js(w, `!document.getElementById('event-create').classList.contains('hidden')`))) throw new Error('форма события не открылась');
  const eo = JSON.parse(await overflow(w));
  if (eo.bad.length) throw new Error('переполнение формы события: ' + JSON.stringify(eo.bad));
  console.log('ok event-form', JSON.stringify(eo));
  if (process.env.E2E_SHOTS) await screenshot(w, 'event-form');
  await js(w, `document.getElementById('event-x').click(); true`);
});
