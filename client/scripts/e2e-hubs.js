// Сквозной тест каналов: собрать канал, позвать друга, он вступает и видит комнаты, новая комната — у обоих,
// группа из двух каналов перетаскиванием (раскладка у каждого своя), список участников и его скрытие,
// вид во всех темах и в узком окне.
// Запуск (сервер должен работать): npx electron scripts/e2e-hubs.js [адрес сервера]
const { ACCEPT_DIALOGS, api, befriend, register, js, waitFor, sleep, openClient, screenshot, runTest } = require('./e2e-lib');

const THEMES = ['sozvon', 'midnight', 'light', 'forest', 'dusk'];

// Перетаскивание в столбце каналов — теми же событиями, что шлёт браузер.
// where: 'center' — на середину цели, 'before' — в её верхнюю часть, 'end' — в пустое место столбца
const drag = (win, srcSel, dstSel, where = 'center') =>
  js(
    win,
    `(() => {
      const src = document.querySelector(${JSON.stringify(srcSel)});
      const dst = ${dstSel ? `document.querySelector(${JSON.stringify(dstSel)})` : `document.getElementById('rail-list')`};
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const r = dst.getBoundingClientRect();
      const y = ${JSON.stringify(where)} === 'before' ? r.top + 2 : ${JSON.stringify(where)} === 'end' ? r.bottom - 2 : r.top + r.height / 2;
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: y };
      dst.dispatchEvent(new DragEvent('dragover', opts));
      dst.dispatchEvent(new DragEvent('drop', opts));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return true;
    })()`
  );

const tile = (hubId) => `#rail-list [data-hub="${hubId}"] .rail-tile`;
const layoutOf = (win) => js(win, `JSON.parse(localStorage.getItem('rail:' + state.me.id))`);
const sectionRooms = (win) =>
  js(win, `[...document.querySelectorAll('#room-list .room-row .name')].map((n) => n.textContent)`);

