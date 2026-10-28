// Проба (не тест): исключает ли restrictOwnAudio звук самого приложения из захвата звука экрана.
// Страница играет тон 440 Гц и захватывает звук компьютера с этой настройкой и без неё.
// Запуск: npx electron scripts/probe-own-audio.js
const { app, BrowserWindow, desktopCapturer, session } = require('electron');

app.whenReady().then(async () => {
  console.log('chrome', process.versions.chrome);
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const [screen] = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: screen, audio: 'loopback' });
  });
  const win = new BrowserWindow({ show: false, webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false } });
  await win.loadURL('data:text/html,<body>probe</body>');
  const result = await win.webContents.executeJavaScript(`(async () => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    const gain = ctx.createGain();
    gain.gain.value = 0.3;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    await ctx.resume();
    const level = async (restrict) => {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: restrict ? { restrictOwnAudio: true } : true });
      const track = stream.getAudioTracks()[0];
      if (!track) return { restrict, error: 'нет звуковой дорожки' };
      const settings = track.getSettings();
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      src.connect(an);
      await new Promise((r) => setTimeout(r, 1500));
      const buf = new Float32Array(an.fftSize);
      let peak = 0;
      for (let i = 0; i < 10; i++) {
        an.getFloatTimeDomainData(buf);
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        await new Promise((r) => setTimeout(r, 50));
      }
      stream.getTracks().forEach((t) => t.stop());
      return { restrict, peak: Math.round(peak * 1000) / 1000, restrictSetting: settings.restrictOwnAudio, supported: navigator.mediaDevices.getSupportedConstraints().restrictOwnAudio };
    };
    return [await level(false), await level(true)];
  })()`);
  console.log(JSON.stringify(result));
  app.exit(0);
});
