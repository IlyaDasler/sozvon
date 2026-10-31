// Рация целиком (в e2e-ptt.js перехват подменён): настоящая клавиша (нажимает сама Windows), настоящий перехват ptt.js, настоящий разговор.
// Боря слышит Аню, только пока Аня держит клавишу. Запуск (сервер должен работать):
//   node_modules/electron/dist/electron.exe scripts/e2e-ptt-key.js
const { spawnSync } = require('child_process');
const { befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const { ipcMain } = require('electron');
const { parseBinding } = require('../renderer/ptt-keys');
const ptt = require('../ptt');

// Настоящий перехват клавиш — как в main.js приложения
ipcMain.handle('ptt:set', (e, value) => {
  ptt.configure(parseBinding(value), (down) => e.sender.send('ptt', down));
  return true;
});
ipcMain.handle('ptt:capture', () => ptt.capture());
ipcMain.handle('ptt:names', () => ptt.KEY_NAMES);

const F9 = 0x78;
const KEYUP = 2;

/** Нажатие на уровне системы: так же, как с клавиатуры, в обход окна */
function osKey(flags) {
  const script = `Add-Type -Name K -Namespace E2E -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, System.UIntPtr e);'; [E2E.K]::keybd_event(${F9}, 0, ${flags}, [UIntPtr]::Zero)`;
  const run = spawnSync('powershell', ['-NoProfile', '-Command', script]);
  if (run.status !== 0) throw new Error(`Не нажать клавишу: ${run.stderr}`);
}

/** Сколько звука дошло до Бори (растёт, только если Аню слышно) */
const heard = (win) => js(win, `(async () => {
  let energy = 0;
  for (const p of activeSession().peers.values())
    (await p.link.pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio') energy += s.totalAudioEnergy || 0; });
  return energy;
})()`);

/** Прибавка звука у Бори за секунду */
async function gain(win) {
  const before = await heard(win);
  await sleep(1000);
  return (await heard(win)) - before;
}

runTest(async () => {
  const a = await register('ptta', 'Аня');
  const b = await register('pttb', 'Боря');
  await befriend(a, b);
  const winA = await openClient('ptta', a);
  const winB = await openClient('pttb', b);
  await waitFor(winA, 'e2eeReady()', 'ключ');

  // Назначаем клавишу так, как это делает человек: кнопка, нажатие, сохранить
  await js(winA, `openSettings(); showSettingsTab('sound'); true`);
  await sleep(300);
  await js(winA, `document.getElementById('ptt-assign').click(); true`);
  await sleep(500);
  osKey(0);
  osKey(KEYUP);
  await waitFor(winA, `document.getElementById('ptt-key').textContent.includes('F9')`, 'клавиша назначена');
  await js(winA, `document.querySelector('input[name="mic-mode"][value="ptt"]').checked = true; document.getElementById('settings-form').requestSubmit(); true`);
  await waitFor(winA, `state.settings.ptt && state.settings.pttBinding`, 'рация сохранена');
  await waitFor(winA, `document.getElementById('settings').classList.contains('hidden')`, 'настройки закрылись');
  console.log('✔ клавиша F9 назначена настоящим нажатием');

  await js(winA, `selectContact(${b.user.id}).then(() => startCall())`);
  await waitFor(winB, 'state.incoming !== null', 'входящий', 8000);
  await js(winB, 'acceptIncoming(); true');
  await waitFor(winA, `state.call?.phase === 'connected'`, 'разговор', 20000);
  await sleep(1500);

  const silent = await gain(winB);
  if (silent > 0.0005) throw new Error(`Клавишу не держат, а Аню слышно: ${silent}`);
  console.log('✔ клавиша отпущена — Боря не слышит Аню', silent);

  osKey(0);
  await waitFor(winA, 'state.pttDown === true', 'приложение увидело нажатие', 3000);
  await sleep(500);
  const loud = await gain(winB);
  if (loud <= 0.0005) throw new Error(`Клавишу держат, а звука нет: ${loud}`);
  console.log('✔ клавиша нажата — Боря слышит Аню', loud);

  osKey(KEYUP);
  await waitFor(winA, 'state.pttDown === false', 'приложение увидело отпускание', 3000);
  await sleep(800);
  const after = await gain(winB);
  if (after > 0.0005) throw new Error(`Клавишу отпустили, а Аню слышно: ${after}`);
  console.log('✔ клавишу отпустили — снова тихо', after);

  await js(winA, 'hangup(); true');
  ptt.stop();
});
