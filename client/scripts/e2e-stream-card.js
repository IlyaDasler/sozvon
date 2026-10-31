// Карточка трансляции в списке голоса: навели на человека «В ЭФИРЕ» — кадр и кнопка «Смотреть трансляцию».
// Боря смотрит, не заходя в голос заранее; Вера уже в голосе; свою трансляцию карточкой не показываем.
// Запуск (сервер должен работать): node_modules/electron/dist/electron.exe scripts/e2e-stream-card.js
const { api, befriend, register, js, waitFor, sleep, openClient, tilePlaying, runTest } = require('./e2e-lib');

const hidden = (id) => `document.getElementById('${id}').classList.contains('hidden')`;

/** Навести настоящую мышь на элемент */
async function hover(win, expr) {
  const at = await js(win, `(() => { const r = (${expr}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
  return at;
}

async function realClick(win, expr) {
  const at = await hover(win, expr);
  await sleep(100);
  for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...at, button: 'left', clickCount: 1 });
}

runTest(async () => {
  const a = await register('sca', 'Аня');
  const b = await register('scb', 'Боря');
  const c = await register('scc', 'Вера');
  await befriend(a, b);
  await befriend(a, c);
  const hub = await api('POST', '/hubs', { name: 'Эфир' }, a.token);
  for (const u of [b, c]) {
    await api('POST', `/hubs/${hub.id}/invites`, { userIds: [u.user.id] }, a.token);
    await api('POST', `/hub-invites/${hub.id}/accept`, null, u.token);
  }
  const room = await api('POST', '/rooms', { name: 'голос', kind: 'voice', hubId: hub.id }, a.token);
  const winA = await openClient('sca', a);
  const winB = await openClient('scb', b);
  const winC = await openClient('scc', c);
  for (const w of [winA, winB, winC]) {
    w.show();
    await js(w, `openHub(${hub.id}); true`);
  }

  await js(winA, `openRoom(${room.id}); true`);
  await js(winC, `openRoom(${room.id}); true`);
  await waitFor(winC, 'state.room?.joined && state.room.session.peers.size === 1', 'Вера в голосе', 20000);
  await js(winA, `store.set('screenTab', 'screen'); toggleScreen(); true`);
  await waitFor(winA, `document.querySelectorAll('#screen-sources .source').length > 0`, 'источники', 8000);
  await js(winA, `document.querySelector('#screen-sources .source').click(); document.getElementById('screen-start').click(); true`);
  await waitFor(winA, 'Boolean(activeSession().local.tracks.screen)', 'показ начался', 8000);

  const person = (user) => `document.querySelector('#room-list [data-voice-user="${user.user.id}"]')`;
  await waitFor(winB, `${person(a)}?.querySelector('.live')`, 'значок «В ЭФИРЕ» у Бори', 8000);
  await sleep(3500); // первый кадр

  // Своя трансляция: карточки нет
  await hover(winA, person(a));
  await sleep(500);
  if (!(await js(winA, hidden('stream-peek')))) throw new Error('Карточка на свою же трансляцию');
  console.log('✔ на свою трансляцию карточка не открывается');

  if (process.env.E2E_SHOTS) winB.setAlwaysOnTop(true, 'screen-saver');
  // Боря не в голосе: видит кадр и кнопку
  await hover(winB, person(a));
  await waitFor(winB, `!${hidden('stream-peek')}`, 'карточка открылась', 3000);
  await waitFor(winB, `document.getElementById('stream-peek-image').src.startsWith('data:image/jpeg')`, 'кадр трансляции', 5000);
  const size = await js(winB, `(() => { const i = document.getElementById('stream-peek-image'); return [i.naturalWidth, i.naturalHeight]; })()`);
  if (size[0] < 100) throw new Error(`Кадр пустой: ${size}`);
  console.log('✔ Боря видит кадр, не заходя в голос', size);
  if (process.env.E2E_SHOTS) {
    console.log('голос идёт через:', await js(winC, 'state.room.session.constructor.name'));
    for (const theme of ['sozvon', 'light']) {
      await js(winB, `setTheme('${theme}'); true`);
      await sleep(800);
      winB.webContents.invalidate();
      await sleep(300);
      require('fs').writeFileSync(`${process.env.E2E_SHOTS}/card-${theme}.png`, (await winB.webContents.capturePage()).toPNG());
    }
  }

  // Мышь перешла с человека на карточку — карточка остаётся
  await hover(winB, `document.getElementById('stream-peek-watch')`);
  await sleep(500);
  if (await js(winB, hidden('stream-peek'))) throw new Error('Карточка закрылась, пока до неё вели мышь');

  // Нажал — подключился и смотрит
  await realClick(winB, `document.getElementById('stream-peek-watch')`);
  await waitFor(winB, 'state.room?.joined', 'Боря подключился', 20000);
  await waitFor(winB, tilePlaying(winB, `u${a.user.id}:screen`), 'Боря смотрит экран', 20000);
  if (!(await js(winB, hidden('stream-peek')))) throw new Error('Карточка не закрылась после нажатия');
  console.log('✔ кнопка подключает к голосу и включает просмотр');

  // Вера уже в голосе: кнопка просто включает просмотр
  await hover(winC, person(a));
  await waitFor(winC, `!${hidden('stream-peek')}`, 'карточка у Веры', 3000);
  await realClick(winC, `document.getElementById('stream-peek-watch')`);
  await waitFor(winC, tilePlaying(winC, `u${a.user.id}:screen`), 'Вера смотрит экран', 20000);
  console.log('✔ в голосе кнопка включает просмотр');

  // Увели мышь — закрылась
  await hover(winC, person(a));
  await waitFor(winC, `!${hidden('stream-peek')}`, 'карточка снова', 3000);
  winC.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 300 });
  await waitFor(winC, hidden('stream-peek'), 'карточка закрылась, когда увели мышь', 2000);
  console.log('✔ карточка закрывается, когда мышь ушла');

  // Показ закончился — открытая карточка не должна остаться
  await hover(winC, person(a));
  await waitFor(winC, `!${hidden('stream-peek')}`, 'карточка перед концом показа', 3000);
  await js(winA, 'activeSession().stopScreen?.(); true');
  await waitFor(winA, '!activeSession().local.tracks.screen', 'показ остановлен', 5000);
  await waitFor(winC, hidden('stream-peek'), 'карточка закрылась с концом показа', 5000);
  console.log('✔ конец показа закрывает карточку');

  for (const w of [winA, winB, winC]) await js(w, 'leaveRoomVoice(); true');
});
