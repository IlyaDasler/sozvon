// Плашка «печатает» с именем: в личном чате и в канале, гаснет после отправки и сама, не видна в других чатах.
// Запуск (сервер должен работать): npx electron scripts/e2e-typing.js [адрес сервера]
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const type = (id, text) => `(() => { const i = document.getElementById('${id}'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new InputEvent('input', { inputType: 'insertText' })); return true; })()`;
const bar = (id) => `document.getElementById('${id}').textContent`;

runTest(async () => {
  const a = await register('tya', 'Аня');
  const b = await register('tyb', 'Боря');
  const c = await register('tyc', 'Вика');
  await befriend(a, b);
  await befriend(a, c);
  await befriend(b, c);
  const hub = await api('POST', '/hubs', { name: 'Компания' }, a.token);
  for (const u of [b, c]) {
    await api('POST', `/hubs/${hub.id}/invites`, { userIds: [u.user.id] }, a.token);
    await api('POST', `/hub-invites/${hub.id}/accept`, null, u.token);
  }
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const winA = await openClient('tya', a);
  const winB = await openClient('tyb', b);
  const winC = await openClient('tyc', c);
  for (const w of [winA, winB, winC]) await waitFor(w, `e2eeReady() && Boolean(roomById(${room.id}))`, 'ключ');

  // Личный чат
  await js(winA, `selectContact(${b.user.id}).then(() => true)`);
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await js(winA, type('message-input', 'привет'));
  await waitFor(winB, `${bar('chat-typing')} === 'Аня печатает'`, 'плашка в личном чате');
  if (await js(winA, bar('chat-typing'))) throw new Error('Человек видит плашку о самом себе');
  console.log('✔ личный чат: «Аня печатает»');

  // Отправил — плашка гаснет сразу
  await js(winA, `document.getElementById('message-form').requestSubmit(); true`);
  await waitFor(winB, `${bar('chat-typing')} === ''`, 'плашка погасла после отправки', 3000);
  console.log('✔ отправил — плашка погасла');

  // Перестал писать — гаснет сама; в другом чате не видна
  await js(winA, type('message-input', 'ещё'));
  await waitFor(winB, `${bar('chat-typing')} === 'Аня печатает'`, 'снова печатает');
  await js(winB, `selectContact(${c.user.id}).then(() => true)`);
  if (await js(winB, bar('chat-typing'))) throw new Error('Плашка видна в чужом чате');
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  if ((await js(winB, bar('chat-typing'))) !== 'Аня печатает') throw new Error('Плашка не вернулась в свой чат');
  await waitFor(winB, `${bar('chat-typing')} === ''`, 'плашка погасла сама', 8000);
  console.log('✔ перестал писать — плашка погасла сама, в других чатах её нет');

  // Открытый черновик и отмена правки сигнала не дают
  await js(winA, `document.getElementById('message-input').value = ''; document.getElementById('message-input').dispatchEvent(new Event('input')); true`);
  await sleep(500);
  if (await js(winB, bar('chat-typing'))) throw new Error('Служебное изменение поля выдано за набор');

  // Канал: двое пишут
  for (const w of [winA, winB, winC]) await js(w, `selectRoom(${room.id}); true`);
  await js(winA, type('room-message-input', 'всем'));
  await js(winB, type('room-message-input', 'и мне'));
  await waitFor(winC, `${bar('room-typing')} === 'Аня и Боря печатают'`, 'плашка в канале');
  await waitFor(winB, `${bar('room-typing')} === 'Аня печатает'`, 'Боря видит только Аню');
  console.log('✔ канал: «Аня и Боря печатают»');
});
