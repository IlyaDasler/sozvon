// Сквозной тест раздела «Друзья»: заявка по логину, принятие, отказ, блокировка и разблокировка.
// Запуск (сервер должен работать): npx electron scripts/e2e-friends.js [адрес сервера]
const { register, js, waitFor, openClient, screenshot, runTest } = require('./e2e-lib');

const tab = (win, name) => js(win, `document.querySelector('#friend-tabs [data-tab="${name}"]').click(); true`);
const rowOf = (name) => `[...document.querySelectorAll('#friends-list .friend-row')].find((r) => r.textContent.includes(${JSON.stringify(name)}))`;
const press = (win, name, action) => js(win, `window.confirm = () => true; ${rowOf(name)}.querySelector('[data-action="${action}"]').click(); true`);

runTest(async () => {
  const a = await register('fa', 'Аня');
  const b = await register('fb', 'Боря');
  const c = await register('fc', 'Вова');
  const winA = await openClient('fa', a);
  const winB = await openClient('fb', b);
  const winC = await openClient('fc', c);

  // Без выбранного чата — раздел «Друзья»
  await waitFor(winA, `!document.getElementById('empty-state').classList.contains('hidden') && document.getElementById('friends-nav').classList.contains('active')`, 'раздел друзей');
  const sendRequest = async (win, username) => {
    await tab(win, 'add');
    await js(win, `(() => { const i = document.getElementById('friend-add-input'); i.value = ${JSON.stringify(username)}; i.dispatchEvent(new Event('input')); document.getElementById('friend-add-form').requestSubmit(); return true; })()`);
  };

  // Аня зовёт Борю: у неё — в отправленных, у Бори — заявка со счётчиком
  await sendRequest(winA, b.user.username);
  await waitFor(winA, `document.getElementById('friend-add-result').textContent.startsWith('Заявка отправлена')`, 'заявка отправлена');
  await screenshot(winA, 'friends-add');
  await tab(winA, 'outgoing');
  await waitFor(winA, `Boolean(${rowOf('Боря')})`, 'Боря в отправленных');
  await waitFor(winB, `document.getElementById('friends-nav-badge').textContent === '1' && document.getElementById('ftab-incoming').textContent === '1'`, 'счётчик заявок у Бори');
  if (await js(winB, `state.contacts.size !== 0`)) throw new Error('Заявка сразу сделала друзьями');
  console.log('✔ заявка по логину: у отправителя — в отправленных, у получателя — счётчик');

  // Боря принимает — оба в друзьях, заявки пропали
  await tab(winB, 'incoming');
  await waitFor(winB, `Boolean(${rowOf('Аня')})`, 'заявка Ани у Бори');
  await screenshot(winB, 'friends-incoming');
  await press(winB, 'Аня', 'Принять');
  await waitFor(winB, `state.contacts.has(${a.user.id}) && document.getElementById('friends-nav-badge').classList.contains('hidden')`, 'Аня в друзьях у Бори');
  await waitFor(winA, `state.contacts.has(${b.user.id}) && !document.querySelector('#friends-list .friend-row')`, 'Боря в друзьях у Ани');
  await tab(winA, 'all');
  await waitFor(winA, `Boolean(${rowOf('Боря')}?.querySelector('[data-action="Написать"]'))`, 'Боря во «Всех»');
  await screenshot(winA, 'friends-all');
  console.log('✔ заявку приняли — оба в друзьях, во «Всех» есть кнопки «Написать» и «Позвонить»');

  // Вова зовёт Борю, Боря отклоняет — у Вовы заявка пропадает
  await sendRequest(winC, b.user.username);
  await tab(winB, 'incoming');
  await waitFor(winB, `Boolean(${rowOf('Вова')})`, 'заявка Вовы');
  await press(winB, 'Вова', 'Отклонить');
  await tab(winC, 'outgoing');
  await waitFor(winC, `!state.requests.outgoing.length && !document.querySelector('#friends-list .friend-row')`, 'заявка Вовы отклонена');
  console.log('✔ отклонённая заявка пропадает у обоих');

  // Вова зовёт снова — Боря блокирует; Вова больше не может звать
  await sendRequest(winC, b.user.username);
  await waitFor(winB, `Boolean(${rowOf('Вова')})`, 'вторая заявка Вовы');
  await press(winB, 'Вова', 'Заблокировать');
  await tab(winB, 'blocked');
  await waitFor(winB, `Boolean(${rowOf('Вова')})`, 'Вова в заблокированных');
  await screenshot(winB, 'friends-blocked');
  await sendRequest(winC, b.user.username);
  await waitFor(winC, `document.getElementById('friend-add-result').classList.contains('error')`, 'Вове отказано');
  // Разблокировал — снова можно
  await js(winB, `[...${rowOf('Вова')}.querySelectorAll('button')].find((x) => x.textContent === 'Разблокировать').click(); true`);
  await waitFor(winB, `!state.blocked.length`, 'Вова разблокирован');
  await sendRequest(winC, b.user.username);
  await waitFor(winC, `document.getElementById('friend-add-result').textContent.startsWith('Заявка отправлена')`, 'после разблокировки можно звать');
  console.log('✔ блокировка: заявка пропадает, новые не проходят; после разблокировки — снова можно');

  // Удалить из друзей с вкладки «Все»
  await tab(winB, 'all');
  await press(winB, 'Аня', 'Удалить из друзей');
  await waitFor(winA, `!state.contacts.has(${b.user.id})`, 'дружба пропала у Ани');
  console.log('✔ удаление из друзей видно обоим');
});
