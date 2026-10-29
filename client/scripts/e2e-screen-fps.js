// Трансляция экрана держит заявленную частоту кадров: на экране крутится анимация (как в игре),
// Аня показывает экран Боре в каждом режиме, меряем, сколько кадров в секунду реально кодируется и доходит,
// каким кодировщиком и что ограничивает качество. Запуск (сервер должен работать): npx electron scripts/e2e-screen-fps.js
// Нужен настоящий захват экрана: process.env.E2E_REAL_DEVICES ставится до загрузки e2e-lib.
// E2E_FPS_MIN — сколько кадров/с считать нормой для режимов 60 (по умолчанию 55: свой захват монитора даёт ровные 60)
const { app, BrowserWindow, powerSaveBlocker } = require('electron');
process.env.E2E_REAL_DEVICES = '1';
const { befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const MIN = Number(process.env.E2E_FPS_MIN) || 55;

runTest(async () => {
  // Погасший экран не обновляется — захватывать нечего, замер врёт. Пока идёт тест, экран не гаснет
  powerSaveBlocker.start('prevent-display-sleep');
  // «Игра»: окно во весь экран с быстрой анимацией — чтобы захвату экрана было что передавать
  const game = new BrowserWindow({ fullscreen: true, show: true, backgroundColor: '#000', webPreferences: { backgroundThrottling: false } });
  await game.loadURL('data:text/html,' + encodeURIComponent(`<canvas id=c style="width:100vw;height:100vh;display:block"></canvas><script>
    const c = document.getElementById('c'); c.width = innerWidth; c.height = innerHeight; const g = c.getContext('2d'); let t = 0;
    (function f() { t++; g.fillStyle = 'hsl(' + (t * 3 % 360) + ',70%,40%)'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff'; for (let i = 0; i < 40; i++) g.fillRect((t * 9 + i * 97) % c.width, (i * 53 + t * 4) % c.height, 120, 120);
      g.font = '120px monospace'; g.fillText(t, 100, 200); requestAnimationFrame(f); })();</script>`));

  const a = await register('fa', 'Аня');
  const b = await register('fb', 'Боря');
  await befriend(a, b);
  const winA = await openClient('fa', a);
  const winB = await openClient('fb', b);
  // E2E_CODEC=H264 — для сравнения поставить другой кодек экрана первым
  if (process.env.E2E_CODEC) for (const w of [winA, winB]) await js(w, `{ const first = 'video/${process.env.E2E_CODEC}'; const rest = SCREEN_CODECS.filter((x) => x !== first); SCREEN_CODECS.splice(0, SCREEN_CODECS.length, first, ...rest); } true`);
  await js(winA, `selectContact(${b.user.id}).then(() => startCall())`);
  await waitFor(winB, `!document.getElementById('incoming').classList.contains('hidden')`, 'входящий звонок');
  await js(winB, 'acceptIncoming()');
  await waitFor(winA, `state.call?.phase === 'connected'`, 'звонок', 20000);
  game.focus();
  game.moveTop();

  const report = [];
  for (const mode of ['1440p60', '1080p60', '720p90']) {
    await js(winA, `(async () => {
      const sources = await window.desktop.screen.sources();
      await window.desktop.screen.choose(sources.find((s) => s.screen).id, false);
      await activeSession().startScreen({ mode: '${mode}' });
      return true;
    })()`);
    // Боря смотрит трансляцию (без этого Аня ему экран не шлёт)
    await js(winB, `activeSession().setWatching(${a.user.id}, true); true`);
    await sleep(4000); // разгон: кодировщик и оценка канала
    const sample = () =>
      js(winA, `(async () => {
        const out = {};
        for (const p of activeSession().peers.values()) (await p.link.pc.getStats()).forEach((s) => {
          if (s.type === 'outbound-rtp' && s.kind === 'video' && s.frameWidth >= 1000) Object.assign(out, { frames: s.framesEncoded, w: s.frameWidth, h: s.frameHeight, enc: s.encoderImplementation, limit: s.qualityLimitationReason, codec: s.codecId, sent: s.framesSent, sourceId: s.mediaSourceId });
          if (s.type === 'media-source' && s.kind === 'video' && s.width >= 1000) out.captured = s.framesPerSecond;
        });
        const sender = [...activeSession().peers.values()][0].link.transceiver('screen').sender;
        const p = sender.getParameters();
        out.params = JSON.stringify({ deg: p.degradationPreference, enc: p.encodings.map((e) => ({ fps: e.maxFramerate, br: e.maxBitrate, scale: e.scaleResolutionDownBy })) });
        const track = activeSession().local.tracks.screen;
        out.source = (track instanceof MediaStreamTrackGenerator ? 'свой ' : 'Chromium ') + (track?.getSettings().frameRate ?? '');
        return out;
      })()`);
    // Сколько кадров даёт сама дорожка захвата прямо сейчас (копия, без отрисовки)
    const trackFps = await js(winA, `(async () => {
      const t = activeSession().local.tracks.screen.clone();
      const reader = new MediaStreamTrackProcessor({ track: t }).readable.getReader();
      let n = 0; const start = performance.now();
      while (performance.now() - start < 3000) { const { value } = await reader.read(); value?.close(); n++; }
      reader.cancel(); t.stop();
      return (n / 3).toFixed(1);
    })()`);
    console.log(`  ${mode}: дорожка захвата даёт ${trackFps} к/с`);
    const cpuOf = () => app.getAppMetrics().find((m) => m.pid === winA.webContents.getOSProcessId())?.cpu.percentCPUUsage;
    cpuOf();
    const s1 = await sample();
    await sleep(5000);
    const s2 = await sample();
    const cpu = cpuOf();
    const fpsOut = (s2.frames - s1.frames) / 5;
    const received = await js(winB, `(async () => {
      let r = 0; for (const p of activeSession().peers.values()) (await p.link.pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video' && s.frameWidth >= 1000) r = s.framesPerSecond || r; }); return r; })()`);
    const codec = await js(winA, `(async () => { for (const p of activeSession().peers.values()) { const st = await p.link.pc.getStats(); return st.get(${JSON.stringify(s2.codec || '')})?.mimeType || '?'; } })()`);
    report.push({ mode, size: `${s2.w}x${s2.h}`, encodedFps: fpsOut.toFixed(1), receivedFps: received, codec, encoder: s2.enc, limit: s2.limit });
    console.log(`  ${mode}: захват ${s2.source}, ${s2.w}×${s2.h}, кодируется ${fpsOut.toFixed(1)} к/с, доходит ${received} к/с, ${codec} (${s2.enc}), ограничение: ${s2.limit}, процессор отправителя ${cpu?.toFixed(0)}%; в WebRTC с захвата ${s2.captured} к/с; ${s2.params}`);
    await js(winA, 'activeSession().stopScreen(); true');
    await sleep(1500);
  }
  game.destroy();
  const bad = report.filter((r) => r.mode.endsWith('60') && Number(r.encodedFps) < MIN);
  if (bad.length) throw new Error(`Трансляция не держит 60 к/с: ${bad.map((r) => `${r.mode} — ${r.encodedFps} (${r.encoder}, ${r.limit})`).join('; ')}`);
  console.log(`✔ режимы 60 к/с держат не меньше ${MIN} кадров в секунду`);
});
