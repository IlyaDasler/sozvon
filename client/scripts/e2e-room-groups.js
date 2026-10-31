// Группы комнат и таймер разговора глазами людей: Аня управляет каналом, Боря — участник.
// Запуск (сервер должен работать): node_modules/electron/dist/electron.exe scripts/e2e-room-groups.js
const fs = require('fs');
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const click = (selector) => `(() => { document.querySelector(${JSON.stringify(selector)}).click(); return true; })()`;
const menuItem = (label) => `(() => { const b = [...document.querySelectorAll('.popup-item')].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) throw new Error('нет пункта ' + ${JSON.stringify(label)} + ': ' + [...document.querySelectorAll('.popup-item')].map((x) => x.textContent)); b.click(); return true; })()`;
const openMenu = (expr) => `(() => { (${expr}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 })); return true; })()`;
const roomRow = (id) => `document.querySelector('#room-list [data-room="${id}"]')`;
const answer = (text) => `(() => { const t = document.querySelector('.edit-card textarea'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()`;

runTest(async () => {
  const a = await register('rga', 'Аня');
  const b = await register('rgb', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Двор' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { name: 'Общак', kind: 'voice', hubId: hub.id }, a.token);
  const winA = await openClient('rga', a);
  const winB = await openClient('rgb', b);
  for (const w of [winA, winB]) await js(w, `openHub(${hub.id}); true`);

  // Создаём группу из меню канала
  await js(winA, click('#hub-menu-btn'));
  await js(winA, menuItem('Создать группу комнат'));
  await waitFor(winA, `Boolean(document.querySelector('.edit-card textarea'))`, 'окно названия', 2000);
  await js(winA, answer('Игровые комнаты'));
  for (const w of [winA, winB]) await waitFor(w, `document.querySelector('.room-group')?.textContent.includes('Игровые комнаты')`, 'группа видна', 4000);
  console.log('✔ группа создана и видна всем');
  if (await js(winB, `Boolean(document.querySelector('.room-group .icon-btn'))`)) throw new Error('Участник видит кнопку создания');
  await js(winB, click('#hub-menu-btn'));
  if (await js(winB, `[...document.querySelectorAll('.popup-item')].some((x) => x.textContent === 'Создать группу комнат')`)) throw new Error('Участнику доступно создание группы');
  await js(winB, 'hideMenu(); true');

  // Переносим комнату в группу
  await js(winA, openMenu(roomRow(room.id)));
  await js(winA, menuItem('В группу «Игровые комнаты»'));
  for (const w of [winA, winB]) await waitFor(w, `${roomRow(room.id)}?.closest('li').dataset.inGroup`, 'комната в группе', 4000);
  console.log('✔ комната перенесена в группу');

  // Плюс на группе создаёт комнату сразу в ней
  await js(winA, click('.room-group .icon-btn'));
  await waitFor(winA, `!document.getElementById('room-create').classList.contains('hidden')`, 'окно комнаты', 2000);
  await js(winA, `document.getElementById('room-name').value = 'Вторая'; document.getElementById('room-create-form').requestSubmit(); true`);
  await waitFor(winB, `[...document.querySelectorAll('#room-list li[data-in-group]')].length === 2`, 'вторая комната в группе', 4000);
  console.log('✔ комната создана сразу в группе');

  // Таймер: идёт у Бори, который не в голосе
  await js(winA, `leaveRoomVoice(); openRoom(${room.id}); true`);
  await waitFor(winB, `Boolean(${roomRow(room.id)}?.querySelector('.voice-timer'))`, 'таймер появился', 10000);
  const first = await js(winB, `${roomRow(room.id)}.querySelector('.voice-timer').textContent`);
  if (!/^\d\d:\d\d$/.test(first)) throw new Error(`Формат таймера: ${first}`);
  await waitFor(winB, `${roomRow(room.id)}.querySelector('.voice-timer').textContent !== ${JSON.stringify(first)}`, 'таймер идёт', 3000);
  console.log('✔ таймер виден и идёт');

  if (process.env.E2E_SHOTS) {
    winB.show();
    winB.setAlwaysOnTop(true, 'screen-saver');
    await sleep(500);
    winB.webContents.invalidate();
    await sleep(300);
    fs.writeFileSync(`${process.env.E2E_SHOTS}/groups.png`, (await winB.webContents.capturePage()).toPNG());
    winB.setAlwaysOnTop(false);
  }

  // Свёрнутая группа: разговор виден, пустая комната спрятана, выбор запоминается
  await js(winB, click('.room-group-title'));
  await waitFor(winB, `document.querySelector('.room-group').classList.contains('closed')`, 'свёрнута', 2000);
  if (!(await js(winB, `Boolean(${roomRow(room.id)})`))) throw new Error('Идущий разговор спрятан');
  if ((await js(winB, `[...document.querySelectorAll('#room-list li[data-in-group]')].length`)) !== 1) throw new Error('Пустая комната не спрятана');
  await js(winB, 'renderRooms(); true');
  if (!(await js(winB, `document.querySelector('.room-group').classList.contains('closed')`))) throw new Error('Свёрнутость не запомнилась');
  await js(winB, click('.room-group-title'));
  console.log('✔ группа сворачивается, разговор остаётся виден');

  // Все вышли — таймера нет
  await js(winA, 'leaveRoomVoice(); true');
  await waitFor(winB, `!${roomRow(room.id)}?.querySelector('.voice-timer')`, 'таймер исчез', 5000);
  console.log('✔ таймер исчезает, когда разговор закончен');

  // Переименование и удаление группы: комнаты остаются
  await js(winA, openMenu(`document.querySelector('.room-group')`));
  await js(winA, menuItem('Переименовать'));
  await waitFor(winA, `Boolean(document.querySelector('.edit-card textarea'))`, 'окно переименования', 2000);
  await js(winA, answer('Новое имя'));
  await waitFor(winB, `document.querySelector('.room-group')?.textContent.includes('Новое имя')`, 'новое имя у Бори', 4000);
  await js(winA, openMenu(`document.querySelector('.room-group')`));
  await js(winA, menuItem('Удалить группу'));
  await waitFor(winA, `!document.getElementById('dialog').classList.contains('hidden')`, 'вопрос', 2000);
  await js(winA, `document.getElementById('dialog-ok').click(); true`);
  await waitFor(winB, `!document.querySelector('.room-group') && Boolean(${roomRow(room.id)}) && ![...document.querySelectorAll('#room-list li[data-in-group]')].length`, 'группа удалена, комнаты на месте', 4000);
  console.log('✔ удаление группы оставляет комнаты в канале');
});
