// Сквозной тест звонка один на один: два окна с виртуальными микрофоном и камерой звонят друг другу.
// Запуск (сервер должен работать): npx electron scripts/e2e-call.js [адрес сервера]
// E2E_RELAY=1 — только через TURN, E2E_SHOTS=папка — скриншоты, E2E_SHOW=1 — показать окна
const { api, befriend, register, js, waitFor, sleep, openClient, received, tilePlaying, screenshot, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('a', 'Тест А');
  const b = await register('b', 'Тест Б');
  await befriend(a, b);

  const winA = await openClient('a', a);
  const winB = await openClient('b', b);
  console.log('✔ оба клиента вошли и подключились');

  if (process.env.E2E_RELAY === '1') {
    for (const win of [winA, winB]) {
      await js(win, `{
        const Orig = RTCPeerConnection;
        window.RTCPeerConnection = function (cfg) { return new Orig({ ...cfg, iceTransportPolicy: 'relay' }); };
      } true`);
    }
  }

  await js(winA, `selectContact(${b.user.id}).then(() => startCall())`);
  await waitFor(winB, `!document.getElementById('incoming').classList.contains('hidden')`, 'входящий звонок у Б');
  console.log('✔ у Б появился входящий звонок');

  await js(winB, 'acceptIncoming()');
  const connected = `state.call?.phase === 'connected'`;
  await waitFor(winA, connected, 'соединение у А');
  await waitFor(winB, connected, 'соединение у Б');
  console.log('✔ WebRTC-соединение установлено');

  const before = [(await received(winA))[b.user.id].audio, (await received(winB))[a.user.id].audio];
  await sleep(2000);
  const after = [(await received(winA))[b.user.id].audio, (await received(winB))[a.user.id].audio];
  if (!(after[0] > before[0] && after[1] > before[1])) throw new Error(`Звук не идёт: ${before} -> ${after}`);
  console.log(`✔ звук идёт в обе стороны (получено байт: А ${after[0]}, Б ${after[1]})`);

  // Камера включается посреди разговора, без переподключения
  await js(winA, 'toggleCamera()');
  await waitFor(winB, tilePlaying(winB, `u${a.user.id}`), 'видео А у Б');
  await waitFor(winA, tilePlaying(winA, 'me'), 'своё видео у А');
  console.log('✔ видео с камеры А видно у Б');

  await waitFor(winA, `activeSession().worstQuality()?.rtt != null`, 'качество связи');
  console.log('✔ качество связи:', await js(winA, 'qualityText(activeSession().worstQuality())'));
  await screenshot(winA, 'call-a');
  await screenshot(winB, 'call-b');

  await js(winA, 'toggleCamera()');
  await waitFor(winB, `!document.querySelector('.tile[data-key="u${a.user.id}"]').classList.contains('has-video')`, 'камера выключилась у Б');
  console.log('✔ камера выключается');

  await js(winA, 'toggleMute()');
  if (!(await js(winA, 'state.call.session.local.tracks.mic.enabled === false'))) throw new Error('Микрофон не выключился');
  await waitFor(winB, `document.querySelector('.tile[data-key="u${a.user.id}"] .tile-icons svg') !== null`, 'значок выключенного микрофона у Б');
  await js(winA, 'toggleMute()');
  console.log('✔ выключение микрофона работает и видно собеседнику');

  await js(winA, 'hangup()');
  await waitFor(winB, 'state.call === null', 'завершение звонка у Б');
  console.log('✔ звонок завершился у обоих');
});
