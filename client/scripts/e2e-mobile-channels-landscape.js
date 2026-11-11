// Каналы в альбоме на реальном размере Samsung: после любых переходов список должен быть виден.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

const state = (w, label) => js(w, `(() => {
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { d: c.display, z: c.zIndex, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const card = document.querySelector('#mobile-hubs .mobile-hub-card');
  let hit = null;
  if (card) { const r = card.getBoundingClientRect(); const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + Math.min(20, r.height / 2))); hit = el ? (el.id || el.className || el.tagName) : null; }
  return JSON.stringify({ label: ${JSON.stringify(label)}, vw: innerWidth, vh: innerHeight, body: document.body.className, sidebar: q('.sidebar'), hubs: q('#mobile-hubs'), card: q('#mobile-hubs .mobile-hub-card'), hubRows: document.querySelectorAll('#mobile-hubs .mobile-hub-card').length, rooms: document.querySelectorAll('#mobile-hubs .mobile-hub-room').length, hit });
})()`);

runTest(async () => {
  const a = await register('cl' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Ландшафт' }, a.token);
  await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  await api('POST', '/rooms', { name: 'Голос', kind: 'voice', hubId: hub.id }, a.token);
  const w = await openClient('cl', a);
  w.setSize(937, 431); w.show(); w.focus();
  await sleep(900);

  const check = async (label) => {
    const d = JSON.parse(await state(w, label));
    console.log('channels-land', JSON.stringify(d));
    if (d.body.includes('mobile-channels')) {
      if (!d.sidebar || d.sidebar.d === 'none') throw new Error(label + ': сайдбар каналов скрыт');
      if (!d.card || d.card.h < 20) throw new Error(label + ': карточек каналов нет');
      if (d.rooms < 1) throw new Error(label + ': комнат в карточке нет');
      if (!d.hit) throw new Error(label + ': карточка не видна');
      if (d.card.w < d.vw - 40) throw new Error(label + ': карточка не растянута по ширине: ' + JSON.stringify(d.card) + ' vw=' + d.vw);
    }
  };

  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(600); await check('fresh');

  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(600); await check('from-settings');

  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(500);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(600); await check('from-notifications');

  await js(w, `openHub(${hub.id}); true`);
  await sleep(700);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(600); await check('from-hub');

  await js(w, `document.querySelector('#mobile-nav [data-mobile="home"]').click(); true`);
  await sleep(400);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(600); await check('from-home');

  // Реальный вход в чат из карточки: слева каналы/комнаты, справа чат.
  await js(w, `document.querySelector('#mobile-hubs .mobile-hub-room__action').click(); true`);
  await sleep(700);
  const split = JSON.parse(await js(w, `(() => {
    const sb = document.querySelector('.sidebar').getBoundingClientRect();
    const main = document.getElementById('main').getBoundingClientRect();
    return JSON.stringify({
      body: document.body.className,
      sidebarW: Math.round(sb.width), sidebarVisible: getComputedStyle(document.querySelector('.sidebar')).display,
      mainLeft: Math.round(main.left), mainW: Math.round(main.width), vw: innerWidth,
      chat: document.getElementById('room-view').classList.contains('hidden') ? 'hidden' : 'shown',
      nav: getComputedStyle(document.getElementById('mobile-nav')).display,
    });
  })()`));
  console.log('channels-split', JSON.stringify(split));
  if (split.body.includes('mobile-list')) throw new Error('список не закрылся при входе в чат');
  if (split.sidebarVisible === 'none' || split.sidebarW < 200) throw new Error('в альбоме нет колонки каналов/комнат');
  if (split.mainLeft < 200 || split.mainW > split.vw - 200) throw new Error('чат не занял правую колонку: ' + JSON.stringify(split));
  if (split.nav === 'none') throw new Error('меню пропало в чате');
});
