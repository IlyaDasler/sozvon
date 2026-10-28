// Сквозной тест шифрования переписки: сервер получает и хранит только шифр, собеседники читают;
// в комнате новичок получает ключ и читает историю, выгнанный не читает новое; ключ переносится
// на второе устройство кодом. Запуск (сервер должен работать): npx electron scripts/e2e-e2ee.js [адрес сервера]
const { api, befriend, register, js, waitFor, sleep, openClient, screenshot, runTest } = require('./e2e-lib');

const lastText = (box) => `[...document.querySelectorAll('#${box} .msg-text')].at(-1)?.textContent`;
const send = (win, form, input, text) =>
  js(win, `document.getElementById('${input}').value = ${JSON.stringify(text)}; document.getElementById('${form}').requestSubmit(); true`);
const sendDm = (win, text) => send(win, 'message-form', 'message-input', text);
const sendRoom = (win, text) => send(win, 'room-message-form', 'room-message-input', text);

runTest(async () => {
  const a = await register('ea', 'Аня');
  const b = await register('eb', 'Боря');
  const c = await register('ec', 'Вика');
  await befriend(a, b);
  const winA = await openClient('ea', a);
  const winB = await openClient('eb', b);
  // При первом входе ключ создаётся сам, без вопросов
  for (const [win, u] of [[winA, a], [winB, b]]) await waitFor(win, `e2eeReady() && state.me.publicKey === e2ee.identity.publicKey`, `${u.user.displayName}: свой ключ`);
  console.log('✔ при первом входе у каждого появился свой ключ');

  // Личная переписка: сервер получает заглушку и шифр, Боря читает текст
  await js(winA, `selectContact(${b.user.id})`);
  await js(winB, `selectContact(${a.user.id})`);
  await sendDm(winA, 'секрет-111 **жирно**');
  await waitFor(winB, `${lastText('messages')} === 'секрет-111 жирно'`, 'Боря прочитал');
  await waitFor(winA, `${lastText('messages')} === 'секрет-111 жирно'`, 'Аня видит своё');
  const onServer = await api('GET', `/messages/${b.user.id}`, null, a.token);
  const last = onServer.at(-1);
  if (JSON.stringify(onServer).includes('секрет-111')) throw new Error('Сервер хранит текст сообщения');
  if (!last.enc?.ct || !last.text.startsWith('🔒')) throw new Error('Сообщение ушло без шифрования');
  console.log('✔ личное сообщение: на сервере только шифр, собеседник читает');

  // Код шифрования в карточке профиля: у Ани про Борю и у Бори про Аню — один и тот же
  const cardCode = async (win, userId) => {
    await js(win, `openProfileCard(${userId}, document.getElementById('peer-avatar')); true`);
    await waitFor(win, `/\\d{4} \\d{4}/.test(document.querySelector('#profile-card .pc-keycode-value')?.textContent || '')`, 'код в карточке');
    const code = await js(win, `document.querySelector('#profile-card .pc-keycode-value').textContent`);
    await js(win, `closeProfileCard(); true`);
    return code;
  };
  const codeAB = await cardCode(winA, b.user.id);
  if (codeAB !== (await cardCode(winB, a.user.id))) throw new Error('Коды шифрования у собеседников разные');
  console.log('✔ код шифрования в карточке профиля совпадает у обоих');

  // Файл: на сервере зашифрованные байты, у Бори — исходный файл
  await js(winA, `dmComposer.addFiles([new File(['файл-секрет-222'], 'план.txt', { type: 'text/plain' })]); true`);
  await waitFor(winA, `dmComposer.files.length === 1 && dmComposer.files.every((f) => f.attachment)`, 'загрузка файла');
  await sendDm(winA, 'держи файл');
  await waitFor(winB, `[...document.querySelectorAll('#messages .file-card')].at(-1)?.textContent.includes('план.txt')`, 'карточка файла у Бори');
  const stored = (await api('GET', `/messages/${b.user.id}`, null, a.token)).at(-1).attachments[0];
  const raw = await (await fetch(`${process.argv.find((x) => /^https?:\/\//.test(x)) || 'http://127.0.0.1:3000'}${stored.url}`)).arrayBuffer();
  if (Buffer.from(raw).includes(Buffer.from('файл-секрет-222')) || stored.name.includes('план')) throw new Error('Сервер видит файл или его имя');
  await waitFor(winB, `[...document.querySelectorAll('#messages .file-card a')].at(-1)?.href.startsWith('blob:')`, 'файл расшифрован');
  const fileText = await js(winB, `fetch([...document.querySelectorAll('#messages .file-card a')].at(-1).href).then((r) => r.text())`);
  if (fileText !== 'файл-секрет-222') throw new Error(`Боря скачал не то: ${fileText}`);
  console.log('✔ файл: на сервере шифр без имени, собеседник скачивает исходный');

  // Комната: Аня и Боря пишут, Вика приходит позже и читает историю
  const hub = await api('POST', '/hubs', { name: 'Тайный клуб' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { name: 'шифры', kind: 'text', hubId: hub.id }, a.token);
  for (const win of [winA, winB]) await waitFor(win, `Boolean(roomById(${room.id}))`, 'комната у всех');
  await js(winA, `selectRoom(${room.id})`);
  await js(winB, `selectRoom(${room.id})`);
  await sendRoom(winA, 'комната-333');
  await waitFor(winB, `${lastText('room-messages')} === 'комната-333'`, 'Боря прочитал в комнате');
  if (JSON.stringify(await api('GET', `/rooms/${room.id}/messages`, null, b.token)).includes('комната-333')) throw new Error('Сервер хранит текст комнаты');

  await befriend(a, c);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [c.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, c.token);
  await api('POST', `/rooms/${room.id}/members`, { userId: c.user.id }, a.token).catch(() => {});
  const winC = await openClient('ec', c);
  await waitFor(winC, `e2eeReady() && Boolean(roomById(${room.id}))`, 'Вика в комнате');
  await js(winC, `selectRoom(${room.id})`);
  await waitFor(winC, `${lastText('room-messages')} === 'комната-333'`, 'Вика читает историю', 20000);
  console.log('✔ комната: на сервере шифр, новичок получает ключ и читает историю');

  // Вику выгнали — новое сообщение она прочитать не может (ключ сменился)
  await api('DELETE', `/rooms/${room.id}/members/${c.user.id}`, null, a.token);
  await waitFor(winA, `!roomById(${room.id}).members.some((m) => m.id === ${c.user.id})`, 'Вика вне комнаты у Ани');
  const epochBefore = (await api('GET', `/keys/room:${room.id}`, null, a.token)).epoch;
  await sendRoom(winA, 'после-кика-444');
  await waitFor(winB, `${lastText('room-messages')} === 'после-кика-444'`, 'Боря читает новое');
  const keys = await api('GET', `/keys/room:${room.id}`, null, a.token);
  if (keys.epoch !== epochBefore + 1) throw new Error(`Ключ комнаты не сменился после кика: ${epochBefore} → ${keys.epoch}`);
  await api('GET', `/keys/room:${room.id}`, null, c.token).then(
    () => { throw new Error('Выгнанной отдали ключи комнаты'); },
    () => {}
  );
  console.log('✔ после кика ключ комнаты сменился, выгнанной он не достаётся');

  // Второе устройство Ани: ключа нет — окно переноса; код с первого устройства переносит ключ
  const winA2 = await openClient('ea2', a);
  await waitFor(winA2, `!document.getElementById('e2ee-setup').classList.contains('hidden')`, 'окно переноса ключа');
  await js(winA2, `selectContact(${b.user.id})`);
  await waitFor(winA2, `document.querySelectorAll('#messages .msg-locked').length > 0`, 'без ключа сообщения закрыты');
  await screenshot(winA2, 'e2ee-setup');
  const code = await js(winA, `startTransfer()`);
  await js(winA2, `document.getElementById('e2ee-code').value = ${JSON.stringify(code.toLowerCase())}; document.getElementById('e2ee-transfer-btn').click(); true`);
  await waitFor(winA2, `e2eeReady() && document.getElementById('e2ee-setup').classList.contains('hidden')`, 'ключ перенесён', 20000);
  await waitFor(winA2, `[...document.querySelectorAll('#messages .msg-text')].some((t) => t.textContent === 'секрет-111 жирно')`, 'второе устройство читает');
  console.log('✔ ключ переносится на второе устройство кодом, переписка читается');
  await sleep(200);
});
