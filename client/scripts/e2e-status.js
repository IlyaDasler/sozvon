// Сквозной тест статусов и уведомлений: два окна, одно меняет статус, другое видит; центр уведомлений.
// Запуск (сервер должен работать): npx electron scripts/e2e-status.js [адрес сервера]
const { api, befriend, register, js, waitFor, sleep, openClient, screenshot, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('sa', 'Аня');
  const b = await register('sb', 'Боря');
  await befriend(a, b);
  const winA = await openClient('sa', a);
  const winB = await openClient('sb', b);
  console.log('✔ оба вошли');

  // Как Боря видит Аню: точка на аватарке, подпись в списке друзей
  const seenByB = (status, sub) =>
    `(() => {
      const li = [...document.querySelectorAll('#contact-list .contact')].find((l) => l.textContent.includes('Аня'));
      return Boolean(li?.querySelector('.status.s-${status}')) && li.textContent.includes('${sub}');
    })()`;
  await waitFor(winB, seenByB('online', 'В сети'), 'Аня в сети');

  // Аня выбирает статус в меню по щелчку на своей аватарке
  const pick = async (status) => {
    await js(winA, `document.getElementById('me-status-btn').click(); true`);
    await waitFor(winA, `!document.getElementById('status-menu').classList.contains('hidden')`, 'меню статуса');
    await js(winA, `document.querySelector('#status-menu [data-status="${status}"]').click(); true`);
    await waitFor(winA, `state.me.status === '${status}' && Boolean(document.querySelector('#me-avatar .status.s-${status}'))`, `свой статус ${status}`);
  };

  await pick('dnd');
  await waitFor(winB, seenByB('dnd', 'Не беспокоить'), 'Аня «не беспокоить»');
  console.log('✔ «Не беспокоить» видно другу');

  await pick('idle');
  await waitFor(winB, seenByB('idle', 'Неактивен'), 'Аня «неактивен»');
  console.log('✔ «Неактивен» видно другу');

  await pick('invisible');
  await waitFor(winB, seenByB('offline', 'Не в сети'), 'Аня невидимая');
  await js(winB, `selectContact(${a.user.id})`);
  await waitFor(winB, `document.getElementById('call-btn').disabled`, 'звонок невидимой недоступен');
  console.log('✔ невидимый для друга «не в сети»');

  // Автоматически «неактивен»: приложение сообщает, что за компьютером давно никого нет
  await pick('online');
  await waitFor(winB, seenByB('online', 'В сети'), 'Аня снова в сети');
  await js(winA, `socket.send({ type: 'status:auto', idle: true }); true`);
  await waitFor(winB, seenByB('idle', 'Неактивен'), 'Аня сама стала неактивной');
  await js(winA, `socket.send({ type: 'status:auto', idle: false }); true`);
  await waitFor(winB, seenByB('online', 'В сети'), 'Аня вернулась');
  console.log('✔ «Неактивен» включается сам и выключается, когда человек вернулся');
  await screenshot(winB, 'status-friends');

  // Уведомления: Боря пишет, Аня смотрит не этот чат — в колокольчике сообщение
  await js(winA, `selectContact(null); localStorage.removeItem('notifications:' + state.me.id); renderNotifBadge(); true`);
  await js(winB, `Api.post('/messages/${a.user.id}', { text: 'Привет, ты тут?' }).then(() => true)`);
  await waitFor(winA, `document.getElementById('notif-badge').textContent === '1' && !document.getElementById('notif-badge').classList.contains('hidden')`, 'счётчик уведомлений');
  await js(winA, `document.getElementById('notif-btn').click(); true`);
  await waitFor(winA, `[...document.querySelectorAll('.notif-item')].some((n) => n.textContent.includes('Привет, ты тут?'))`, 'сообщение в центре уведомлений');
  await waitFor(winA, `document.getElementById('notif-badge').classList.contains('hidden')`, 'открыли — прочитано');
  await screenshot(winA, 'notif-panel');
  await js(winA, `document.querySelector('.notif-item').click(); true`);
  await waitFor(winA, `state.selectedId === ${b.user.id} && document.getElementById('notif-panel').classList.contains('hidden')`, 'переход в чат по уведомлению');
  console.log('✔ сообщение попадает в колокольчик, щелчок открывает чат');

  // Прочитал в самом чате — колокольчик тоже не считает его непрочитанным
  await js(winA, 'selectContact(null)');
  await js(winB, `Api.post('/messages/${a.user.id}', { text: 'Ещё одно' }).then(() => true)`);
  await waitFor(winA, `document.getElementById('notif-badge').textContent === '1' && !document.getElementById('notif-badge').classList.contains('hidden')`, 'новое уведомление');
  await js(winA, `selectContact(${b.user.id}).then(() => true)`);
  await waitFor(winA, `document.getElementById('notif-badge').classList.contains('hidden')`, 'открыл чат — уведомление прочитано');
  console.log('✔ открыл чат — его уведомления в колокольчике прочитаны');

  // Кнопки «Назад» и «Вперёд» в полосе окна: из чата можно уйти назад и вернуться
  await js(winA, 'selectContact(null)');
  await js(winA, `document.getElementById('nav-back').click(); true`);
  await waitFor(winA, `state.selectedId === ${b.user.id}`, '«Назад» вернул в чат');
  await waitFor(winA, `!document.getElementById('nav-forward').disabled`, '«Вперёд» доступна');
  await js(winA, `document.getElementById('nav-forward').click(); true`);
  await waitFor(winA, `state.selectedId === null && document.getElementById('nav-forward').disabled`, '«Вперёд» — снова «Друзья»');
  console.log('✔ кнопки «Назад» и «Вперёд» переходят между чатами');

  // Пропущенный звонок: Боря звонит и сбрасывает. В «не беспокоить» звонок не звенит и не всплывает
  await pick('dnd');
  await js(winA, 'selectContact(null)');
  await js(winB, `selectContact(${a.user.id}).then(() => startCall())`);
  await waitFor(winA, 'state.incoming !== null', 'входящий у Ани');
  if (await js(winA, `tone.timer !== null`)) throw new Error('В «не беспокоить» звонок звенит');
  await js(winB, 'hangup()');
  await waitFor(winA, `state.incoming === null && loadNotifs()[0]?.kind === 'missed' && loadNotifs()[0].body === 'Боря'`, 'пропущенный звонок в уведомлениях');
  console.log('✔ в «не беспокоить» звонок не звенит, пропущенный звонок — в колокольчике');

  // Настройки уведомлений сохраняются
  await js(winA, 'openSettings()');
  await js(winA, `document.getElementById('set-notify-sound').click(); true`);
  if ((await js(winA, `notifySettings().sound`)) !== false) throw new Error('Настройка звука не сохранилась');
  await js(winA, `document.getElementById('set-notify-sound').click(); closeSettings(); true`);
  console.log('✔ настройки уведомлений сохраняются');
  await pick('online');
});
