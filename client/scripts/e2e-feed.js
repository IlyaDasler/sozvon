// Лента сообщений: вся история доступна прокруткой вверх, новое сообщение не сбивает чтение, после обрыва связи
// пропущенное дозапрашивается само. Запуск (сервер должен работать): npx electron scripts/e2e-feed.js [адрес сервера]
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const sendDm = (peer, text) => `(async () => { const { body, plain } = await encryptOutgoing(dmConvOf(${peer}), { text: ${JSON.stringify(text)} }); addMessage({ ...(await Api.post('/messages/${peer}', body)), plain }); return state.history.get(${peer}).at(-1).id; })()`;
const sendRoom = (room, text) => `(async () => { const { body, plain } = await encryptOutgoing(roomConvOf(${room}), { text: ${JSON.stringify(text)} }); addRoomMessage({ ...(await Api.post('/rooms/${room}/messages', body)), plain }); return true; })()`;
const addPng = (composer) => `(async () => { const c = document.createElement('canvas'); c.width = 500; c.height = 500; c.getContext('2d').fillRect(0, 0, 500, 500); const blob = await new Promise((r) => c.toBlob(r, 'image/png')); ${composer}.addFiles([new File([blob], 'к.png', { type: 'image/png' })]); return true; })()`;
const node = (box, text) => `[...document.querySelectorAll('#${box} *')].find((e) => !e.children.length && e.textContent === ${JSON.stringify(text)})`;
const top = (box, text) => `(() => { const b = document.getElementById('${box}'); const n = ${node(box, text)}; return n ? Math.round(n.getBoundingClientRect().top - b.getBoundingClientRect().top) : null; })()`;
// Окно теста может быть в фоне и не получать событий прокрутки — посылаем сами
const scrollTo = (box, expr) => `(() => { const b = document.getElementById('${box}'); b.scrollTop = ${expr}; b.dispatchEvent(new Event('scroll')); return b.scrollTop; })()`;
const online = `document.getElementById('conn-dot').classList.contains('ok')`;

