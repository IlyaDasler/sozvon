// У каждого чата свой черновик: текст, ответ и файлы не переезжают в другой чат и не уходят не тому человеку;
// текст переживает перезапуск. Запуск (сервер должен работать): npx electron scripts/e2e-drafts.js [адрес сервера]
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const field = (id) => `document.getElementById('${id}').value`;
const type = (id, text) => `(() => { const i = document.getElementById('${id}'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); return true; })()`;

runTest(async () => {
  const a = await register('dra', 'Аня');
  const b = await register('drb', 'Боря');
  const c = await register('drc', 'Вика');
  await befriend(a, b);
  await befriend(a, c);
  const hub = await api('POST', '/hubs', { name: 'Компания' }, a.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const win = await openClient('dra', a);
  await waitFor(win, `e2eeReady() && Boolean(roomById(${room.id}))`, 'ключ');

  await js(win, `selectContact(${b.user.id}).then(() => true)`);
  await js(win, type('message-input', 'секрет для Бори'));
  await js(win, `selectContact(${c.user.id}).then(() => true)`);
  if ((await js(win, field('message-input'))) !== '') throw new Error('Текст для Бори попал в чат Вики');
  await js(win, type('message-input', 'для Вики'));
  await js(win, `selectContact(${b.user.id}).then(() => true)`);
  if ((await js(win, field('message-input'))) !== 'секрет для Бори') throw new Error('Черновик Бори пропал');
  console.log('✔ у каждого чата свой текст');

  // Ответ не переезжает: иначе цитата из одного чата ушла бы в другой
  await js(win, `(async () => { const { body, plain } = await encryptOutgoing(dmConvOf(${b.user.id}), { text: 'цитата' }); addMessage({ ...(await Api.post('/messages/${b.user.id}', body)), plain }); return true; })()`);
  await js(win, `startReply(state.history.get(${b.user.id}).at(-1), { kind: 'dm' }); true`);
  await js(win, `selectContact(${c.user.id}).then(() => true)`);
  if (await js(win, 'Boolean(replyDraft)')) throw new Error('Ответ переехал в другой чат');
  await js(win, `selectContact(${b.user.id}).then(() => true)`);
  if (!(await js(win, `replyDraft?.text === 'цитата' && !document.getElementById('chat-reply').classList.contains('hidden')`))) throw new Error('Ответ пропал');
  await js(win, 'clearReply(); true');
  console.log('✔ ответ остаётся в своём чате');

  // Прикреплённый файл тоже
  await js(win, `dmComposer.addFiles([new File(['x'], 'файл.txt', { type: 'text/plain' })]); true`);
  await waitFor(win, `dmComposer.files.length === 1 && Boolean(dmComposer.files[0].attachment)`, 'загрузка');
  await js(win, `selectContact(${c.user.id}).then(() => true)`);
  if ((await js(win, 'dmComposer.files.length')) !== 0) throw new Error('Файл переехал в другой чат');
  await js(win, `selectContact(${b.user.id}).then(() => true)`);
  if ((await js(win, 'dmComposer.files.length')) !== 1) throw new Error('Файл пропал');
  await js(win, 'dmComposer.removeFile(dmComposer.files[0]); true');
  console.log('✔ файл остаётся в своём чате');

  // Комната — свой черновик; правка не портит черновик, отмена его возвращает
  await js(win, `selectRoom(${room.id}); true`);
  await js(win, type('room-message-input', 'в комнату'));
  await js(win, `selectContact(${b.user.id}).then(() => true)`);
  await js(win, `selectRoom(${room.id}); true`);
  if ((await js(win, field('room-message-input'))) !== 'в комнату') throw new Error('Черновик комнаты пропал');
  await js(win, `selectContact(${b.user.id}).then(() => true)`);
  await js(win, `startEdit(state.history.get(${b.user.id}).at(-1), { kind: 'dm' }); true`);
  if ((await js(win, field('message-input'))) !== 'цитата') throw new Error('Правка не открылась');
  await js(win, 'cancelEdit(); true');
  if ((await js(win, field('message-input'))) !== 'секрет для Бори') throw new Error('Правка стёрла черновик');
  console.log('✔ комната и правка не портят черновики');

  // Текст переживает перезапуск
  await sleep(200);
  await js(win, 'location.reload()').catch(() => {});
  await sleep(1500);
  await waitFor(win, `e2eeReady() && document.getElementById('conn-dot').classList.contains('ok')`, 'перезапуск');
  await js(win, `selectContact(${b.user.id}).then(() => true)`);
  if ((await js(win, field('message-input'))) !== 'секрет для Бори') throw new Error('Черновик не пережил перезапуск');
  console.log('✔ черновик пережил перезапуск');

  // Отправил — черновика больше нет, и после перезапуска тоже
  await js(win, `document.getElementById('message-form').requestSubmit(); true`);
  await waitFor(win, `document.getElementById('message-input').value === ''`, 'отправка');
  await js(win, `selectContact(${c.user.id}).then(() => selectContact(${b.user.id})).then(() => true)`);
  if ((await js(win, field('message-input'))) !== '') throw new Error('Отправленный текст вернулся черновиком');
  await js(win, 'location.reload()').catch(() => {});
  await sleep(1500);
  await waitFor(win, `e2eeReady() && document.getElementById('conn-dot').classList.contains('ok')`, 'перезапуск');
  await js(win, `selectContact(${b.user.id}).then(() => true)`);
  if ((await js(win, field('message-input'))) !== '') throw new Error('Отправленный текст вернулся после перезапуска');
  console.log('✔ отправленное черновиком не остаётся');

  // Выход: черновики одного аккаунта не видны следующему
  await js(win, `selectContact(${c.user.id}).then(() => true)`);
  if ((await js(win, field('message-input'))) !== 'для Вики') throw new Error('Черновик Вики пропал');
  await js(win, 'logout(); true');
  if ((await js(win, field('message-input'))) !== '') throw new Error('Черновик остался в поле после выхода');
  console.log('✔ после выхода поле пустое');
});
