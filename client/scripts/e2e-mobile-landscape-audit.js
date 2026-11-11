// Диагностика альбомной ориентации: размеры ключевых слоёв и горизонтальное переполнение.
const { api, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

const snapshot = (w, label) => js(w, `(() => {
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { d: c.display, p: c.position, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
  return JSON.stringify({
    label: ${JSON.stringify(label)},
    vw: innerWidth, vh: innerHeight,
    docScroll: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
    rail: q('#rail'), sidebar: q('.sidebar'), main: q('.main'), content: q('.content'),
    nav: q('#mobile-nav'), settings: q('#settings'), setCard: q('#settings .set-card'),
    hsCard: q('#hub-settings .rs-card'), thread: q('#thread-panel'),
    body: document.body.className,
  });
})()`);

runTest(async () => {
  const a = await register('la' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Ландшафт' }, a.token);
  const room = await api('POST', '/rooms', { name: 'Чат', kind: 'text', hubId: hub.id }, a.token);
  const msg = await api('POST', `/rooms/${room.id}/messages`, { text: 'корень' }, a.token);
  const w = await openClient('la', a);
  w.setSize(844, 390); w.show(); w.focus();
  await sleep(900);
  await waitFor(w, `e2eeReady()`, 'ключ');

  console.log(await snapshot(w, 'home'));

  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(400);
  console.log(await snapshot(w, 'channels'));

  await js(w, `openHub(${hub.id}); selectRoom(${room.id}); true`);
  await sleep(600);
  console.log(await snapshot(w, 'room'));

  await js(w, `openThread({ id: ${msg.id}, roomId: ${room.id}, threadRoot: ${msg.id} }, { roomId: ${room.id} }); true`);
  await sleep(500);
  console.log(await snapshot(w, 'thread'));
  await js(w, `closeThread(); true`);
  await sleep(200);

  await js(w, `document.getElementById('mobile-channel-settings').click(); true`);
  await sleep(500);
  console.log(await snapshot(w, 'hub-settings'));
  await js(w, `closeHubSettings(); true`);
  await sleep(200);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(600);
  console.log(await snapshot(w, 'settings'));

  await js(w, `document.querySelector('#set-nav [data-tab="look"]').click(); true`);
  await sleep(500);
  console.log(await snapshot(w, 'settings-look'));
});
