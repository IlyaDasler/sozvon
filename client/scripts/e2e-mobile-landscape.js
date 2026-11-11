// Альбомная ориентация телефона: одна мобильная колонка, нижнее меню на месте,
// ничего не уходит под меню и не разъезжается по горизонтали.
const { api, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

const m = (w, label) => js(w, `(() => {
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { d: c.display, x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right), y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom) }; };
  return JSON.stringify({
    label: ${JSON.stringify(label)},
    vw: innerWidth, vh: innerHeight,
    docW: document.documentElement.scrollWidth,
    nav: q('#mobile-nav'), main: q('.main'), content: q('.content'),
    sidebar: q('.sidebar'), settings: q('#settings'), card: q('#settings .set-card'),
    hubCard: q('#hub-settings .rs-card'), thread: q('#thread-panel'),
  });
})()`);

const assertNoOverflow = (d) => {
  if (d.docW > d.vw + 2) throw new Error(`горизонтальный скролл на «${d.label}»: ${d.docW} > ${d.vw}`);
};
const assertNav = (d) => {
  if (!d.nav || d.nav.d === 'none') throw new Error(`нижнее меню исчезло на «${d.label}»`);
  if (d.nav.d !== 'grid') throw new Error(`меню не сетка на «${d.label}»: ${d.nav.d}`);
};

runTest(async () => {
  const a = await register('ls' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Ландшафт' }, a.token);
  const room = await api('POST', '/rooms', { name: 'Чат', kind: 'text', hubId: hub.id }, a.token);
  const msg = await api('POST', `/rooms/${room.id}/messages`, { text: 'корень' }, a.token);

  const w = await openClient('ls', a);
  w.setSize(932, 454); w.show(); w.focus();
  await sleep(900);
  await waitFor(w, `e2eeReady()`, 'ключ');

  for (const [label, step] of [
    ['home', 'true'],
    ['channels', `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`],
    ['room', `openHub(${hub.id}); selectRoom(${room.id}); true`],
  ]) {
    await js(w, step);
    await sleep(label === 'room' ? 600 : 400);
    const d = JSON.parse(await m(w, label));
    console.log('landscape', JSON.stringify(d));
    assertNoOverflow(d);
    assertNav(d);
    if (d.content && d.content.bottom > d.nav.y + 1) throw new Error(`контент под меню на «${label}»: ${JSON.stringify(d.content)} nav=${d.nav.y}`);
    if (label === 'channels') {
      if (d.sidebar.w < d.vw - 4) throw new Error(`каналы не на всю ширину: ${d.sidebar.w} из ${d.vw}`);
    }
    if (label === 'room') {
      if (d.content.w < d.vw - 20) throw new Error(`чат не на всю ширину в комнате: ${d.content.w} из ${d.vw}`);
    }
  }

  // Настройки канала: окно над меню, меню на месте.
  await js(w, `document.getElementById('mobile-channel-settings').click(); true`);
  await sleep(500);
  let d = JSON.parse(await m(w, 'hub-settings'));
  console.log('landscape', JSON.stringify(d));
  assertNoOverflow(d);
  assertNav(d);
  if (d.hubCard && d.hubCard.bottom > d.nav.y + 1) throw new Error('настройки канала под меню: ' + JSON.stringify(d.hubCard));
  await js(w, `closeHubSettings(); true`);
  await sleep(200);

  // Тред: полноэкранный, без горизонтального скролла.
  await js(w, `openThread({ id: ${msg.id}, roomId: ${room.id}, threadRoot: ${msg.id} }, { roomId: ${room.id} }); true`);
  await sleep(500);
  d = JSON.parse(await m(w, 'thread'));
  console.log('landscape', JSON.stringify(d));
  assertNoOverflow(d);
  if (!d.thread || d.thread.d === 'none') throw new Error('тред не открылся');
  if (Math.abs(d.thread.w - d.vw) > 2 || Math.abs(d.thread.h - d.vh) > 2) throw new Error('тред не на весь экран: ' + JSON.stringify(d.thread));
  await js(w, `closeThread(); true`);
  await sleep(200);

  // Настройки: меню на месте, карточка заканчивается над ним.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(600);
  d = JSON.parse(await m(w, 'settings'));
  console.log('landscape', JSON.stringify(d));
  assertNoOverflow(d);
  assertNav(d);
  if (d.card && d.card.bottom > d.nav.y + 1) throw new Error('карточка настроек под меню: ' + JSON.stringify(d.card));

  await js(w, `document.querySelector('#set-nav [data-tab="look"]').click(); true`);
  await sleep(500);
  d = JSON.parse(await m(w, 'settings-look'));
  console.log('landscape', JSON.stringify(d));
  assertNoOverflow(d);
  assertNav(d);
});
