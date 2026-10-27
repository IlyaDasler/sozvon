// Сквозной тест голосовой комнаты: три окна заходят в один канал, включают камеру и показывают экран.
// Запуск (сервер должен работать): npx electron scripts/e2e-room.js [адрес сервера]
const { api, register, js, waitFor, sleep, openClient, received, tilePlaying, screenshot, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('ra', 'Аня');
  const b = await register('rb', 'Боря');
  const c = await register('rc', 'Вика');
  await api('POST', '/contacts', { username: b.user.username }, a.token);
  await api('POST', '/contacts', { username: c.user.username }, a.token);

  const winA = await openClient('ra', a);
  const winB = await openClient('rb', b);
  const winC = await openClient('rc', c);
  const all = [[winA, a], [winB, b], [winC, c]];
  console.log('✔ три клиента вошли');

  // Аня создаёт комнату через окно создания и зовёт друзей
  await js(winA, `openRoomCreate()`);
  await js(winA, `
    document.getElementById('room-name').value = 'Вечерние катки';
    document.querySelectorAll('#room-friends input').forEach((cb) => (cb.checked = true));
    document.getElementById('room-create-submit').click(); true`);
  await waitFor(winA, `state.selectedRoomId && document.getElementById('room-title').textContent === 'Вечерние катки'`, 'комната открылась у Ани');
  const roomId = await js(winA, 'state.selectedRoomId');
  for (const [win, u] of [[winB, b], [winC, c]])
    await waitFor(win, `state.rooms.has(${roomId})`, `комната появилась у ${u.user.displayName}`);
  console.log('✔ комната создана, друзья её видят');

  // Чат комнаты
  await js(winB, `selectRoom(${roomId}); document.getElementById('room-message-input').value = 'Всем привет'; document.getElementById('room-message-form').requestSubmit(); true`);
  await waitFor(winA, `[...document.querySelectorAll('#room-messages .msg-text')].some((el) => el.textContent === 'Всем привет')`, 'сообщение у Ани');
  await waitFor(winC, `state.roomUnread.get(${roomId}) === 1`, 'непрочитанное у Вики');
  console.log('✔ сообщения в комнате доходят, непрочитанные считаются');

  // Все трое заходят в голос
  for (const [win] of all) await js(win, `joinRoomVoice(${roomId})`);
  for (const [win, u] of all) {
    await waitFor(
      win,
      `state.room?.joined && activeSession().peers.size === 2 && [...activeSession().peers.values()].every((p) => p.state === 'connected')`,
      `${u.user.displayName}: соединение с двумя участниками`,
      20000
    );
  }
  console.log('✔ все трое в голосовом канале, каждый соединён с каждым');

  const before = await Promise.all(all.map(([w]) => received(w)));
  await sleep(2000);
  const after = await Promise.all(all.map(([w]) => received(w)));
  for (let i = 0; i < 3; i++) {
    for (const id of Object.keys(after[i])) {
      if (!(after[i][id].audio > before[i][id].audio)) throw new Error(`${all[i][1].user.displayName} не слышит ${id}`);
    }
  }
  console.log('✔ звук идёт между всеми участниками');

  await waitFor(winC, `document.querySelectorAll('#room-list .voice-users li').length === 3`, 'участники голоса в списке комнат');
  console.log('✔ в списке комнат видно, кто в голосе');

  // Аня включает камеру — её видят оба
  await js(winA, 'toggleCamera()');
  for (const [win, u] of [[winB, b], [winC, c]])
    await waitFor(win, tilePlaying(win, `u${a.user.id}`), `видео Ани у ${u.user.displayName}`);
  console.log('✔ камеру Ани видят Боря и Вика');
  await sleep(1000);
  await screenshot(winB, 'room-camera');

  // Боря показывает экран через окно выбора
  await js(winB, 'toggleScreen()');
  await waitFor(winB, `document.querySelectorAll('#screen-sources .source.selected').length === 1`, 'выбор экрана');
  await js(winB, `document.getElementById('screen-start').click(); true`);
  await waitFor(winB, `Boolean(activeSession().local.tracks.screen)`, 'демонстрация у Бори');
  for (const [win, u] of [[winA, a], [winC, c]]) {
    await waitFor(win, tilePlaying(win, `u${b.user.id}:screen`), `экран Бори у ${u.user.displayName}`, 20000);
    const focused = await js(win, `document.querySelector('.tile[data-key="u${b.user.id}:screen"]').classList.contains('focused')`);
    if (!focused) throw new Error('Экран Бори не развернулся');
  }
  await waitFor(winC, `[...document.querySelectorAll('#room-list .live')].length === 1`, 'значок «в эфире» в списке');
  console.log('✔ экран Бори виден остальным, развёрнут, в списке значок «В ЭФИРЕ»');

  await waitFor(winA, `activeSession().worstQuality()?.rtt != null`, 'качество связи');
  await sleep(1500);
  for (const [win, u] of all) await screenshot(win, `room-${u.user.displayName}`);

  // Вика выходит — у остальных её плитка пропадает
  await js(winC, 'leaveRoomVoice()');
  for (const [win] of [[winA], [winB]])
    await waitFor(win, `activeSession().peers.size === 1 && !document.querySelector('.tile[data-key="u${c.user.id}"]')`, 'Вика вышла');
  console.log('✔ выход участника виден остальным');

  // Боря останавливает показ
  await js(winB, 'toggleScreen()');
  await waitFor(winA, `!document.querySelector('.tile[data-key="u${b.user.id}:screen"]')`, 'демонстрация закончилась');
  console.log('✔ демонстрация останавливается');

  // Пока Боря в комнате, позвонить ему нельзя — он занят
  await js(winA, 'leaveRoomVoice()');
  await js(winA, `selectContact(${b.user.id}).then(() => startCall())`);
  await waitFor(winA, 'state.call === null', 'отказ в звонке занятому');
  console.log('✔ человек в комнате для звонков «занят»');
});
