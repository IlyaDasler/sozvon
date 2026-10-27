// Сквозной тест звонка: два окна приложения с виртуальными микрофонами звонят друг другу.
// Запуск (сервер должен работать): npx electron scripts/e2e-call.js [адрес сервера]
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

const SERVER = process.argv.find((a) => /^https?:\/\//.test(a)) || 'http://localhost:3000';

app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body, token) {
  const res = await fetch(`${SERVER}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

async function waitFor(win, expr, what, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await win.webContents.executeJavaScript(expr)) return;
    await sleep(200);
  }
  throw new Error(`Не дождались: ${what}`);
}

async function openClient(name, auth) {
  const ses = session.fromPartition(`e2e-${name}`);
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(true));
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 720,
    webPreferences: { session: ses, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await win.webContents.executeJavaScript(
    `localStorage.setItem('session', ${JSON.stringify(JSON.stringify({ base: SERVER, token: auth.token }))}); location.reload()`
  );
  await sleep(500);
  await waitFor(win, `document.getElementById('conn-dot').classList.contains('ok')`, `${name}: подключение`);
  return win;
}

const bytesReceived = (win) =>
  win.webContents.executeJavaScript(`
    state.call.call.pc.getStats().then((stats) => {
      let bytes = 0;
      stats.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio') bytes += s.bytesReceived; });
      return bytes;
    })
  `);

async function run() {
  const suffix = Date.now().toString(36).slice(-5);
  // E2E_INVITE — код приглашения, если сервер его требует
  const inviteCode = process.env.E2E_INVITE;
  const a = await api('POST', '/register', { username: `e2e_a_${suffix}`, password: 'test123', displayName: 'Тест А', inviteCode });
  const b = await api('POST', '/register', { username: `e2e_b_${suffix}`, password: 'test123', displayName: 'Тест Б', inviteCode });
  await api('POST', '/contacts', { username: b.user.username }, a.token);

  const winA = await openClient('a', a);
  const winB = await openClient('b', b);
  console.log('✔ оба клиента вошли и подключились');

  // E2E_RELAY=1 — пускать звук только через TURN, чтобы проверить ретранслятор
  if (process.env.E2E_RELAY === '1') {
    for (const win of [winA, winB]) {
      await win.webContents.executeJavaScript(`{
        const Orig = RTCPeerConnection;
        window.RTCPeerConnection = function (cfg) { return new Orig({ ...cfg, iceTransportPolicy: 'relay' }); };
      } true`);
    }
  }

  await winA.webContents.executeJavaScript(`selectContact(${b.user.id}).then(() => startCall())`);
  await waitFor(winB, `!document.getElementById('incoming').classList.contains('hidden')`, 'входящий звонок у Б');
  console.log('✔ у Б появился входящий звонок');

  await winB.webContents.executeJavaScript('acceptIncoming()');
  const connected = `state.call?.call.state === 'connected'`;
  await waitFor(winA, connected, 'соединение у А');
  await waitFor(winB, connected, 'соединение у Б');
  console.log('✔ WebRTC-соединение установлено');

  const before = [await bytesReceived(winA), await bytesReceived(winB)];
  await sleep(2000);
  const after = [await bytesReceived(winA), await bytesReceived(winB)];
  if (!(after[0] > before[0] && after[1] > before[1])) throw new Error(`Звук не идёт: ${before} -> ${after}`);
  console.log(`✔ звук идёт в обе стороны (получено байт: А ${after[0]}, Б ${after[1]})`);

  // E2E_SHOTS=папка — сохранить скриншоты окон во время звонка
  if (process.env.E2E_SHOTS) {
    for (const [name, win] of [['a', winA], ['b', winB]]) {
      const image = await win.webContents.capturePage();
      require('node:fs').writeFileSync(path.join(process.env.E2E_SHOTS, `call-${name}.png`), image.toPNG());
    }
  }

  await winA.webContents.executeJavaScript('toggleMute()');
  const muted = await winA.webContents.executeJavaScript(
    'state.call.call.localStream.getAudioTracks().every((t) => !t.enabled)'
  );
  if (!muted) throw new Error('Микрофон не выключился');
  await winA.webContents.executeJavaScript('toggleMute()');
  console.log('✔ выключение микрофона работает');

  await winA.webContents.executeJavaScript('hangup()');
  await waitFor(winB, 'state.call === null', 'завершение звонка у Б');
  console.log('✔ звонок завершился у обоих');
}

app.whenReady().then(async () => {
  try {
    await run();
    console.log('\nВсе проверки пройдены');
    app.exit(0);
  } catch (err) {
    console.error('✖', err.message);
    app.exit(1);
  }
});
