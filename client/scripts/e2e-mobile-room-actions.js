// Настройки комнаты и создание события: вкладки, сохранение, закрытие.
const { api, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('ra' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'События' }, a.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const w = await openClient('ra', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500);
  await js(w, `selectRoom(${room.id}); true`);
  await sleep(700);

  await js(w, `openRoomManage(${room.id}); true`);
  await sleep(500);
  for (const tab of ['members', 'bans', 'overview']) {
    await js(w, `document.querySelector('#rs-nav [data-tab="${tab}"]').click(); true`);
    await sleep(250);
    const ok = await js(w, `document.querySelector('#rs-nav [data-tab="${tab}"]').classList.contains('active')`);
    if (!ok) throw new Error('вкладка комнаты не активна: ' + tab);
    const overflow = await js(w, `document.getElementById('rs-body').scrollWidth > document.getElementById('rs-body').clientWidth + 2`);
    if (overflow) throw new Error('горизонтальный скролл в настройках комнаты: ' + tab);
    console.log('room-tab', tab);
  }
  await js(w, `window.sozvonBack(); true`);
  await sleep(300);
  if (!(await js(w, `document.getElementById('room-manage').classList.contains('hidden')`))) throw new Error('настройки комнаты не закрылись back');

  // Создание события с дефолтными датой/временем.
  await js(w, `openEventCreate(state.hubs.get(${hub.id})); true`);
  await sleep(500);
  const title = 'Событие ' + Date.now();
  await js(w, `(() => {
    const input = document.getElementById('event-title');
    input.value = ${JSON.stringify(title)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await js(w, `document.getElementById('event-submit').click(); true`);
  await waitFor(w, `document.getElementById('event-create').classList.contains('hidden')`, 'событие сохранилось', 8000);
  const events = await js(w, `roomById(${room.id})?.events?.some((e) => e.title === ${JSON.stringify(title)}) || false`);
  console.log('event-created', title, events);
  if (!events) throw new Error('событие не появилось в состоянии');
});
