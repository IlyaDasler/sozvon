// Группы комнат и таймер разговора глазами людей: Аня управляет каналом, Боря — участник.
// Группа собирается перетаскиванием комнаты на комнату: отдельного пункта меню больше нет.
// Запуск (сервер должен работать): node_modules/electron/dist/electron.exe scripts/e2e-room-groups.js
const fs = require('fs');
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const click = (selector) => `(() => { document.querySelector(${JSON.stringify(selector)}).click(); return true; })()`;
const menuItem = (label) => `(() => { const b = [...document.querySelectorAll('.popup-item')].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) throw new Error('нет пункта ' + ${JSON.stringify(label)} + ': ' + [...document.querySelectorAll('.popup-item')].map((x) => x.textContent)); b.click(); return true; })()`;
const openMenu = (expr) => `(() => { (${expr}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 })); return true; })()`;
const roomRow = (id) => `document.querySelector('#room-list [data-room="${id}"]')`;
const answer = (text) => `(() => { const i = document.querySelector('.ask-text-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()`;

/** Перетаскивание комнаты на комнату так, как это делает человек */
const dragRoom = (fromId, toId) => `(() => {
  const from = document.querySelector('#room-list [data-room="${fromId}"]').closest('li');
  const to = document.querySelector('#room-list [data-room="${toId}"]').closest('li');
  const dt = new DataTransfer();
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  const r = to.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 10, clientY: r.top + r.height * 0.5 };
  to.dispatchEvent(new DragEvent('dragover', at));
  to.dispatchEvent(new DragEvent('drop', at));
  return true;
})()`;

runTest(async () => {
  const a = await register('rga', 'Аня');
  const b = await register('rgb', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Двор' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { name: 'Общак', kind: 'voice', hubId: hub.id }, a.token);
  const room2 = await api('POST', '/rooms', { name: 'Вторая', kind: 'voice', hubId: hub.id }, a.token);
  const room3 = await api('POST', '/rooms', { name: 'Третья', kind: 'voice', hubId: hub.id }, a.token);
  const winA = await openClient('rga', a);
  const winB = await openClient('rgb', b);
  for (const w of [winA, winB]) await js(w, `openHub(${hub.id}); true`);
  for (const id of [room.id, room2.id, room3.id]) await waitFor(winA, `Boolean(${roomRow(id)})`, 'комнаты на месте', 4000);

  // Отдельного пункта «Создать группу комнат» больше нет — ни у кого
  for (const [w, who] of [[winA, 'Управляющий'], [winB, 'Участник']]) {
    await js(w, click('#hub-menu-btn'));
    if (await js(w, `[...document.querySelectorAll('.popup-item')].some((x) => x.textContent === 'Создать группу комнат')`))
      throw new Error(`${who}: в меню остался пункт «Создать группу комнат»`);
    await js(w, 'hideMenu(); true');
  }
  console.log('✔ пункта «Создать группу комнат» в меню нет');

  // Бросаем комнату на комнату — появляется группа с названием
  await js(winA, dragRoom(room3.id, room2.id));
  await waitFor(winA, `Boolean(document.querySelector('.ask-text-input'))`, 'окно названия группы', 2000);
  await js(winA, answer('Игровые комнаты'));
  for (const w of [winA, winB]) {
    await waitFor(w, `document.querySelector('.room-group')?.textContent.includes('Игровые комнаты')`, 'группа видна', 4000);
  }
  for (const w of [winA, winB]) {
    for (const id of [room2.id, room3.id]) await waitFor(w, `${roomRow(id)}?.closest('li').dataset.inGroup`, 'комната в группе', 4000);
  }
  console.log('✔ группа собрана перетаскиванием и видна всем');

  if (await js(winB, `Boolean(document.querySelector('.room-group .icon-btn'))`)) throw new Error('Участник видит кнопку создания');

  // Комната, брошенная на комнату из группы, просто переезжает в неё — без вопроса
  const room4 = await api('POST', '/rooms', { name: 'Четвёртая', kind: 'voice', hubId: hub.id }, a.token);
  await waitFor(winA, `Boolean(${roomRow(room4.id)})`, 'четвёртая комната', 4000);
  await js(winA, dragRoom(room4.id, room2.id));
  await waitFor(winA, `${roomRow(room4.id)}?.closest('li').dataset.inGroup`, 'комната переехала в группу', 4000);
  if (await js(winA, `Boolean(document.querySelector('.ask-text-input'))`)) throw new Error('Спросили название при переезде в готовую группу');
  console.log('✔ бросок на комнату из группы переносит в неё без вопроса');

  // Комнату можно вынуть из группы: бросок на заголовок раздела
  const dropOnSection = (roomId) => `(() => {
    const from = document.querySelector('#room-list [data-room="${roomId}"]').closest('li');
    const head = document.querySelector('#room-list .room-section[data-section="voice"]');
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = head.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 10, clientY: r.top + r.height / 2 };
    head.dispatchEvent(new DragEvent('dragover', at));
    head.dispatchEvent(new DragEvent('drop', at));
    return true;
  })()`;
  await js(winA, dropOnSection(room3.id));
  await waitFor(winA, `!${roomRow(room3.id)}?.closest('li').dataset.inGroup`, 'комната вынута из группы', 4000);
  console.log('✔ комнату можно вынуть из группы');

  // Плюс на группе создаёт комнату сразу в ней
  await js(winA, click('.room-group .icon-btn'));
  await waitFor(winA, `!document.getElementById('room-create').classList.contains('hidden')`, 'окно комнаты', 2000);
  await js(winA, `document.getElementById('room-name').value = 'Вторая игровая'; document.getElementById('room-create-form').requestSubmit(); true`);
  await waitFor(winB, `[...document.querySelectorAll('#room-list li[data-in-group]')].length === 3`, 'новая комната в группе', 4000);
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

  // Свёрнутая группа: разговор виден, остальные комнаты спрятаны, выбор запоминается
  await js(winB, click('.room-group-title'));
  await waitFor(winB, `document.querySelector('.room-group').classList.contains('closed')`, 'свёрнута', 2000);
  if (!(await js(winB, `Boolean(${roomRow(room.id)})`))) throw new Error('Идущий разговор спрятан');
  if (await js(winB, `Boolean(${roomRow(room2.id)})`)) throw new Error('Спрятанная комната группы видна');
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
  await waitFor(winA, `Boolean(document.querySelector('.ask-text-input'))`, 'окно переименования', 2000);
  await js(winA, answer('Новое имя'));
  await waitFor(winB, `document.querySelector('.room-group')?.textContent.includes('Новое имя')`, 'новое имя у Бори', 4000);
  await js(winA, openMenu(`document.querySelector('.room-group')`));
  await js(winA, menuItem('Удалить группу'));
  await waitFor(winA, `!document.getElementById('dialog').classList.contains('hidden')`, 'вопрос', 2000);
  await js(winA, `document.getElementById('dialog-ok').click(); true`);
  await waitFor(winB, `!document.querySelector('.room-group') && Boolean(${roomRow(room2.id)}) && ![...document.querySelectorAll('#room-list li[data-in-group]')].length`, 'группа удалена, комнаты на месте', 4000);
  console.log('✔ удаление группы оставляет комнаты в канале');
});
