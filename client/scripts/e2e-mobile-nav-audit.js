// Аудит нижнего меню по всем экранам: где оно видно и не перекрыто ли.
const { api, befriend, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

const nav = (w, label) => js(w, `(() => {
  const n = document.getElementById('mobile-nav');
  const r = n.getBoundingClientRect();
  const cs = getComputedStyle(n);
  const sample = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + Math.min(20, r.height / 2)));
  return JSON.stringify({
    label: ${JSON.stringify(label)},
    display: cs.display, z: cs.zIndex, y: Math.round(r.top), h: Math.round(r.height),
    bottom: Math.round(r.bottom), vh: innerHeight,
    topEl: sample ? (sample.id || sample.className || sample.tagName) : null,
    body: document.body.className,
  });
})()`);

runTest(async () => {
  const a = await register('na' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('nab' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Меню' }, a.token);
  const room = await api('POST', '/rooms', { name: 'Чат', kind: 'text', hubId: hub.id }, a.token);
  const msg = await api('POST', `/rooms/${room.id}/messages`, { text: 'корень' }, a.token);
  const w = await openClient('na', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await waitFor(w, `e2eeReady()`, 'ключ');

  const check = async (label) => {
    const s = JSON.parse(await nav(w, label));
    console.log('nav', JSON.stringify(s));
    if (s.display === 'none') throw new Error('меню скрыто: ' + label);
    if (s.topEl && /mobile-nav/.test(s.topEl)) return;
    // Верхний элемент в точке меню должен быть самим меню/его кнопкой.
    if (s.topEl && !/mobile-nav|BUTTON|mobile-badge/.test(s.topEl)) throw new Error('меню перекрыто на ' + label + ': ' + s.topEl);
  };

  await check('home');
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(400); await check('channels');
  await js(w, `openHub(${hub.id}); true`);
  await sleep(500); await check('hub');
  await js(w, `selectRoom(${room.id}); true`);
  await sleep(600); await check('room');
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(500); await check('notifications');
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500); await check('settings');
  await js(w, `document.querySelector('#set-nav [data-tab="look"]').click(); true`);
  await sleep(400); await check('settings-section');
  await js(w, `document.getElementById('mobile-settings-back').click(); true`);
  await sleep(200);
  await js(w, `closeSettings(); true`);
  await sleep(200);

  await js(w, `openHub(${hub.id}); document.getElementById('mobile-channel-settings').click(); true`);
  await sleep(500); await check('hub-settings');
  await js(w, `closeHubSettings(); true`);
  await sleep(200);

  await js(w, `openRoomManage(${room.id}); true`);
  await sleep(500); await check('room-manage');
  await js(w, `closeRoomManage(); true`);
  await sleep(200);

  await js(w, `openThread({ id: ${msg.id}, roomId: ${room.id}, threadRoot: ${msg.id} }, { roomId: ${room.id} }); true`);
  await sleep(400);
  const t = JSON.parse(await nav(w, 'thread'));
  console.log('nav', JSON.stringify(t));
  await js(w, `closeThread(); true`);
  await sleep(200);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="home"]').click(); true`);
  await sleep(300);
  await js(w, `selectContact(${b.user.id}); true`);
  await sleep(600); await check('dm');
});