runTest(async () => {
  const a = await register('ha', 'Илья');
  const b = await register('hb', 'Вася');
  await befriend(a, b);
  const winA = await openClient('ha', a);
  const winB = await openClient('hb', b);
  console.log('✔ два клиента вошли');

  // Илья собирает канал через «+» внизу столбца
  await js(winA, `document.getElementById('rail-add').click(); true`);
  await waitFor(winA, `!document.getElementById('hub-create').classList.contains('hidden')`, 'окно «Создать канал»');
  await js(winA, `document.getElementById('hub-name').value = 'Наш двор'; document.getElementById('hub-create-submit').click(); true`);
  await waitFor(winA, `state.view !== 'home' && document.getElementById('hub-menu-name').textContent === 'Наш двор'`, 'канал открылась');
  const hubId = await js(winA, 'state.view');
  await waitFor(winA, `document.querySelector('${tile(hubId)}')?.textContent === 'НД'`, 'иконка канала в столбце');
  await waitFor(winA, `document.querySelectorAll('#room-list .room-row').length === 2`, 'две комнаты в канале');
  if (!(await js(winA, `document.getElementById('room-title').textContent === 'Общий чат'`))) throw new Error('Открылась не текстовая комната');
  if (await js(winA, `document.getElementById('members-panel').classList.contains('hidden')`)) throw new Error('Список участников не виден');
  await screenshot(winA, 'hubs-created');
  console.log('✔ канал создан: в столбце, в шапке, с двумя комнатами и списком участников');

  // Зовёт Васю через меню канала
  await js(winA, `document.getElementById('hub-menu-btn').click(); true`);
  await js(winA, `[...document.querySelectorAll('#popup-menu .popup-item')].find((b) => b.textContent === 'Пригласить друзей').click(); true`);
  await waitFor(winA, `!document.getElementById('hub-invite').classList.contains('hidden')`, 'окно «Пригласить друзей»');
  await js(winA, `[...document.querySelectorAll('#hi-list .member-row')].find((r) => r.textContent.includes('Вася')).querySelector('button').click(); true`);
  await waitFor(winA, `[...document.querySelectorAll('#hi-list .member-row')].some((r) => r.textContent.includes('Позвали'))`, 'отметка «Позвали»');
  await js(winA, `document.getElementById('hi-close').click(); true`);

  // У Васи — приглашение в столбце; вступает
  await waitFor(winB, `document.querySelector('#rail-list .rail-item.invite')`, 'приглашение у Васи');
  await screenshot(winB, 'hubs-invite');
  await js(winB, `document.querySelector('#rail-list .rail-item.invite .rail-tile').click(); true`);
  await waitFor(winB, `!document.getElementById('hub-join').classList.contains('hidden')`, 'окно приглашения');
  await js(winB, `document.getElementById('hj-accept').click(); true`);
  await waitFor(winB, `state.view === ${hubId} && document.querySelectorAll('#room-list .room-row').length === 2`, 'Вася в канале и видит комнаты');
  await waitFor(winA, `document.querySelectorAll('#members-list .member-item').length === 2`, 'Вася в списке участников у Ильи');
  console.log('✔ друг позван, вступил и видит комнаты');

  // Новая комната — сразу у обоих, в своём разделе
  await js(winA, `document.querySelector('#room-list [data-section="text"] .icon-btn').click(); true`);
  await js(winA, `document.getElementById('room-name').value = 'Мемы'; document.getElementById('room-create-submit').click(); true`);
  await waitFor(winB, `[...document.querySelectorAll('#room-list .room-row .name')].some((n) => n.textContent === 'Мемы')`, 'новая комната у Васи');
  const names = await sectionRooms(winB);
  if (names.join() !== 'Голосовая,Мемы,Общий чат') throw new Error(`Комнаты не по разделам: ${names}`);
  // Переписка в комнате канала
  const memes = await js(winA, `[...state.rooms.values()].find((r) => r.name === 'Мемы').id`);
  await api('POST', `/rooms/${memes}/messages`, { text: 'Свежий мем' }, b.token);
  await waitFor(winA, `[...document.querySelectorAll('#room-messages .msg-text')].some((el) => el.textContent === 'Свежий мем')`, 'сообщение в комнате канала');
  console.log('✔ новая комната у обоих, переписка работает');

  // Колокольчик: открыл комнату — её уведомления прочитаны; уведомления без места («вас убрали») — когда вернулся в окно
  const badge = `document.getElementById('notif-badge')`;
  await js(winA, `selectContact(null); localStorage.removeItem('notifications:' + state.me.id); renderNotifBadge(); true`);
  await api('POST', `/rooms/${memes}/messages`, { text: 'Мем для колокольчика' }, b.token);
  await waitFor(winA, `${badge}.textContent === '1' && !${badge}.classList.contains('hidden')`, 'уведомление о сообщении в комнате');
  await js(winA, `selectRoom(${memes}); true`);
  await waitFor(winA, `${badge}.classList.contains('hidden')`, 'открыл комнату — уведомление прочитано');
  await js(winA, `notify('Канал', 'Вас убрали из канала', { kind: 'hub-removed' }); true`);
  await waitFor(winA, `!${badge}.classList.contains('hidden')`, 'уведомление без места');
  await js(winA, `window.dispatchEvent(new Event('focus')); true`);
  await waitFor(winA, `${badge}.classList.contains('hidden')`, 'вернулся в окно — прочитано');
  console.log('✔ колокольчик гаснет: комната открыта, уведомление без места — при возврате в окно');

  // Аня переименовалась в настройках — новое имя сразу везде: у неё и у Васи, в сообщениях комнаты и в участниках
  await api('POST', `/rooms/${memes}/messages`, { text: 'Пишу до переименования' }, a.token);
  await js(winB, `selectRoom(${memes}); true`);
  await js(winA, `(async () => { state.me = await Api.patch('/me', { displayName: 'Аня Новая' }); renderMe(); renderMessages(); renderVoice(); return true; })()`);
  const named = `(() => {
    const authors = [...document.querySelectorAll('#room-messages .msg [data-profile="${a.user.id}"]:not(.avatar)')].map((el) => el.textContent);
    const member = [...document.querySelectorAll('#members-list [data-profile="${a.user.id}"]')].map((el) => el.textContent).join(' ');
    return authors.length > 0 && authors.every((t) => t.includes('Аня Новая')) && member.includes('Аня Новая');
  })()`;
  for (const [win, who] of [[winA, 'у самой Ани'], [winB, 'у Васи']]) await waitFor(win, named, `новое имя ${who}`);
  console.log('✔ переименовалась — новое имя сразу в сообщениях и участниках, у себя и у других');

  // Цвет ника: выбрала в настройках — у Васи её имя этим цветом в сообщениях комнаты и в участниках
  await js(winA, `openSettings('profile'); document.querySelector('#name-picker [data-color="#f76b15"]').click(); document.querySelector('#settings-form .set-foot .btn.primary').click(); true`);
  await waitFor(
    winB,
    `(() => {
      const orange = 'rgb(247, 107, 21)';
      const names = [...document.querySelectorAll('#room-messages .msg [data-profile="${a.user.id}"]:not(.avatar), #members-list .member-nick')].filter((el) => el.textContent.includes('Аня Новая'));
      return names.length >= 2 && names.every((el) => getComputedStyle(el).color === orange);
    })()`,
    'цвет ника у Васи'
  );
  console.log('✔ цвет ника виден другим в сообщениях и участниках');

  // Свой фон: Аня ставит картинку в настройках комнаты — фон виден и у неё, и у Васи; убирается
  await js(winA, `openRoomManage(${memes}); true`);
  await waitFor(winA, `Boolean(document.getElementById('rm-bg-pick'))`, 'кнопка выбора фона');
  await js(
    winA,
    `(async () => {
      const c = document.createElement('canvas'); c.width = 2400; c.height = 1350;
      const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, 2400, 1350); grad.addColorStop(0, '#ff6a00'); grad.addColorStop(1, '#5b2bd6'); g.fillStyle = grad; g.fillRect(0, 0, 2400, 1350);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      await uploadRoomBackground(roomById(${memes}), new File([blob], 'фон.png', { type: 'image/png' }));
      return true;
    })()`
  );
  await js(winB, `selectRoom(${memes})`);
  for (const win of [winA, winB])
    await waitFor(win, `document.getElementById('room-view').classList.contains('has-bg') && getComputedStyle(document.getElementById('room-view')).backgroundImage.includes('/api/avatars/')`, 'фон комнаты');
  await js(winA, `document.getElementById('rm-bg-remove').click(); true`);
  await waitFor(winB, `!document.getElementById('room-view').classList.contains('has-bg')`, 'фон убран у Васи');
  await js(winA, `closeRoomManage(); true`);
  console.log('✔ свой фон комнаты: ставится картинкой, виден всем, убирается');

  // Второй канал; Вася тоже в нём
  const second = await api('POST', '/hubs', { name: 'Гаражи', iconColor: '#30a46c' }, a.token);
  await api('POST', `/hubs/${second.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${second.id}/accept`, null, b.token);
  for (const win of [winA, winB]) await waitFor(win, `document.querySelector('${tile(second.id)}')`, 'вторая канал в столбце');

  // Илья перетаскивает «Гаражи» на «Наш двор» — получается группа
  await drag(winA, `#rail-list [data-hub="${second.id}"]`, tile(hubId));
  await waitFor(winA, `document.querySelectorAll('#rail-list .rail-folder [data-hub]').length === 2`, 'группа из двух каналов');
  let layoutA = await layoutOf(winA);
  if (!layoutA.items[0].folder || layoutA.items[0].hubs.join() !== `${hubId},${second.id}`) throw new Error(`Раскладка Ильи: ${JSON.stringify(layoutA)}`);
  // У Васи раскладка своя: никакой группы
  await sleep(500);
  if (await js(winB, `document.querySelector('#rail-list .rail-folder')`)) throw new Error('Группа Ильи появилась у Васи');
  // Вася ставит «Гаражи» первыми — у Ильи от этого ничего не меняется
  await drag(winB, `#rail-list [data-hub="${second.id}"]`, tile(hubId), 'before');
  await waitFor(winB, `JSON.parse(localStorage.getItem('rail:' + state.me.id)).items.join() === '${second.id},${hubId}'`, 'новый порядок у Васи');
  if (JSON.stringify(await layoutOf(winA)) !== JSON.stringify(layoutA)) throw new Error('Порядок Васи изменил раскладку Ильи');
  console.log('✔ группа перетаскиванием; раскладка у каждого своя');

  // Группу называем и сворачиваем
  const folderId = layoutA.items[0].folder;
  await js(winA, `${ACCEPT_DIALOGS} document.querySelector('[data-folder="${folderId}"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 120 })); true`);
  await js(winA, `[...document.querySelectorAll('#popup-menu .popup-item')].find((b) => b.textContent.startsWith('Название')).click(); true`);
  await js(winA, `document.getElementById('folder-name').value = 'Свои'; document.getElementById('folder-form').requestSubmit(); true`);
  await js(winA, `document.querySelector('[data-folder="${folderId}"] .rail-tile').click(); true`);
  await waitFor(winA, `document.querySelectorAll('[data-folder="${folderId}"] .mini').length === 2`, 'свёрнутая группа с мозаикой');
  layoutA = await layoutOf(winA);
  if (layoutA.items[0].name !== 'Свои' || !layoutA.items[0].collapsed) throw new Error(`Группа не сохранилась: ${JSON.stringify(layoutA)}`);
  await screenshot(winA, 'hubs-folder-collapsed');
  // Разворачиваем и вытаскиваем «Гаражи» обратно в конец — группа распадается
  await js(winA, `document.querySelector('[data-folder="${folderId}"] .rail-tile').click(); true`);
  await drag(winA, `#rail-list [data-hub="${second.id}"]`, null, 'end');
  await waitFor(winA, `!document.querySelector('#rail-list .rail-folder')`, 'группа распалась');
  layoutA = await layoutOf(winA);
  if (layoutA.items.join() !== `${hubId},${second.id}`) throw new Error(`После вытаскивания: ${JSON.stringify(layoutA)}`);
  console.log('✔ группу назвали, свернули, канал вытащили обратно');

  // Битая раскладка в хранилище не ломает столбец
  await js(winA, `localStorage.setItem('rail:' + state.me.id, '{"items":[null,"x",{"folder":5},[1],${second.id},${second.id}]}'); renderRail(); true`);
  await waitFor(winA, `document.querySelectorAll('#rail-list [data-hub]').length === 2`, 'столбец после битой раскладки');
  console.log('✔ битая раскладка починилась');

  // Список участников: скрыть и показать, состояние запоминается
  await js(winA, `openHub(${hubId}); true`);
  await js(winA, `document.querySelector('#room-view .members-toggle').click(); true`);
  await waitFor(winA, `document.getElementById('members-panel').classList.contains('hidden')`, 'список участников скрыт');
  await js(winA, `location.reload()`);
  await sleep(500);
  await waitFor(winA, `document.getElementById('conn-dot').classList.contains('ok') && state.hubsLoaded`, 'перезапуск');
  await js(winA, `openHub(${hubId}); true`);
  await sleep(300);
  if (!(await js(winA, `document.getElementById('members-panel').classList.contains('hidden')`))) throw new Error('Скрытие списка не запомнилось');
  await js(winA, `document.querySelector('#room-view .members-toggle').click(); true`);
  await waitFor(winA, `!document.getElementById('members-panel').classList.contains('hidden')`, 'список участников снова виден');
  // Участники — по «В сети» и с карточкой профиля по щелчку
  await waitFor(winA, `[...document.querySelectorAll('#members-list .members-group')].some((g) => g.textContent.startsWith('В сети — 2'))`, 'группа «В сети — 2»');
  await js(winA, `[...document.querySelectorAll('#members-list .member-item')].find((r) => r.textContent.includes('Вася')).click(); true`);
  await waitFor(winA, `!document.getElementById('profile-card').classList.contains('hidden')`, 'карточка профиля из списка участников');
  console.log('✔ список участников: скрытие запоминается, группы и карточка профиля');

  // Вася закрыл приложение — у Ильи он «Не в сети»
  winB.destroy();
  await waitFor(winA, `[...document.querySelectorAll('#members-list .members-group')].some((g) => g.textContent.startsWith('Не в сети — 1'))`, 'Вася не в сети');

  // Снимки окон канала (для глаз; на проверку не влияют)
  const escape = () => js(winA, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
  winA.focus();
  await js(winA, `openHubSettings(${hubId}, 'members'); true`);
  await screenshot(winA, 'hubs-settings-members');
  await js(winA, `openHubSettings(${hubId}, 'overview'); true`);
  await screenshot(winA, 'hubs-settings-overview');
  await escape();
  await js(winA, `openHubCreate(); true`);
  await screenshot(winA, 'hubs-create-modal');
  await escape();
  await js(winA, `document.getElementById('hub-menu-btn').click(); true`);
  await screenshot(winA, 'hubs-menu');
  await escape();
  await js(winA, `selectContact(null); true`);
  await sleep(200);
  await screenshot(winA, 'hubs-home');
  await js(winA, `openHub(${hubId}); true`);

  // Вид во всех темах и в узком окне
  await escape();
  for (const theme of THEMES) {
    await js(winA, `document.documentElement.dataset.theme = '${theme}'; true`);
    await sleep(150);
    await screenshot(winA, `hubs-theme-${theme}`);
  }
  winA.setSize(840, 560);
  await sleep(400);
  const fits = await js(winA, `(() => {
    const r = document.getElementById('room-message-input').getBoundingClientRect();
    return r.width > 120 && r.right <= innerWidth && document.getElementById('rail').getBoundingClientRect().width > 0;
  })()`);
  if (!fits) throw new Error('В узком окне поле ввода не помещается');
  await screenshot(winA, 'hubs-narrow');
  await js(winA, `document.documentElement.dataset.theme = 'sozvon'; true`);
  console.log('✔ темы и узкое окно');

  // Удаление канала создателем: пропадает из столбца
  await js(winA, `${ACCEPT_DIALOGS} deleteHub(hubById(${second.id})); true`);
  await waitFor(winA, `!document.querySelector('${tile(second.id)}')`, 'удалённый канал пропал');
  console.log('✔ удалённый канал пропал из столбца');
});
