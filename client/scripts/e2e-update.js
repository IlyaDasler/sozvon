// Сквозной тест уведомления об обновлении: новая версия, найденная при запуске, не открывает окно сама —
// только плашка «Вышла версия X — Обновить» и точка на кнопке; «Обновить» показывает «Что нового»,
// крестик на плашке откладывает до следующей версии, проверка по кнопке показывает окно всегда.
// Запуск (сервер должен работать): npx electron scripts/e2e-update.js [адрес сервера]
const { register, js, waitFor, openClient, screenshot, runTest } = require('./e2e-lib');

const visible = (id) => `!document.getElementById('${id}').classList.contains('hidden')`;

runTest(async () => {
  const a = await register('up', 'Илья');
  const win = await openClient('up', a);
  await js(win, `localStorage.removeItem('skippedUpdate'); true`);

  // Проверка при запуске нашла версию 9.9.9
  await js(win, `onUpdateStatus({ state: 'available', version: '9.9.9', current: '2.0.0', notes: '<ul><li>Каналы</li></ul>' }); true`);
  await waitFor(win, `${visible('update-bar')} && document.getElementById('update-text').textContent === 'Вышла версия 9.9.9'`, 'плашка «Вышла версия»');
  if (await js(win, visible('update-modal'))) throw new Error('Окно обновления выскочило само');
  if (!(await js(win, `document.getElementById('sidebar-update-check').classList.contains('has-dot')`))) throw new Error('Нет точки на кнопке обновлений');
  await screenshot(win, 'update-bar');
  console.log('✔ при запуске — только плашка и точка, окно не выскакивает');

  // «Обновить» на плашке — окно «Что нового»; «Позже» возвращает плашку
  await js(win, `document.getElementById('update-btn').click(); true`);
  await waitFor(win, `${visible('update-modal')} && document.getElementById('update-notes').textContent.includes('Каналы')`, 'окно «Что нового»');
  await js(win, `document.getElementById('update-later').click(); true`);
  await waitFor(win, `!${visible('update-modal')} && ${visible('update-bar')}`, 'плашка после «Позже»');
  console.log('✔ «Обновить» показывает «Что нового», «Позже» оставляет плашку');

  // Крестик на плашке — не напоминать об этой версии
  await js(win, `document.getElementById('update-later-bar').click(); true`);
  await waitFor(win, `!${visible('update-bar')} && !document.getElementById('sidebar-update-check').classList.contains('has-dot')`, 'плашка и точка спрятаны');
  // Проверка по кнопке всё равно показывает окно
  await js(win, `document.getElementById('sidebar-update-check').click(); onUpdateStatus({ state: 'available', version: '9.9.9' }); true`);
  await waitFor(win, visible('update-modal'), 'окно по кнопке проверки');
  console.log('✔ крестик откладывает до следующей версии, проверка по кнопке показывает окно');
});
