// Непрочитанное хранит сервер: счётчики видны после запуска, в чате — линия «Новые сообщения», второе устройство
// снимает отметку само. Запуск (сервер должен работать): npx electron scripts/e2e-unread.js [адрес сервера]
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const sendDm = (peer, text) => `(async () => { const { body, plain } = await encryptOutgoing(dmConvOf(${peer}), { text: ${JSON.stringify(text)} }); addMessage({ ...(await Api.post('/messages/${peer}', body)), plain }); return true; })()`;
const sendRoom = (room, text) => `(async () => { const { body, plain } = await encryptOutgoing(roomConvOf(${room}), { text: ${JSON.stringify(text)} }); addRoomMessage({ ...(await Api.post('/rooms/${room}/messages', body)), plain }); return true; })()`;
const ready = `e2eeReady() && document.getElementById('conn-dot').classList.contains('ok')`;

async function restart(win) {
  await js(win, 'location.reload()').catch(() => {});
  await sleep(1500);
  await waitFor(win, ready, 'перезапуск');
}

runTest(async () => {
  const a = await register('una', 'Аня');
  const b = await register('unb', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Компания' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const winA = await openClient('una', a);
  const winB = await openClient('unb', b);
  for (const w of [winA, winB]) await waitFor(w, `e2eeReady() && Boolean(roomById(${room.id}))`, 'ключ');
  await js(winA, `selectContact(${b.user.id}).then(() => true)`);
  await js(winA, sendDm(b.user.id, 'прочитанное'));
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await waitFor(winB, `document.getElementById('messages').textContent.includes('прочитанное')`, 'первое сообщение');
  await js(winB, `selectContact(null); true`);

  // Пока приложения «не было»: после перезапуска счётчик на месте
  await js(winB, 'socket.close(); true');
  await js(winA, sendDm(b.user.id, 'пока ты спал 1'));
  await js(winA, sendDm(b.user.id, 'пока ты спал 2'));
  await js(winA, `selectRoom(${room.id}); true`);
  await js(winA, sendRoom(room.id, 'в комнате'));
  await restart(winB);
  await waitFor(winB, `state.unread.get(${a.user.id}) === 2`, 'счётчик личного чата после запуска');
  await waitFor(winB, `state.roomUnread.get(${room.id}) === 1 && hubUnread(${hub.id})`, 'счётчик комнаты после запуска');
  await waitFor(winB, `[...document.querySelectorAll('#contact-list .contact')].some((l) => l.textContent.includes('2'))`, 'счётчик в списке');
  console.log('✔ непрочитанное видно после запуска');

  // Открыл: линия перед первым новым, чат внизу, отметка снята и больше не возвращается
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await waitFor(winB, `document.querySelector('#messages .new-line')?.nextElementSibling?.textContent.includes('пока ты спал 1')`, 'линия «Новые сообщения»');
  const gap = await js(winB, `(() => { const b = document.getElementById('messages'); return b.scrollHeight - b.scrollTop - b.clientHeight; })()`);
  if (gap > 2) throw new Error(`Чат открылся не на последнем сообщении: ${gap} px`);
  await js(winB, `selectRoom(${room.id}); true`);
  await waitFor(winB, `document.getElementById('room-messages').textContent.includes('в комнате')`, 'комната');
  await sleep(300);
  await restart(winB);
  await sleep(500);
  if (await js(winB, `state.unread.size + state.roomUnread.size`)) throw new Error('Прочитанное снова непрочитанное');
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await sleep(300);
  if (await js(winB, `Boolean(document.querySelector('#messages .new-line'))`)) throw new Error('Линия при прочитанном чате');
  console.log('✔ открыл чат — линия «Новые сообщения», отметка снята навсегда');

  // Новое, пока открыт другой чат: счётчик и линия без перезапуска
  await js(winB, `selectContact(null); true`);
  await js(winA, `selectContact(${b.user.id}).then(() => true)`);
  await js(winA, sendDm(b.user.id, 'живое'));
  await waitFor(winB, `state.unread.get(${a.user.id}) === 1`, 'живой счётчик');
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await waitFor(winB, `document.querySelector('#messages .new-line')?.nextElementSibling?.textContent.includes('живое')`, 'линия у живого сообщения');
  console.log('✔ живое сообщение — счётчик и линия');

  // Второе устройство: прочитал на нём — здесь отметка ушла сама
  await js(winB, `selectContact(null); true`);
  await js(winA, sendDm(b.user.id, 'для двух устройств'));
  await waitFor(winB, `state.unread.get(${a.user.id}) === 1`, 'счётчик перед чтением');
  await js(winA, `fetch(Api.base + '/api/read', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ${b.token}' }, body: JSON.stringify({ conv: 'dm:${a.user.id}' }) }).then(() => true)`);
  await waitFor(winB, `!state.unread.has(${a.user.id})`, 'отметка снята другим устройством');
  console.log('✔ прочитано на другом устройстве — отметка ушла');

  // «Отметить прочитанным» в меню запоминается
  await js(winA, `selectRoom(${room.id}); true`);
  await js(winA, sendRoom(room.id, 'меню'));
  await waitFor(winB, `state.roomUnread.get(${room.id}) === 1`, 'комната непрочитана');
  await js(winB, `markHubRead(${hub.id}); true`);
  await sleep(300);
  await restart(winB);
  await sleep(500);
  if (await js(winB, `state.roomUnread.has(${room.id})`)) throw new Error('«Отметить прочитанным» не запомнилось');
  console.log('✔ «Отметить прочитанным» запоминается');
});
