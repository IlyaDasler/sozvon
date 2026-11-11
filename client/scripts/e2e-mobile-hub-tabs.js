// Мобильная проверка «Настройки канала» и «Создать событие»:
// всё в одну колонку, без горизонтального переполнения, вкладки переключаются,
// селекторы ролей — плоские (не круглые), автоклавиатуры нет, back закрывает форму.
const { api, befriend, register, js, sleep, openClient, runTest, screenshot, waitFor } = require('./e2e-lib');

const overflow = (w) => js(w, `(() => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('#hub-settings .rs-body *, #event-create .event-form *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.position === 'fixed') continue;
    if (el.classList.contains('gs-native') || cs.opacity === '0' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right > vw + 2 || r.left < -2) bad.push({ id: el.id || '', cls: (el.className || '').toString().slice(0, 32), left: Math.round(r.left), right: Math.round(r.right), vw });
  }
  return JSON.stringify({ bad, vw, bodyOverflowX: getComputedStyle(document.body).overflowX, hsBody: (() => { const b = document.getElementById('hs-body'); return b ? [b.scrollWidth, b.clientWidth] : null; })() });
})()`);

runTest(async () => {
  const a = await register('mht' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('mhb' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Мобильный канал' }, a.token);
  await api('POST', '/rooms', { name: 'Чат', kind: 'text', hubId: hub.id }, a.token);
  await api('POST', '/rooms', { name: 'Голос', kind: 'voice', hubId: hub.id }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);

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
    await sleep(220);
    const active = await js(w, `document.querySelector('#hs-nav [data-tab="${tab}"]').classList.contains('active')`);
    if (!active) throw new Error('вкладка не стала активной: ' + tab);
    const o = JSON.parse(await overflow(w));
    if (o.bad.length) throw new Error('переполнение на вкладке ' + tab + ': ' + JSON.stringify(o.bad));
    if (o.hsBody && o.hsBody[0] > o.hsBody[1] + 2) throw new Error('hs-body скроллится по X на ' + tab + ': ' + JSON.stringify(o.hsBody));
    console.log('ok tab', tab);
    if (process.env.E2E_SHOTS) await screenshot(w, 'hub-tab-' + tab);
  }

  // Селектор роли участника — плоский прямоугольник, не «круглый» системный вид.
  await js(w, `document.querySelector('#hs-nav [data-tab="members"]').click(); true`);
  await sleep(250);
  const sel = JSON.parse(await js(w, `(() => {
    const s = document.querySelector('#hub-settings .member-actions .gs-select, #hub-settings .rs-body .gs-select');
    if (!s) return JSON.stringify({ found: false });
    const cs = getComputedStyle(s);
    const r = s.getBoundingClientRect();
    return JSON.stringify({ found: true, radius: cs.borderTopLeftRadius, h: Math.round(r.height), w: Math.round(r.width), right: Math.round(r.right), vw: document.documentElement.clientWidth });
  })()`));
  if (!sel.found) throw new Error('видимый селектор роли не найден в «Участниках»');
  if (parseFloat(sel.radius) > 12) throw new Error('селектор роли слишком круглый: radius=' + sel.radius);
  if (sel.h < 44) throw new Error('селектор роли ниже 44px: ' + sel.h);
  if (sel.right > sel.vw + 2) throw new Error('селектор роли вылезает за экран: ' + JSON.stringify(sel));
  console.log('ok role-select', JSON.stringify(sel));

  // Форма события: открывается без автофокуса (клавиатура не выезжает) и закрывается back.
  await js(w, `document.querySelector('#hs-nav [data-tab="events"]').click(); true`);
  await sleep(200);
  await js(w, `[...document.querySelectorAll('#hs-body .btn')].find((x) => x.textContent === 'Создать событие')?.click(); true`);
  await sleep(300);
  if (!(await js(w, `!document.getElementById('event-create').classList.contains('hidden')`))) throw new Error('форма события не открылась');
  const active = await js(w, `(() => { const e = document.activeElement; return e ? (e.tagName + '#' + (e.id || '')) : ''; })()`);
  if (/^(INPUT|TEXTAREA)/.test(active)) throw new Error('автофокус поля при открытии формы события: ' + active);
  console.log('ok no-autofocus', active || '(body)');
  const eo = JSON.parse(await overflow(w));
  if (eo.bad.length) throw new Error('переполнение формы события: ' + JSON.stringify(eo.bad));
  if (process.env.E2E_SHOTS) await screenshot(w, 'event-form');

  // Системный back должен закрыть форму события (а не хаб-настройки).
  const closed = await js(w, `(() => { const r = window.sozvonBack(); return JSON.stringify({ r, hidden: document.getElementById('event-create').classList.contains('hidden') }); })()`);
  const c = JSON.parse(closed);
  if (!c.r || !c.hidden) throw new Error('back не закрыл форму события: ' + closed);
  console.log('ok back-closes-event', closed);
});
