// Сквозной тест голосовой комнаты: три окна заходят в один канал, включают камеру, показывают экран,
// меняют права ролями, переходят между каналами и банят.
// Запуск (сервер должен работать): npx electron scripts/e2e-room.js [адрес сервера]
const { api, befriend, register, js, waitFor, sleep, openClient, received, tilePlaying, screenshot, runTest } = require('./e2e-lib');

// Видна ли кнопка целиком и не перекрыта ли чем-то
const reachable = (sel) => `(() => {
  const el = ${sel};
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && (hit === el || el.contains(hit));
})()`;

// Щелчок по комнате в списке слева
// Кнопка у комнаты в списке слева — не заходя в комнату
const roomTool = (win, id, kind) =>
  js(
    win,
    `state.view === roomById(${id}).hubId || openHub(roomById(${id}).hubId); [...document.querySelectorAll('#room-list .room-row')].find((r) => r.querySelector('.name').textContent === roomById(${id}).name).querySelector('.room-tool.${kind}').click(); true`
  );
const memberButton = (win, name, label) =>
  js(
    win,
    `window.confirm = () => true; [...[...document.querySelectorAll('#rm-members .member-row')].find((r) => r.textContent.includes(${JSON.stringify(name)})).querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(label)}).click(); true`
  );

const clickRoom = (win, id) =>
  js(
    win,
    `state.view === roomById(${id}).hubId || openHub(roomById(${id}).hubId); [...document.querySelectorAll('#room-list .room-row')].find((r) => r.querySelector('.name').textContent === roomById(${id}).name).click(); true`
  );

