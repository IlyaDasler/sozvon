// Звонок человеку, который сидит в голосовом канале: он должен получить входящий,
// а при принятии — выйти из канала и оказаться в разговоре.
// Запуск (сервер должен работать): node_modules/electron/dist/electron.exe scripts/e2e-call-in-room.js
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('cirA', 'Аня');
  const b = await register('cirB', 'Боря');
  await befriend(a, b);

  const hub = await api('POST', '/hubs', { name: 'Канал для звонка' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { name: 'Голосовая', kind: 'voice', hubId: hub.id }, a.token);

  const winA = await openClient('cirA', a);
  const winB = await openClient('cirB', b);
  await sleep(1200);

  // Боря садится в голосовой канал
  await js(winB, `openHub(${hub.id}); true`);
  await waitFor(winB, `Boolean(document.querySelector('#room-list [data-room="${room.id}"]'))`, 'комната видна', 4000);
  await js(winB, `joinRoomVoice(${room.id}); true`);
  await waitFor(winB, `state.room?.joined`, 'Боря в голосовом канале', 10000);
  console.log('✔ Боря сидит в голосовом канале');

  // Аня звонит ему напрямую
  await js(winA, `selectContact(${b.user.id}).then(() => startCall())`);
  await waitFor(winB, `!document.getElementById('incoming').classList.contains('hidden')`, 'входящий звонок', 10000);
  console.log('✔ человеку в голосовом канале можно позвонить');

  // Принимаем: приложение спрашивает про выход из канала, подтверждаем
  await js(winB, `document.getElementById('accept-btn').click(); true`);
  await waitFor(winB, `!document.getElementById('dialog').classList.contains('hidden')`, 'вопрос о выходе из канала', 4000);
  await js(winB, `document.getElementById('dialog-ok').click(); true`);

  await waitFor(winA, `state.call?.phase === 'connected'`, 'звонок соединился у Ани', 20000);
  await waitFor(winB, `state.call?.phase === 'connected'`, 'звонок соединился у Бори', 20000);
  if (await js(winB, `state.room !== null`)) throw new Error('Боря остался в голосовом канале');
  console.log('✔ приняв звонок, человек выходит из канала и оказывается в разговоре');

  await js(winA, 'hangup(); true');
  await sleep(600);
  console.log('✔ звонок завершается');
});
