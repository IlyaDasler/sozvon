// Сквозной тест меню по правой кнопке: человек, своё и чужое сообщение, комната, участник комнаты, поле ввода.
// Буфер обмена здесь подменяет тест: он отвечает на clipboard:write так же, как main.js.
// Запуск (сервер должен работать): npx electron scripts/e2e-menu.js [адрес сервера]
const { ipcMain } = require('electron');
const { ACCEPT_DIALOGS, api, befriend, register, js, waitFor, sleep, openClient, screenshot, runTest } = require('./e2e-lib');

let clipboard = null;
ipcMain.handle('clipboard:write', (_e, text) => (clipboard = text));
ipcMain.on('edit', () => {});

// Правый щелчок по элементу: то самое событие contextmenu, которое ловит приложение
const rightClick = (win, selector) =>
  js(
    win,
    `(() => {
      const el = ${selector};
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10, button: 2 }));
      return true;
    })()`
  );
const items = (win) => js(win, `[...document.querySelectorAll('#popup-menu:not(.hidden) .popup-item')].map((b) => b.textContent)`);
const choose = (win, label) => js(win, `${ACCEPT_DIALOGS} [...document.querySelectorAll('#popup-menu .popup-item')].find((b) => b.textContent === ${JSON.stringify(label)}).click(); true`);
const expectItems = async (win, want, what, absent = []) => {
  const got = await items(win);
  for (const w of want) if (!got.includes(w)) throw new Error(`${what}: нет пункта «${w}» (есть: ${got.join(', ')})`);
  for (const w of absent) if (got.includes(w)) throw new Error(`${what}: лишний пункт «${w}»`);
};

runTest(async () => {
  const a = await register('ma', 'Аня');
  const b = await register('mb', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Двор' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const text = (await api('GET', '/rooms', null, a.token)).find((r) => r.hubId === hub.id && r.kind === 'text');
  await api('POST', `/messages/${a.user.id}`, { text: 'привет от Бори' }, b.token);
  await api('POST', `/messages/${b.user.id}`, { text: 'моё сообщение' }, a.token);

  process.env.E2E_SHOW = '1';
  const winA = await openClient('ma', a);
  delete process.env.E2E_SHOW;
  // Боря в сети — иначе позвонить ему нельзя, и пункта «Позвонить» не будет
  await openClient('mb', b);
  winA.focus();
  await waitFor(winA, `isAvailable(state.contacts.get(${b.user.id}))`, 'Боря в сети');
  await js(winA, `selectContact(${b.user.id})`);
  await waitFor(winA, `document.querySelectorAll('#messages .msg').length === 2`, 'переписка');

  // Человек: аватарка друга в переписке
  await rightClick(winA, `document.querySelector('#messages .msg .avatar[data-profile="${b.user.id}"]')`);
  await expectItems(winA, ['Профиль', 'Написать', 'Позвонить', 'Скопировать логин', 'Удалить из друзей', 'Заблокировать'], 'меню друга', ['Добавить в друзья']);
  await screenshot(winA, 'menu-user');
  await choose(winA, 'Скопировать логин');
  await waitFor(winA, `true`, '');
  await sleep(200);
  if (clipboard !== `@${b.user.username}`) throw new Error(`Скопировалось не то: ${clipboard}`);
  console.log('✔ меню друга: профиль, написать, позвонить, логин копируется, удалить, заблокировать');

  // Своё сообщение: копировать и удалить; чужое — без «Удалить»
  const msgRow = (t) => `[...document.querySelectorAll('#messages .msg')].find((r) => r.textContent.includes(${JSON.stringify(t)}))`;
  await rightClick(winA, `${msgRow('привет от Бори')}.querySelector('.msg-text')`);
  await expectItems(winA, ['Скопировать текст', 'Профиль: Боря'], 'чужое сообщение', ['Удалить сообщение']);
  await rightClick(winA, `${msgRow('моё сообщение')}.querySelector('.msg-text')`);
  await expectItems(winA, ['Скопировать текст', 'Удалить сообщение'], 'своё сообщение');
  await screenshot(winA, 'menu-message');
  await choose(winA, 'Удалить сообщение');
  await waitFor(winA, `!${msgRow('моё сообщение')}`, 'сообщение удалено через меню');
  console.log('✔ меню сообщения: копировать текст и профиль автора; удалить — только своё');

  // Комната в списке: настройки открываются, не заходя в комнату
  await js(winA, `openHub(${hub.id}); true`);
  await waitFor(winA, `Boolean(document.querySelector('[data-room="${text.id}"]'))`, 'комната в списке');
  await rightClick(winA, `document.querySelector('[data-room="${text.id}"]')`);
  await expectItems(winA, ['Открыть', 'Пригласить', 'Настройки комнаты', 'Скопировать название', 'Удалить комнату'], 'меню комнаты');
  await screenshot(winA, 'menu-room');
  await choose(winA, 'Настройки комнаты');
  await waitFor(winA, `!document.getElementById('room-manage').classList.contains('hidden')`, 'настройки комнаты из меню');
  await js(winA, `closeRoomManage(); true`);
  console.log('✔ меню комнаты: открыть, пригласить, настройки, название, удалить');

  // Участник в открытой комнате: создателю — кик на время, исключить, бан
  await js(winA, `selectRoom(${text.id}); true`);
  await waitFor(winA, `Boolean(document.querySelector('#members-panel [data-profile="${b.user.id}"]'))`, 'Боря в списке участников');
  await rightClick(winA, `document.querySelector('#members-panel [data-profile="${b.user.id}"]')`);
  await expectItems(winA, ['Профиль', 'Кикнуть на время…', `Исключить из «${text.name}»`, `Забанить в «${text.name}»`], 'меню участника');
  await screenshot(winA, 'menu-member');
  await choose(winA, 'Кикнуть на время…');
  await waitFor(winA, `!document.getElementById('room-kick').classList.contains('hidden')`, 'окно кика из меню');
  await js(winA, `document.getElementById('kick-cancel').click(); true`);
  console.log('✔ меню участника комнаты: кик на время, исключить, бан — по правам');

  // Поле ввода: без выделения — вставить и выделить всё; с выделением — вырезать и копировать
  await rightClick(winA, `document.getElementById('room-message-input')`);
  await expectItems(winA, ['Вставить', 'Выделить всё'], 'пустое поле', ['Вырезать', 'Копировать']);
  await js(winA, `(() => { const t = document.getElementById('room-message-input'); t.value = 'текст'; t.focus(); t.select(); return true; })()`);
  await rightClick(winA, `document.getElementById('room-message-input')`);
  await expectItems(winA, ['Вырезать', 'Копировать', 'Вставить', 'Выделить всё'], 'поле с выделением');
  await screenshot(winA, 'menu-edit');
  console.log('✔ меню поля ввода: вырезать и копировать — когда есть выделение');
});