runTest(async () => {
  const a = await register('ra', 'Аня');
  const b = await register('rb', 'Боря');
  const c = await register('rc', 'Вика');
  await befriend(a, b);
  await befriend(a, c);

  const winA = await openClient('ra', a);
  const winB = await openClient('rb', b);
  const winC = await openClient('rc', c);
  const all = [[winA, a], [winB, b], [winC, c]];
  console.log('✔ три клиента вошли');

  // Комнаты живут в каналах: Аня собирает канал, друзья вступают (подробно — в e2e-hubs.js)
  const hub = await api('POST', '/hubs', { name: 'Клуб' }, a.token);
  for (const u of [b, c]) {
    await api('POST', `/hubs/${hub.id}/invites`, { userIds: [u.user.id] }, a.token);
    await api('POST', `/hub-invites/${hub.id}/accept`, null, u.token);
  }
  for (const [win] of all) await waitFor(win, `state.hubs.get(${hub.id})?.members.length === 3`, 'канал у всех');

  // Аня создаёт комнату через окно создания — в комнате сразу все участники канала
  await js(winA, `openHub(${hub.id}); openRoomCreate('voice')`);
  await js(winA, `
    document.getElementById('room-name').value = 'Вечерние катки';
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

  // Все трое заходят в голос — одним щелчком по комнате в списке
  for (const [win] of all) await clickRoom(win, roomId);
  for (const [win, u] of all) {
    await waitFor(
      win,
      `state.room?.joined && activeSession().peers.size === 2 && [...activeSession().peers.values()].every((p) => p.state === 'connected')`,
      `${u.user.displayName}: соединение с двумя участниками`,
      20000
    );
  }
  console.log('✔ щелчок по комнате подключает к голосу, каждый соединён с каждым');

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

  // Боря показывает экран через окно выбора: вкладки «Весь экран» и «Окно приложения»
  await js(winB, `store.set('screenTab', 'screen'); toggleScreen()`);
  await waitFor(winB, `document.querySelectorAll('#screen-sources .source.selected').length === 1`, 'выбор экрана');
  await js(winB, `document.querySelector('#screen-tabs [data-tab="window"]').click(); true`);
  await waitFor(winB, `document.querySelector('#screen-tabs [data-tab="window"]').classList.contains('active') && document.querySelectorAll('#screen-sources .source').length > 0`, 'вкладка с окнами приложений');
  await js(winB, `document.querySelector('#screen-tabs [data-tab="screen"]').click(); true`);
  await waitFor(winB, `document.querySelectorAll('#screen-sources .source.selected').length === 1 && !document.getElementById('screen-start').disabled`, 'экран снова выбран');
  console.log('✔ в окне выбора есть вкладки «Весь экран» и «Окно приложения»');
  await js(winB, `document.getElementById('screen-start').click(); true`);
  await waitFor(winB, `Boolean(activeSession().local.tracks.screen)`, 'демонстрация у Бори');
  // Режим «плавно»: 720p, 60 кадров/с, до 5 Мбит/с
  await waitFor(
    winB,
    `(() => {
      const c = activeSession().local.tracks.screen.getConstraints();
      const p = [...activeSession().peers.values()][0].link.transceiver('screen').sender.getParameters().encodings[0];
      return c.frameRate?.ideal === 60 && c.height?.max === 720 && p.maxFramerate === 60 && p.maxBitrate === 5000000;
    })()`,
    'настройки качества 720p60'
  );
  console.log('✔ демонстрация в режиме 720p, 60 кадров/с');
  for (const [win, u] of [[winA, a], [winC, c]]) {
    await waitFor(win, tilePlaying(win, `u${b.user.id}:screen`), `экран Бори у ${u.user.displayName}`, 20000);
    const focused = await js(win, `document.querySelector('.tile[data-key="u${b.user.id}:screen"]').classList.contains('focused')`);
    if (!focused) throw new Error('Экран Бори не развернулся');
  }
  await waitFor(winC, `[...document.querySelectorAll('#room-list .live')].length === 1`, 'значок «в эфире» в списке');
  console.log('✔ экран Бори виден остальным, развёрнут, в списке значок «В ЭФИРЕ»');

  // Кнопка «во весь экран» видна и не перекрыта, нажатие разворачивает трансляцию
  const fullBtn = `document.querySelector('.tile[data-key="u${b.user.id}:screen"] .tile-btn')`;
  if (!(await js(winA, reachable(fullBtn)))) throw new Error('Кнопка «во весь экран» перекрыта или вне экрана');
  // E2E_SKIP_FULLSCREEN=1 — на машинах, где Windows не даёт окну полноэкранный режим (document.fullscreenElement пуст)
  if (process.env.E2E_SKIP_FULLSCREEN === '1') console.log('  (пропущено: трансляция во весь экран — E2E_SKIP_FULLSCREEN)');
  else {
    await winA.webContents.executeJavaScript(`${fullBtn}.click()`, true);
    const inFull = `(() => {
      const v = document.getElementById('fullview-video');
      const r = v.getBoundingClientRect();
      return document.fullscreenElement?.id === 'fullview' && fullView === 'u${b.user.id}:screen' &&
        v.videoWidth > 0 && !v.paused && r.width === innerWidth && r.height === innerHeight;
    })()`;
    await waitFor(winA, inFull, 'трансляция во весь экран');
    await sleep(800);
    if (!(await js(winA, inFull))) throw new Error('Полноэкранный режим сам выключился');
    if (!winA.isFullScreen()) throw new Error('Окно приложения не ушло в полноэкранный режим');
    await screenshot(winA, 'room-fullview');
    // Выход — кнопкой на панели
    await js(winA, `document.getElementById('fullview-exit').click(); true`);
    await waitFor(winA, `!document.fullscreenElement && fullView === null && document.getElementById('fullview').classList.contains('hidden')`, 'выход из полноэкранного режима');
    console.log('✔ трансляция открывается на весь монитор и закрывается кнопкой');
  }

  // Маленькое окно: кнопки разговора видны и не перекрыты плитками
  winA.setSize(820, 540);
  await sleep(600);
  for (const id of ['call-mute', 'call-deafen', 'call-ns', 'call-cam', 'call-screen', 'hangup-btn'])
    if (!(await js(winA, reachable(`document.getElementById('${id}')`)))) throw new Error(`В маленьком окне кнопка ${id} перекрыта`);
  if (!(await js(winA, reachable(fullBtn)))) throw new Error('В маленьком окне кнопка «во весь экран» перекрыта');
  await screenshot(winA, 'room-small');
  winA.setSize(1100, 720);
  console.log('✔ в маленьком окне кнопки разговора доступны');

  await waitFor(winA, `activeSession().worstQuality()?.rtt != null`, 'качество связи');
  await sleep(1500);
  for (const [win, u] of all) await screenshot(win, `room-${u.user.displayName}`);

  // Шумоподавление переключается сразу, прямо в разговоре
  await js(winC, `document.getElementById('call-ns').click(); true`);
  await waitFor(winC, `state.settings.noiseSuppression === false && activeSession().local.tracks.mic.getSettings().noiseSuppression === false`, 'шумоподавление выключено');
  await js(winC, `document.getElementById('call-ns').click(); true`);
  await waitFor(winC, `activeSession().local.tracks.mic.getSettings().noiseSuppression === true`, 'шумоподавление включено');
  console.log('✔ шумоподавление включается и выключается на ходу');

  // Права: всем без роли запрещаем говорить — Вику не слышно, у неё самой микрофон выключен
  const micOf = (id) => `activeSession().peers.get(${id}).audio.mic`;
  await js(winA, `Api.patch('/rooms/${roomId}', { defaultPerms: 1 | 4 | 8 | 16 }).then(() => true)`);
  await waitFor(winA, `${micOf(c.user.id)}.muted === true`, 'Вику не слышно у Ани');
  await waitFor(winC, `document.getElementById('call-mute').classList.contains('off') && activeSession().local.tracks.mic.enabled === false`, 'микрофон Вики выключен правами');
  // Роль «Голос» возвращает Вике право говорить
  await js(winA, `Api.post('/rooms/${roomId}/roles', { name: 'Голос', color: '#30a46c', perms: 1 | 2 | 4 | 8 }).then((r) => { state.rooms.set(r.id, r); return true; })`);
  await js(winA, `Api.put('/rooms/${roomId}/members/${c.user.id}/role', { roleId: roomById(${roomId}).roles.find((r) => r.name === 'Голос').id }).then(() => true)`);
  await waitFor(winA, `${micOf(c.user.id)}.muted === false`, 'Вику снова слышно');
  await waitFor(winC, `!document.getElementById('call-mute').classList.contains('off') && activeSession().local.tracks.mic.enabled`, 'микрофон Вики включён');
  await js(winA, `Api.patch('/rooms/${roomId}', { defaultPerms: 31 }).then(() => true)`);
  console.log('✔ права ролей: без права говорить человека не слышно, роль возвращает голос');

  // Настройки комнаты открываются шестерёнкой в списке, не заходя в комнату (открыта другая комната канала)
  await js(winA, `openHub(${hub.id}); selectRoom([...state.rooms.values()].find((r) => r.hubId === ${hub.id} && r.kind === 'text').id)`);
  await roomTool(winA, roomId, 'settings');
  await waitFor(winA, `!document.getElementById('room-manage').classList.contains('hidden') && document.getElementById('rs-room-name').textContent === roomById(${roomId}).name`, 'настройки комнаты');
  if (await js(winA, `state.selectedRoomId === ${roomId}`)) throw new Error('Шестерёнка открыла саму комнату');
  await js(winA, `document.querySelector('#rs-nav [data-tab="roles"]').click(); true`);
  await waitFor(winA, `document.querySelectorAll('#rs-body .rs-role-item').length === 3 && Boolean(document.querySelector('#rm-role-editor .switch'))`, 'роли и переключатели прав');
  // Роль «Голос»: переключатели показывают её права, назначить можно прямо отсюда
  await js(winA, `[...document.querySelectorAll('#rs-body .rs-role-item')].find((b) => b.textContent.includes('Голос')).click(); true`);
  await waitFor(winA, `document.querySelector('#rm-role-editor [data-perm="speak"]')?.checked === true && document.querySelector('#rm-role-editor [data-perm="kick"]')?.checked === false`, 'права роли «Голос»');
  await screenshot(winA, 'room-roles');
  await js(winA, `document.querySelector('#rs-nav [data-tab="members"]').click(); true`);
  await waitFor(winA, `document.querySelectorAll('#rm-members .member-row').length === 3`, 'участники');
  await screenshot(winA, 'room-members');
  await js(winA, `document.getElementById('rm-close').click(); true`);

  // Приглашение — тоже из списка: друзья, кто уже в комнате, отмечены
  await roomTool(winA, roomId, 'invite');
  await waitFor(winA, `!document.getElementById('room-invite').classList.contains('hidden') && document.getElementById('ri-list').textContent.includes('Уже в комнате')`, 'окно приглашения');
  await screenshot(winA, 'room-invite');
  await js(winA, `document.getElementById('ri-close').click(); true`);
  await js(winA, `selectRoom(${roomId}); true`);
  console.log('✔ настройки и приглашение открываются кнопками у комнаты, роли с переключателями прав');

  // Второй голосовой канал: Боря переходит туда одним щелчком и так же возвращается
  const second = await js(
    winA,
    `Api.post('/rooms', { hubId: ${hub.id}, name: 'Второй', kind: 'voice' }).then((r) => { state.rooms.set(r.id, r); renderRooms(); return r.id; })`
  );
  await waitFor(winB, `state.rooms.has(${second})`, 'второй канал у Бори');
  await clickRoom(winB, second);
  await waitFor(winB, `state.room?.roomId === ${second} && state.room.joined`, 'Боря во втором канале');
  await waitFor(winA, `activeSession().peers.size === 1`, 'Боря ушёл из первого канала');
  await clickRoom(winB, roomId);
  await waitFor(winB, `state.room?.roomId === ${roomId} && activeSession().peers.size === 2`, 'Боря вернулся', 20000);
  console.log('✔ переход между голосовыми каналами одним щелчком');

  // Проверка звука: «Слушать себя» выводит микрофон в наушники
  await js(winB, 'openSettings()');
  await js(winB, `document.getElementById('mic-monitor-btn').click(); true`);
  await waitFor(winB, `micMonitor !== null && document.getElementById('mic-monitor-btn').textContent === 'Перестать слушать'`, 'прослушка микрофона');
  await js(winB, 'closeSettings()');
  await waitFor(winB, 'micMonitor === null', 'прослушка выключилась вместе с настройками');
  console.log('✔ «Слушать себя» работает');

  // Кик на время: Вика остаётся в комнате, но только читает; кик снимают — права роли возвращаются
  await js(winA, `openRoomManage(${roomId}, 'members'); true`);
  await memberButton(winA, 'Вика', 'Кик');
  await waitFor(winA, `!document.getElementById('room-kick').classList.contains('hidden') && document.querySelectorAll('#kick-options input').length === 6`, 'выбор времени кика');
  await js(winA, `document.querySelector('#kick-options input[value="60"]').click(); document.getElementById('kick-form').requestSubmit(); true`);
  await waitFor(winC, `state.room === null && timeoutOf(roomById(${roomId})) > Date.now()`, 'Вику кикнули и отключили от голоса');
  await js(winC, `selectRoom(${roomId}); true`);
  await waitFor(winC, `document.getElementById('room-message-input').disabled && document.getElementById('room-message-input').placeholder.startsWith('Вас кикнули до')`, 'Вика только читает');
  await waitFor(winA, `[...document.querySelectorAll('#rm-members .member-row')].find((r) => r.textContent.includes('Вика'))?.querySelector('.tag.kicked')`, 'отметка кика в списке');
  await screenshot(winA, 'room-kick');
  await screenshot(winC, 'room-kicked');
  await memberButton(winA, 'Вика', 'Снять кик');
  await waitFor(winC, `!document.getElementById('room-message-input').disabled && can(roomById(${roomId}), PERMS.write)`, 'Вика снова пишет');
  await js(winA, `document.getElementById('rm-close').click(); true`);
  await js(winC, `openRoom(${roomId}); true`);
  await waitFor(winC, `state.room?.roomId === ${roomId} && state.room.joined`, 'Вика вернулась в голос');
  console.log('✔ кик на время: только чтение и без голоса, после снятия права роли вернулись');

  // Вика выходит — у остальных её плитка пропадает
  await js(winC, 'leaveRoomVoice()');
  for (const [win] of [[winA], [winB]])
    await waitFor(win, `activeSession().peers.size === 1 && !document.querySelector('.tile[data-key="u${c.user.id}"]')`, 'Вика вышла');
  console.log('✔ выход участника виден остальным');

  // Пока Боря в комнате, позвонить ему нельзя — он занят
  await js(winA, 'leaveRoomVoice()');
  await js(winA, `selectContact(${b.user.id}).then(() => startCall())`);
  await waitFor(winA, 'state.call === null', 'отказ в звонке занятому');
  console.log('✔ человек в комнате для звонков «занят»');

  // Бан из окна управления: Боря пропадает из комнаты и из голоса
  await js(winA, `selectRoom(${roomId}); openRoomManage(${roomId}, 'members'); true`);
  await memberButton(winA, 'Боря', 'Бан');
  await waitFor(winB, `!state.rooms.has(${roomId}) && state.room === null`, 'Боря забанен и отключён');
  await waitFor(winA, `roomById(${roomId}).bans.length === 1 && document.getElementById('rm-ban-count').textContent === '1'`, 'бан в списке');
  console.log('✔ бан убирает человека из комнаты и из голоса');
});
