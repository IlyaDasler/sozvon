// Переключение нижнего меню должно закрывать любые открытые окна, а не оставлять их поверх.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('to' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Окна' }, a.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const w = await openClient('to', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(600);

  const hidden = (id) => js(w, `document.getElementById('${id}').classList.contains('hidden')`);

  await js(w, `openHubSettings(${hub.id}); true`);
  await sleep(500);
  if (await hidden('hub-settings')) throw new Error('настройки канала не открылись');
  await js(w, `document.querySelector('#mobile-nav [data-mobile="home"]').click(); true`);
  await sleep(400);
  if (!(await hidden('hub-settings'))) throw new Error('настройки канала остались поверх «Друзей»');
  console.log('ok hub-settings-closed-by-nav');

  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(400);
  await js(w, `openRoomManage(${room.id}); true`);
  await sleep(500);
  if (await hidden('room-manage')) throw new Error('настройки комнаты не открылись');
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(400);
  if (!(await hidden('room-manage'))) throw new Error('настройки комнаты остались поверх уведомлений');
  console.log('ok room-manage-closed-by-nav');

  // Закрываем уведомления и открываем форму события.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(300);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(400);
  await js(w, `selectRoom(${room.id}); openEventCreate(state.hubs.get(${hub.id})); true`);
  await sleep(500);
  if (await hidden('event-create')) throw new Error('форма события не открылась');
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500);
  if (!(await hidden('event-create'))) throw new Error('форма события осталась поверх настроек');
  console.log('ok event-closed-by-nav');

  // Приглашения канала и комнаты тоже не должны висеть поверх разделов.
  await js(w, `closeSettings(); openHubInvite(${hub.id}); true`);
  await sleep(500);
  if (await hidden('hub-invite')) throw new Error('приглашение канала не открылось');
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(400);
  if (!(await hidden('hub-invite'))) throw new Error('приглашение канала осталось поверх каналов');
  await js(w, `openRoomInvite(${room.id}); true`);
  await sleep(500);
  if (await hidden('room-invite')) throw new Error('приглашение комнаты не открылось');
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(400);
  if (!(await hidden('room-invite'))) throw new Error('приглашение комнаты осталось поверх уведомлений');
  console.log('ok invites-closed-by-nav');
});
