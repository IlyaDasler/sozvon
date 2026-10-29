// Шумоподавление нейросетью: на вход — шум (как вентилятор или улица), на выходе он должен стать намного тише;
// живой микрофон проходит через нейросеть и не ломается. Сервер не нужен: npx electron scripts/e2e-noise.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), backgroundThrottling: false } });
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    const js = (code) => win.webContents.executeJavaScript(code, true);
    win.webContents.on('console-message', (e) => e.level !== 'info' && e.level !== 'debug' && console.log('  [страница]', e.message.slice(0, 300)));

    // Офлайн-обработка: 3 с чистого шума (меряем последнюю секунду — нейросеть успела подстроиться), потом речь (записана синтезатором Windows) с тем же шумом.
    // Шум в паузе должен уйти, а голос — остаться (иначе «шумоподавление» просто глушит всё)
    const speech = fs.readFileSync(path.join(__dirname, 'speech-sample.wav')).toString('base64');
    const result = await js(`(async () => {
      const rate = 48000;
      const clean = (await new AudioContext({ sampleRate: rate }).decodeAudioData(Uint8Array.from(atob('${speech}'), (c) => c.charCodeAt(0)).buffer)).getChannelData(0);
      const lead = rate * 3, total = lead + clean.length;
      // В реальном времени, как живой микрофон: нейросеть в обработчике запускается не сразу
      const ctx = new AudioContext({ sampleRate: rate });
      const buf = ctx.createBuffer(1, total, rate);
      const mix = buf.getChannelData(0);
      const noise = (i) => (Math.sin(i * 0.37) * 0.3 + Math.random() * 2 - 1) * 0.06; // гул и шипение
      for (let i = 0; i < total; i++) mix[i] = noise(i) + (i >= lead ? clean[i - lead] : 0);
      const node = await noiseSuppressorNode(ctx);
      const dest = ctx.createMediaStreamDestination();
      node.connect(dest);
      await new Promise((r) => setTimeout(r, 1000)); // нейросеть загрузилась
      const reader = new MediaStreamTrackProcessor({ track: dest.stream.getAudioTracks()[0] }).readable.getReader();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(node);
      src.start();
      const out = new Float32Array(total);
      let n = 0;
      while (n < total) {
        const { value } = await reader.read();
        const part = new Float32Array(value.numberOfFrames);
        value.copyTo(part, { planeIndex: 0, format: 'f32-planar' });
        value.close();
        out.set(part.subarray(0, total - n), n);
        n += part.length;
      }
      reader.cancel();
      ctx.close();
      const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
      return {
        noiseIn: rms(mix.subarray(rate * 2, lead)), noiseOut: rms(out.subarray(rate * 2, lead)),
        speechClean: rms(clean), speechOut: rms(out.subarray(lead)),
      };
    })()`);
    const dB = (a, b) => 20 * Math.log10(a / b);
    const noiseDb = dB(result.noiseOut + 1e-9, result.noiseIn);
    const speechDb = dB(result.speechOut, result.speechClean);
    console.log(`  шум в паузе: ${noiseDb.toFixed(1)} дБ; голос: ${speechDb.toFixed(1)} дБ от чистого`);
    if (!(noiseDb < -15)) throw new Error(`Нейросеть почти не подавила шум: ${noiseDb.toFixed(1)} дБ`);
    if (!(speechDb > -6)) throw new Error(`Нейросеть глушит и голос: ${speechDb.toFixed(1)} дБ`);
    console.log('✔ нейросеть убирает шум (тише больше чем на 15 дБ), а голос оставляет');

    // Микрофон часто отдаёт два канала: после нейросети голос слышен в обоих ушах, а не только в левом
    const ears = await js(`(async () => {
      const rate = 48000;
      const clean = (await new AudioContext({ sampleRate: rate }).decodeAudioData(Uint8Array.from(atob('${speech}'), (c) => c.charCodeAt(0)).buffer)).getChannelData(0);
      const ctx = new AudioContext({ sampleRate: rate });
      const buf = ctx.createBuffer(2, clean.length, rate);
      buf.copyToChannel(clean, 0);
      buf.copyToChannel(clean, 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const stereo = ctx.createMediaStreamDestination();
      stereo.channelCount = 2;
      src.connect(stereo);
      const chain = await denoiseTrack(stereo.stream.getAudioTracks()[0]);
      // Как собеседник: дорожку играют в стерео
      const out = new AudioContext({ sampleRate: rate });
      const split = out.createChannelSplitter(2);
      out.createMediaStreamSource(new MediaStream([chain.track])).connect(split);
      const meters = [0, 1].map((ch) => { const a = out.createAnalyser(); split.connect(a, ch); return a; });
      await new Promise((r) => setTimeout(r, 1000)); // нейросеть загрузилась
      src.start();
      const sum = [0, 0];
      const data = new Float32Array(2048);
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 50));
        meters.forEach((a, ch) => { a.getFloatTimeDomainData(data); sum[ch] += data.reduce((s, v) => s + v * v, 0); });
      }
      chain.stop();
      out.close();
      ctx.close();
      return sum;
    })()`);
    console.log(`  громкость: левое ${ears[0].toFixed(2)}, правое ${ears[1].toFixed(2)}`);
    if (!(ears[0] > 0.01) || !(ears[1] > ears[0] * 0.5)) throw new Error(`Голос только в одном ухе: левое ${ears[0].toFixed(3)}, правое ${ears[1].toFixed(3)}`);
    console.log('✔ после нейросети голос слышен в обоих ушах');

    // Живой микрофон: с шумоподавлением дорожка идёт через нейросеть, звук не пропадает
    const live = await js(`(async () => {
      const local = new LocalMedia(() => {});
      await local.openMic({ micId: '', noiseSuppression: true });
      const track = local.tracks.mic;
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      ctx.createMediaStreamSource(new MediaStream([track])).connect(an);
      const buf = new Float32Array(an.fftSize);
      let peak = 0;
      for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 50)); an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); }
      const viaNet = Boolean(local.micChain);
      const live = track.readyState;
      local.close();
      return { viaNet, live, peak };
    })()`);
    if (!live.viaNet || live.live !== 'live') throw new Error('Микрофон идёт мимо нейросети или дорожка не живая');
    console.log(`  микрофон через нейросеть: дорожка ${live.live}, пик ${live.peak.toFixed(3)}`);
    console.log('✔ живой микрофон проходит через нейросеть');
    console.log('\nВсе проверки пройдены');
    app.exit(0);
  } catch (err) {
    console.error('✖', err.message);
    app.exit(1);
  }
});
