// Звуки приложения: каждый звучит, не перегружает (без хрипа) и затихает плавно, без щелчка в конце.
// E2E_SOUNDS=папка — ещё и сохранить их в .wav, чтобы послушать.
// Запуск (сервер не нужен): npx electron scripts/e2e-sounds.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function wav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
    await win.loadURL('about:blank');
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, '../renderer/call.js'), 'utf8').split('\nclass Tone')[0] + '; window.PATTERNS = PATTERNS; window.playPattern = playPattern; true');
    const kinds = await win.webContents.executeJavaScript('Object.keys(PATTERNS)');
    for (const kind of kinds) {
      const { rate, samples } = await win.webContents.executeJavaScript(`(async () => {
        const end = Math.max(...PATTERNS.${kind}.map(([at, dur]) => at + dur)) + 0.6;
        const ctx = new OfflineAudioContext(1, Math.ceil(44100 * end), 44100);
        playPattern(ctx, PATTERNS.${kind}, ${kind === 'ring' || kind === 'ringback' ? 0.12 : 0.08});
        const buf = await ctx.startRendering();
        return { rate: 44100, samples: [...buf.getChannelData(0)] };
      })()`);
      const peak = Math.max(...samples.map(Math.abs));
      const tail = Math.max(...samples.slice(-2205).map(Math.abs)); // последние 50 мс
      if (peak < 0.02) throw new Error(`${kind}: почти не слышно (${peak.toFixed(3)})`);
      if (peak > 0.6) throw new Error(`${kind}: слишком громко, будет хрипеть (${peak.toFixed(2)})`);
      if (tail > 0.002) throw new Error(`${kind}: обрывается щелчком (${tail.toFixed(4)})`);
      if (process.env.E2E_SOUNDS) fs.writeFileSync(path.join(process.env.E2E_SOUNDS, `${kind}.wav`), wav(samples, rate));
      console.log(`✔ ${kind}: пик ${peak.toFixed(2)}, затихает плавно`);
    }
    console.log('\nВсе проверки пройдены');
    app.exit(0);
  } catch (err) {
    console.error('✖', err.message);
    app.exit(1);
  }
});
