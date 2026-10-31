// Неподвижный экран (документ, рабочий стол): зритель, нажавший «Смотреть» позже, всё равно видит картинку.
// Запуск (сервер должен работать): node_modules/electron/dist/electron.exe scripts/e2e-static-screen.js
const { app } = require('electron');
process.env.E2E_REAL_DEVICES = '1';
const { api, befriend, register, js, waitFor, sleep, openClient, tilePlaying, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('ssa', 'Аня');
  const b = await register('ssb', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Эфир' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { name: 'голос', kind: 'voice', hubId: hub.id }, a.token);
  const winA = await openClient('ssa', a);
  const winB = await openClient('ssb', b);
  for (const w of [winA, winB]) await js(w, `openHub(${hub.id}); openRoom(${room.id}); true`);
  for (const w of [winA, winB]) await waitFor(w, 'state.room?.joined && state.room.session.peers.size === 1', 'оба в голосе', 20000);

  await js(winA, `store.set('screenTab', 'screen'); toggleScreen(); true`);
  await waitFor(winA, `document.querySelectorAll('#screen-sources .source.selected').length === 1 && !document.getElementById('screen-start').disabled`, 'выбор экрана', 8000);
  await js(winA, `document.getElementById('screen-start').click(); true`);
  await waitFor(winA, 'Boolean(activeSession().local.tracks.screen)', 'показ начался', 8000);
  await waitFor(winB, `Boolean(document.querySelector('.tile[data-key="u${a.user.id}:screen"] .tile-watch'))`, 'кнопка смотреть', 10000);
  await sleep(4000); // кадры с начала показа уже прошли: зритель приходит позже
  await js(winB, `document.querySelector('.tile[data-key="u${a.user.id}:screen"] .tile-watch').click(); true`);

  const key = `u${a.user.id}:screen`;
  const sent = () => js(winA, `(async () => { let n = 0; for (const p of activeSession().peers.values()) (await p.link.pc.getStats()).forEach((s) => { if (s.type === 'outbound-rtp' && s.kind === 'video') n += s.framesSent || 0; }); return n; })()`);
  const before = await sent();
  try {
    await waitFor(winB, tilePlaying(winB, key), 'зритель видит неподвижный экран', 12000);
  } finally {
    console.log('кадров отправлено за время ожидания:', (await sent()) - before);
  }
  console.log('✔ зритель видит неподвижный экран');
  for (const w of [winA, winB]) await js(w, 'leaveRoomVoice(); true');
});
