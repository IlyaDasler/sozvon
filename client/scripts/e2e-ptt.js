// Сквозной тест рации (push-to-talk): назначение клавиши в настройках и микрофон по нажатию в звонке.
// Глобальный перехват клавиш здесь подменяет сам тест: он отвечает на ptt:* и присылает «нажата/отпущена»
// в окно так же, как это делает ptt.js в настоящем приложении.
// Запуск (сервер должен работать): npx electron scripts/e2e-ptt.js [адрес сервера]
const { ipcMain } = require('electron');
const { befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

let lastSet;
ipcMain.handle('ptt:set', (_e, binding) => {
  lastSet = binding;
  return true;
});
ipcMain.handle('ptt:names', () => ({ 57: 'Space' }));
ipcMain.handle('ptt:capture', () => ({ type: 'key', code: 57 }));

const micOn = (win) => js(win, `activeSession().local.tracks.mic.enabled`);
const seenMuted = (win, id) => `activeSession()?.peers.get(${id})?.media.muted`;

runTest(async () => {
  const a = await register('pa', 'Аня');
  const b = await register('pb', 'Боря');
  await befriend(a, b);
  const winA = await openClient('pa', a);
  const winB = await openClient('pb', b);

  // Назначаем клавишу: «Назначить» → нажатие → в настройках «Пробел», после «Сохранить» перехват включён на ней
  await js(winA, `openSettings('sound')`);
  await waitFor(winA, `!document.getElementById('ptt-block').classList.contains('hidden')`, 'блок рации в настройках');
  await js(winA, `document.getElementById('ptt-assign').click(); true`);
  await waitFor(winA, `document.getElementById('ptt-key').textContent === 'Пробел' && document.querySelector('input[name="mic-mode"][value="ptt"]').checked`, 'клавиша назначена');
  await js(winA, `document.getElementById('settings-form').requestSubmit(); true`);
  await waitFor(winA, `state.settings.ptt === true`, 'рация сохранена');
  await sleep(200);
  if (JSON.stringify(lastSet) !== JSON.stringify({ type: 'key', code: 57 })) throw new Error(`Перехват включён не на той клавише: ${JSON.stringify(lastSet)}`);
  console.log('✔ клавиша рации назначается в настройках и сохраняется');

  // В звонке: без нажатия микрофон выключен, с нажатием — включён и собеседник это видит
  await js(winA, `selectContact(${b.user.id}).then(() => startCall())`);
  await waitFor(winB, `!document.getElementById('incoming').classList.contains('hidden')`, 'входящий у Бори');
  await js(winB, 'acceptIncoming()');
  for (const w of [winA, winB]) await waitFor(w, `state.call?.phase === 'connected'`, 'соединение');
  if (await micOn(winA)) throw new Error('Без нажатия микрофон включён');
  await waitFor(winB, `${seenMuted(winB, a.user.id)} === true`, 'Боря видит, что Аню не слышно');

  winA.webContents.send('ptt', true);
  await waitFor(winA, `activeSession().local.tracks.mic.enabled`, 'микрофон по нажатию');
  await waitFor(winB, `${seenMuted(winB, a.user.id)} === false`, 'Боря видит, что Аню слышно');
  winA.webContents.send('ptt', false);
  // Отпускание чуть задерживается, чтобы не обрезать конец слова
  if (!(await micOn(winA))) throw new Error('Микрофон выключился без задержки');
  await waitFor(winA, `!activeSession().local.tracks.mic.enabled`, 'микрофон выключился после отпускания');
  console.log('✔ в звонке слышно, только пока держат клавишу; отпускание с небольшой задержкой');

  // Обратно «Голосом» — микрофон снова включён, перехват выключен
  await js(winA, `openSettings('sound')`);
  await js(winA, `document.querySelector('input[name="mic-mode"][value="voice"]').click(); document.getElementById('settings-form').requestSubmit(); true`);
  await waitFor(winA, `state.settings.ptt === false && activeSession().local.tracks.mic.enabled`, 'снова голосом');
  if (lastSet !== null) throw new Error('Перехват клавиш не выключился');
  console.log('✔ режим «Голосом» возвращает микрофон и выключает перехват');
  await js(winA, 'hangup()');
});
