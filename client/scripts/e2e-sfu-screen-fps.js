// Трансляция в комнате (через медиасервер LiveKit) доходит до зрителя с заявленной частотой: на мониторе крутится
// анимация, Аня показывает экран, Боря смотрит — меряем, сколько кадров в секунду уходит и сколько доходит.
// Нужны LiveKit и наш сервер, как для e2e-sfu.js. Запуск: npx electron scripts/e2e-sfu-screen-fps.js
// E2E_FPS_MIN — сколько кадров/с считать нормой (по умолчанию 50)
const { app, BrowserWindow, powerSaveBlocker } = require('electron');
process.env.E2E_REAL_DEVICES = '1';
const { api, befriend, register, js, waitFor, sleep, openClient, tilePlaying, runTest } = require('./e2e-lib');

const MIN = Number(process.env.E2E_FPS_MIN) || 50;

runTest(async () => {
  powerSaveBlocker.start('prevent-display-sleep');
  const game = new BrowserWindow({ fullscreen: true, show: true, backgroundColor: '#000', webPreferences: { backgroundThrottling: false } });
  await game.loadURL('data:text/html,' + encodeURIComponent(`<canvas id=c style="width:100vw;height:100vh;display:block"></canvas><script>
    const c = document.getElementById('c'); c.width = innerWidth; c.height = innerHeight; const g = c.getContext('2d'); let t = 0;
    (function f() { t++; g.fillStyle = 'hsl(' + (t * 3 % 360) + ',70%,40%)'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff'; for (let i = 0; i < 40; i++) g.fillRect((t * 9 + i * 97) % c.width, (i * 53 + t * 4) % c.height, 120, 120);
      g.font = '120px monospace'; g.fillText(t, 100, 200); requestAnimationFrame(f); })();</script>`));

  const a = await register('ssa', 'Аня');
  const b = await register('ssb', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Игры' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  // В комнате от пятерых участников — медиасервер (LIVEKIT_MIN_MEMBERS); ещё трое только состоят в хабе
  for (const u of [b, ...(await Promise.all(['ssc', 'ssd', 'sse'].map((l) => register(l, l))))]) {
    if (u !== b) await befriend(a, u);
    if (u !== b) await api('POST', `/hubs/${hub.id}/invites`, { userIds: [u.user.id] }, a.token);
    await api('POST', `/hub-invites/${hub.id}/accept`, null, u.token);
  }
  const room = await api('POST', '/rooms', { name: 'Голос', kind: 'voice', hubId: hub.id }, a.token);
  const winA = await openClient('ssa', a);
  const winB = await openClient('ssb', b);
  for (const win of [winA, winB]) {
    await waitFor(win, `e2eeReady() && Boolean(roomById(${room.id}))`, 'вход и ключ');
    await js(win, `joinRoomVoice(${room.id}); true`);
    await sleep(400);
  }
  for (const win of [winA, winB]) await waitFor(win, 'state.room?.session instanceof SfuSession && state.room.session.peers.size === 1', 'оба в голосе через медиасервер', 30000).catch(async (err) => { console.error(await js(win, `JSON.stringify({ joined: state.room?.joined, kind: state.room?.session?.constructor.name, peers: state.room?.session?.peers.size, toast: document.getElementById('toast').textContent })`)); throw err; });
  // Поверх всех окон: иначе перекрытая «игра» почти не рисует и замер врёт
  game.setAlwaysOnTop(true, 'screen-saver');
  game.focus();

  const report = [];
  for (const mode of (process.env.E2E_MODES || '1440p60,1080p60').split(',')) {
    await js(winA, `(async () => {
      const sources = await window.desktop.screen.sources();
      await window.desktop.screen.choose(sources.find((s) => s.screen).id, false);
      await activeSession().startScreen({ mode: '${mode}' });
      return true;
    })()`);
    await js(winB, `activeSession().setWatching(${a.user.id}, true); true`);
    await waitFor(winB, tilePlaying(winB, `u${a.user.id}:screen`), 'трансляция у Бори', 20000);
    const out = () => js(winA, `(async () => { const o = { f: 0 }; (await activeSession().published.screen.sender.getStats()).forEach((s) => { if (s.type === 'outbound-rtp' && s.framesEncoded >= o.f) Object.assign(o, { f: s.framesEncoded, b: s.bytesSent, limit: s.qualityLimitationReason, target: s.targetBitrate }); if (s.type === 'media-source' && s.kind === 'video') o.src = s.framesPerSecond; }); o.how = activeSession().local.tracks.screen instanceof MediaStreamTrackGenerator ? 'свой' : 'Chromium'; return o; })()`);
    const sent = async () => (await out()).f;
    // Разгон: оценка канала и слои у медиасервера; E2E_TRACE=1 — печатать его посекундно
    for (let i = 0, prev = await out(); i < (Number(process.env.E2E_WARMUP) || 6000) / 1000; i++) {
      await sleep(1000);
      const now = await out();
      if (process.env.E2E_TRACE) console.log(`    ${i + 1} с: цель ${(now.target / 1e6).toFixed(1)} Мбит/с, ${now.f - prev.f} к/с, захват ${now.src}, игра ${await game.webContents.executeJavaScript('t')}, фокус ${game.isFocused()}`);
      prev = now;
    }
    const o1 = await out();
    const f1 = o1.f;
    // Сколько кадров получает Боря: читаем копию принятой дорожки 5 с
    const got = await js(winB, `(async () => {
      const t = activeSession().peers.get(${a.user.id}).tracks.screen.clone();
      const reader = new MediaStreamTrackProcessor({ track: t }).readable.getReader();
      let n = 0, w = 0; const start = performance.now();
      while (performance.now() - start < 5000) { const { value } = await reader.read(); w = value?.displayWidth || w; value?.close(); n++; }
      reader.cancel(); t.stop();
      return { fps: +(n / 5).toFixed(1), w };
    })()`);
    const o2 = await out();
    const encoded = (o2.f - f1) / 5;
    console.log(`  ${mode}: захват (${o2.how}) ${o2.src} к/с, ограничение ${o2.limit}, цель ${(o2.target / 1e6).toFixed(1)} Мбит/с, отправлено ${((o2.b - o1.b) * 8 / 5e6).toFixed(1)} Мбит/с`);
    report.push({ mode, encoded, received: got.fps });
    console.log(`  ${mode}: уходит ${encoded.toFixed(1)} к/с, Боря получает ${got.fps} к/с шириной ${got.w}`);
    await js(winA, 'activeSession().stopScreen(); true');
    await sleep(1500);
  }
  game.destroy();
  const bad = report.filter((r) => r.received < MIN);
  if (bad.length) throw new Error(`Через медиасервер не доходит 60 к/с: ${bad.map((r) => `${r.mode} — ${r.received}`).join('; ')}`);
  console.log(`✔ через медиасервер зритель получает не меньше ${MIN} к/с`);
});