runTest(async () => {
  const a = await register('fda', 'Аня');
  const b = await register('fdb', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Компания' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const winA = await openClient('fda', a);
  const winB = await openClient('fdb', b);
  for (const w of [winA, winB]) await waitFor(w, `e2eeReady() && Boolean(roomById(${room.id}))`, 'ключ');
  await js(winA, `selectContact(${b.user.id}).then(() => true)`);

  let firstId;
  for (let i = 1; i <= 130; i++) {
    const id = await js(winA, sendDm(b.user.id, `Сообщение ${i}`));
    if (i === 1) firstId = id;
  }

  // История: прокрутка вверх догружает всё, строка на экране не уезжает
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await waitFor(winB, `state.history.get(${a.user.id})?.length === 50`, 'первая страница');
  await js(winB, scrollTo('messages', 0));
  await waitFor(winB, `state.history.get(${a.user.id}).length === 100`, 'вторая страница');
  await sleep(300);
  const shifted = await js(winB, top('messages', 'Сообщение 81'));
  if (shifted === null || shifted < -5 || shifted > 80) throw new Error(`После подгрузки лента уехала: «Сообщение 81» на ${shifted} px`);
  await js(winB, scrollTo('messages', 0));
  await waitFor(winB, `state.history.get(${a.user.id}).length === 130 && Boolean(${node('messages', 'Сообщение 1')})`, 'вся история');
  console.log('✔ вся история доступна прокруткой вверх, лента не уезжает');

  // Закреплённое старое сообщение: переход догружает историю до него
  await js(winB, `state.history.delete(${a.user.id}); selectContact(null); true`);
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await waitFor(winB, `state.history.get(${a.user.id})?.length >= 50`, 'заново');
  await js(winB, `jumpToMessage(document.getElementById('messages'), ${firstId}); true`);
  await waitFor(winB, `Boolean(document.querySelector('#messages [data-msg-id="${firstId}"]'))`, 'переход к старому сообщению', 8000);
  console.log('✔ переход к старому сообщению догружает историю');

  // Читаем историю с картинками, приходит новое: строка на месте, выделение живо, элемент тот же
  await js(winB, 'selectContact(null); true');
  for (let i = 1; i <= 6; i++) {
    await js(winA, sendDm(b.user.id, `Метка ${i}`));
    await js(winA, addPng('dmComposer'));
    await waitFor(winA, `dmComposer.files.length === 1 && dmComposer.files.every((f) => f.attachment)`, 'загрузка');
    await js(winA, `document.getElementById('message-form').requestSubmit(); true`);
    await waitFor(winA, 'dmComposer.files.length === 0', 'отправка');
    await sleep(100);
  }
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await waitFor(winB, `[...document.querySelectorAll('#messages .msg-images img')].length >= 6 && [...document.querySelectorAll('#messages .msg-images img')].every((i) => i.complete && i.naturalWidth)`, 'картинки');
  await sleep(500);
  await js(winB, `(() => { const box = document.getElementById('messages'); const n = ${node('messages', 'Метка 3')}; box.scrollTop += n.getBoundingClientRect().top - box.getBoundingClientRect().top - 50; box.dispatchEvent(new Event('scroll')); window.mark = n; const r = document.createRange(); r.selectNodeContents(n); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()`);
  await sleep(300);
  const before = await js(winB, top('messages', 'Метка 3'));
  await js(winA, sendDm(b.user.id, 'НОВОЕ'));
  await waitFor(winB, `Boolean(${node('messages', 'НОВОЕ')})`, 'новое сообщение');
  await sleep(500);
  const after = await js(winB, top('messages', 'Метка 3'));
  if (Math.abs(after - before) > 2) throw new Error(`Лента прыгнула: ${before} → ${after} px`);
  if ((await js(winB, 'getSelection().toString()')) !== 'Метка 3') throw new Error('Выделение сбросилось');
  if (!(await js(winB, 'document.contains(window.mark)'))) throw new Error('Лента пересобрана целиком');
  if (!(await js(winB, `document.getElementById('messages').jumpBar.classList.contains('fresh')`))) throw new Error('Нет подсказки «Ниже новые сообщения»');
  console.log('✔ новое сообщение не сбивает чтение и выделение');

  // Реакция на сообщение с картинкой: картинка не перезагружается
  const lastImg = `[...document.querySelectorAll('#messages .msg-images img')].at(-1)`;
  await js(winB, `window.img = ${lastImg}; true`);
  const imageMsg = await js(winB, `Number(${lastImg}.closest('.msg').dataset.msgId)`);
  await js(winA, `Api.post('/messages/${b.user.id}/${imageMsg}/reactions', { emoji: '👍' }).then(() => true)`);
  await waitFor(winB, `Boolean(document.querySelector('[data-msg-id="${imageMsg}"] .reaction-chip'))`, 'реакция');
  if (!(await js(winB, 'document.contains(window.img)'))) throw new Error('Реакция пересоздала картинку');
  console.log('✔ реакция не пересоздаёт картинку');

  // Внизу ленты новое сообщение видно сразу
  await js(winB, `document.getElementById('messages').jumpBar.click(); true`);
  await js(winA, sendDm(b.user.id, 'ещё новее'));
  await waitFor(winB, `Boolean(${node('messages', 'ещё новее')})`, 'сообщение');
  await sleep(200);
  const gap = await js(winB, `(() => { const b = document.getElementById('messages'); return b.scrollHeight - b.scrollTop - b.clientHeight; })()`);
  if (gap > 2) throw new Error(`Внизу ленты новое ушло под край: ${gap} px`);
  console.log('✔ внизу ленты новое сообщение видно');

  // Обрыв связи: написали, изменили и удалили, пока Бори не было. Открытый чат и чаты из памяти подтягиваются сами
  const gone = await js(winA, sendDm(b.user.id, 'удалят в обрыве'));
  const changed = await js(winA, sendDm(b.user.id, 'изменят в обрыве'));
  await waitFor(winB, `Boolean(${node('messages', 'изменят в обрыве')})`, 'сообщения до обрыва');
  await js(winB, 'socket.ws.close(); true');
  await sleep(30);
  await js(winA, sendDm(b.user.id, 'ПОКА ТЕБЯ НЕ БЫЛО'));
  await js(winA, `Api.del('/messages/${b.user.id}/${gone}').then(() => true)`);
  await js(winA, `(async () => { const { body } = await encryptOutgoing(dmConvOf(${b.user.id}), { text: 'изменено в обрыве' }); await Api.patch('/messages/${b.user.id}/${changed}', body); return true; })()`);
  await waitFor(winB, online, 'снова на связи');
  await waitFor(winB, `Boolean(${node('messages', 'ПОКА ТЕБЯ НЕ БЫЛО')})`, 'пропущенное сообщение в открытом чате', 8000);
  await waitFor(winB, `Boolean(${node('messages', 'изменено в обрыве')}) && !${node('messages', 'удалят в обрыве')}`, 'правка и удаление', 8000);
  console.log('✔ после обрыва открытый чат догнал новое, правку и удаление');

  await js(winB, 'selectContact(null); true');
  await js(winB, 'socket.ws.close(); true');
  await sleep(30);
  await js(winA, sendDm(b.user.id, 'ВТОРОЙ ОБРЫВ'));
  await waitFor(winB, online, 'снова на связи');
  await sleep(500);
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await waitFor(winB, `Boolean(${node('messages', 'ВТОРОЙ ОБРЫВ')})`, 'пропущенное в закрытом чате', 8000);
  console.log('✔ после обрыва закрытый чат тоже не теряет сообщения');

  // Комната: подгрузка и обрыв
  await js(winA, `selectRoom(${room.id}); true`);
  for (let i = 1; i <= 60; i++) await js(winA, sendRoom(room.id, `Комната ${i}`));
  await js(winB, `selectRoom(${room.id}); true`);
  await waitFor(winB, `state.roomHistory.get(${room.id})?.length === 50`, 'первая страница комнаты');
  await js(winB, scrollTo('room-messages', 0));
  await waitFor(winB, `state.roomHistory.get(${room.id}).length === 60`, 'вся комната');
  await js(winB, 'socket.ws.close(); true');
  await sleep(30);
  await js(winA, sendRoom(room.id, 'В КОМНАТЕ ПОКА ТЕБЯ НЕ БЫЛО'));
  await waitFor(winB, online, 'снова на связи');
  await waitFor(winB, `Boolean(${node('room-messages', 'В КОМНАТЕ ПОКА ТЕБЯ НЕ БЫЛО')})`, 'пропущенное в комнате', 8000);
  console.log('✔ комната: подгрузка истории и обрыв связи');
});
