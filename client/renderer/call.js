// Звонки через WebRTC: звук, камера и демонстрация экрана, звуки вызова и индикатор «говорит».
// Один и тот же код работает и для звонка один на один, и для голосовой комнаты (там каждый соединён с каждым).

// Звуки генерируются на лету, без аудиофайлов. Паттерн: [начало, длительность, частота] — ноты.
// Каждая нота — мягкий «колокольчик»: чистый тон с тихими обертонами, быстро звучит и плавно тает,
// а общий фильтр срезает резкость и даёт лёгкое эхо. Ноты — из пентатоники, поэтому всё звучит созвучно.
const PATTERNS = {
  // Входящий звонок: узнаваемый мотив вверх-вниз (соль — си — ре — си), повторяется
  ring: [[0, 0.55, 784], [0.15, 0.55, 988], [0.3, 0.6, 1175], [0.52, 1.1, 988]],
  // Ждём ответа: два тихих низких тона
  ringback: [[0, 1.2, 523], [0.5, 1.4, 659]],
  end: [[0, 0.45, 659], [0.16, 0.8, 494]],
  mute: [[0, 0.25, 440]],
  unmute: [[0, 0.25, 659]],
  join: [[0, 0.35, 587], [0.1, 0.6, 880]],
  leave: [[0, 0.35, 880], [0.1, 0.6, 587]],
  test: [[0, 0.5, 523], [0.18, 0.5, 659], [0.36, 0.5, 784], [0.54, 1.0, 1047]],
  notify: [[0, 0.3, 1047], [0.1, 0.7, 1568]],
};

// Обертоны колокольчика: [во сколько раз выше, громкость]
const BELL = [[1, 1], [2, 0.16], [3.01, 0.05]];

function playPattern(ctx, pattern, volume = 0.12) {
  const now = ctx.currentTime + 0.02;
  // Общий выход: мягкий фильтр и короткое тихое эхо
  const out = ctx.createBiquadFilter();
  out.type = 'lowpass';
  out.frequency.value = 3800;
  const echo = ctx.createDelay();
  echo.delayTime.value = 0.16;
  const echoGain = ctx.createGain();
  echoGain.gain.value = 0.18;
  out.connect(ctx.destination);
  out.connect(echo).connect(echoGain).connect(ctx.destination);
  for (const [at, dur, freq] of pattern) {
    const t = now + at;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(volume, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(out);
    for (const [mult, level] of BELL) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  }
}

// Звуки играют в выбранные в настройках динамики
function newAudioContext(sinkId) {
  if (sinkId) {
    try {
      return new AudioContext({ sinkId });
    } catch {}
  }
  return new AudioContext();
}

class Tone {
  constructor() {
    this.ctx = null;
    this.timer = null;
    this.sinkId = '';
  }

  /** Повторяющийся сигнал: 'ring' — входящий, 'ringback' — исходящий. Свой звук (sounds.js) — вместо стандартного */
  loop(kind) {
    this.stop();
    this.ctx = newAudioContext(this.sinkId);
    const length = this.play(this.ctx, kind, 0.12);
    const every = length ? Math.max(length * 1000 + 600, 2000) : kind === 'ring' ? 2400 : 3600;
    this.timer = setInterval(() => this.play(this.ctx, kind, 0.12), every);
  }

  /** Сыграть звук события: свой файл, если выбран, иначе стандартный. Возвращает длину своего (с) или 0 */
  play(ctx, kind, volume) {
    const custom = typeof customSounds !== 'undefined' && customSounds.get(kind);
    if (!custom) {
      playPattern(ctx, PATTERNS[kind], volume);
      this.lastPlayed = `pattern:${kind}`;
      return 0;
    }
    const src = ctx.createBufferSource();
    src.buffer = custom.buffer;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, volume * 6); // свои файлы обычно уже нормальной громкости
    src.connect(gain).connect(ctx.destination);
    src.start();
    this.lastPlayed = `custom:${kind}`;
    return custom.buffer.duration;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.ctx?.close();
    this.ctx = null;
  }

  /** Короткий одиночный звук: 'end', 'mute', 'unmute', 'join', 'leave', 'test' */
  blip(kind, sinkId = this.sinkId, volume = 0.08) {
    const ctx = newAudioContext(sinkId);
    const length = this.play(ctx, kind, volume);
    setTimeout(() => ctx.close(), Math.max(2000, length * 1000 + 500));
  }
}

// Следит за громкостью потока и сообщает, когда человек начинает и перестаёт говорить.
// onLevel (необязательно) получает громкость 0..1 — для полоски проверки микрофона
let meterCtx = null;

class LevelMeter {
  constructor(stream, onChange, onLevel) {
    meterCtx ??= new AudioContext();
    if (meterCtx.state === 'suspended') meterCtx.resume();
    const analyser = meterCtx.createAnalyser();
    analyser.fftSize = 512;
    this.source = meterCtx.createMediaStreamSource(stream);
    this.source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let speaking = false;
    let lastLoud = 0;

    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      onLevel?.(Math.min(1, rms * 6));
      const now = performance.now();
      if (rms > 0.015) lastLoud = now;
      const next = now - lastLoud < 300;
      if (next !== speaking) onChange?.((speaking = next));
    }, 60);
  }

  stop() {
    clearInterval(this.timer);
    this.source.disconnect();
  }
}

// Шумоподавление нейросетью RNNoise (vendor/noise, MIT/BSD): звук микрофона чистится на этом компьютере —
// клавиатура, вентилятор, улица. Встроенное шумоподавление браузера при этом выключено, чтобы не портить голос дважды
let rnnoiseWasm = null;
async function noiseSuppressorNode(ctx) {
  const ns = await import('./vendor/noise/index.js');
  rnnoiseWasm ??= ns.loadRnnoise({ url: 'vendor/noise/rnnoise.wasm', simdUrl: 'vendor/noise/rnnoise_simd.wasm' });
  rnnoiseWasm.catch(() => (rnnoiseWasm = null));
  await ctx.audioWorklet.addModule('vendor/noise/rnnoise/workletProcessor.js');
  return new ns.RnnoiseWorkletNode(ctx, { wasmBinary: await rnnoiseWasm, maxChannels: 1 });
}

/** Дорожка микрофона через нейросеть: { track — очищенная, stop() — отпустить всё } */
async function denoiseTrack(raw) {
  const ctx = new AudioContext({ sampleRate: 48000 });
  try {
    const node = await noiseSuppressorNode(ctx);
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(new MediaStream([raw])).connect(node).connect(dest);
    const track = dest.stream.getAudioTracks()[0];
    return {
      track,
      stop() {
        track.stop();
        raw.stop();
        node.destroy?.();
        ctx.close().catch(() => {});
      },
    };
  } catch (err) {
    ctx.close().catch(() => {});
    throw err;
  }
}

function micConstraints(settings) {
  return {
    audio: {
      deviceId: settings.micId ? { ideal: settings.micId } : undefined,
      // Эхоподавление нужно всегда, иначе без наушников друзья слышат сами себя
      echoCancellation: true,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: true,
    },
  };
}

function cameraConstraints(settings) {
  return {
    video: {
      deviceId: settings.camId ? { ideal: settings.camId } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  };
}

// Режимы демонстрации экрана: разрешение, частота кадров и скорость на одного зрителя.
// При нехватке скорости держим плавность; галочка «Для текста» (text) — держим чёткость
const SCREEN_MODES = {
  '1440p60': { width: 2560, height: 1440, frameRate: 60, bitrate: 14_000_000 },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, bitrate: 9_000_000 },
  '720p90': { width: 1280, height: 720, frameRate: 90, bitrate: 7_000_000 },
};
const DEFAULT_SCREEN_MODE = '1080p60';
// Режимы версий до 2.2 (сохранённые в настройках) — на ближайшие новые
const OLD_SCREEN_MODES = { motion: '720p90', detail: '1080p60' };
const screenMode = (id) => SCREEN_MODES[OLD_SCREEN_MODES[id] || id] ? OLD_SCREEN_MODES[id] || id : DEFAULT_SCREEN_MODE;

// Кодек для экрана: VP9 даёт картинку чище при той же скорости, H.264 — запасной (часто аппаратный)
const SCREEN_CODECS = ['video/VP9', 'video/H264', 'video/VP8'];
function preferScreenCodecs(transceiver) {
  const caps = RTCRtpReceiver.getCapabilities?.('video');
  if (!caps || !transceiver.setCodecPreferences) return;
  const rank = (c) => (SCREEN_CODECS.indexOf(c.mimeType) + SCREEN_CODECS.length + 1) % (SCREEN_CODECS.length + 1);
  const codecs = [...caps.codecs].sort((a, b) => rank(a) - rank(b));
  try {
    transceiver.setCodecPreferences(codecs);
  } catch {}
}

// Каждое соединение несёт четыре «слота» в одном и том же порядке. Включить камеру или экран —
// значит просто подставить дорожку в готовый слот, без пересогласования соединения
const SLOTS = ['mic', 'cam', 'screen', 'screenAudio'];
const SLOT_KIND = { mic: 'audio', cam: 'video', screen: 'video', screenAudio: 'audio' };

// Голос в Opus — 64 кбит/с вместо 32 по умолчанию, с защитой от потерь пакетов.
// Видео сразу стартует с 2,5 Мбит/с, а не разгоняется с малого — первые секунды трансляции не «мыльные»
const tuneSdp = (sdp) =>
  sdp
    .replace(/a=fmtp:(\d+) (.*useinbandfec=1.*)/g, (line, pt, params) =>
      params.includes('maxaveragebitrate') ? line : `a=fmtp:${pt} ${params};maxaveragebitrate=64000`
    )
    .replace(/a=fmtp:(\d+) ((?:.*;)?(?:profile-id|level-asymmetry-allowed|x-google)[^\r\n]*)/g, (line, pt, params) =>
      params.includes('x-google-start-bitrate') ? line : `a=fmtp:${pt} ${params};x-google-start-bitrate=2500;x-google-min-bitrate=800`
    );

// Свои микрофон, камера и экран — общие для всех соединений звонка
class LocalMedia {
  constructor(onChange) {
    this.tracks = { mic: null, cam: null, screen: null, screenAudio: null };
    this.muted = false;
    this.screenMode = DEFAULT_SCREEN_MODE;
    this.screenText = false;
    this.onChange = onChange;
  }

  async openMic(settings) {
    // Пока старый микрофон открыт, Chrome отдаёт новый с той же обработкой звука —
    // и шумоподавление не переключилось бы. Поэтому старый закрываем заранее
    this.tracks.mic?.stop();
    this.micChain?.stop();
    this.micChain = null;
    const neural = settings.noiseSuppression;
    const stream = await navigator.mediaDevices.getUserMedia(micConstraints({ ...settings, noiseSuppression: false }));
    let track = stream.getAudioTracks()[0];
    if (neural) {
      try {
        this.micChain = await denoiseTrack(track);
        track = this.micChain.track;
      } catch (err) {
        // Нейросеть не загрузилась — хотя бы встроенное шумоподавление браузера
        console.warn('Шумоподавление нейросетью недоступно:', err.message);
        await track.applyConstraints({ ...micConstraints(settings).audio, deviceId: undefined }).catch(() => {});
      }
    }
    if (this.closed) return this.micChain?.stop() ?? track.stop();
    track.enabled = !this.muted;
    this.replace('mic', track);
  }

  async startCamera(settings) {
    const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(settings));
    const track = stream.getVideoTracks()[0];
    track.contentHint = 'motion';
    track.onended = () => this.replace('cam', null);
    this.replace('cam', track);
  }

  stopCamera() {
    this.replace('cam', null);
  }

  /** mode — один из SCREEN_MODES; text — держать чёткость (мелкий текст, код), а не плавность */
  async startScreen({ mode = DEFAULT_SCREEN_MODE, text = false, audio = false } = {}) {
    const id = screenMode(mode);
    const m = SCREEN_MODES[id];
    const limits = { width: { max: m.width }, height: { max: m.height }, frameRate: { ideal: m.frameRate, max: m.frameRate } };
    // Звук компьютера — без звука самого Созвона: иначе друзья слышат в трансляции собственные голоса
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: limits, audio: audio && { restrictOwnAudio: true, suppressLocalAudioPlayback: false } });
    const video = stream.getVideoTracks()[0];
    video.contentHint = text ? 'detail' : 'motion';
    // «Остановить показ» из системы или закрытое окно — заканчиваем демонстрацию
    video.onended = () => this.stopScreen();
    this.screenMode = id;
    this.screenText = text;
    this.replace('screenAudio', stream.getAudioTracks()[0] || null);
    this.replace('screen', video);
  }

  stopScreen() {
    this.replace('screenAudio', null);
    this.replace('screen', null);
  }

  replace(slot, track) {
    // Звонок уже завершили, пока открывалось устройство, — сразу его отпускаем
    if (this.closed) return track?.stop();
    const old = this.tracks[slot];
    if (old === track) return;
    if (old) {
      old.onended = null;
      old.stop();
    }
    this.tracks[slot] = track;
    this.onChange(slot);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.tracks.mic) this.tracks.mic.enabled = !muted;
  }

  close() {
    this.closed = true;
    this.micChain?.stop();
    this.micChain = null;
    for (const slot of SLOTS) {
      if (this.tracks[slot]) this.tracks[slot].onended = null;
      this.tracks[slot]?.stop();
      this.tracks[slot] = null;
    }
  }
}

// Соединение с одним собеседником. Предложение (offer) делает только initiator, второй лишь отвечает —
// поэтому встречных предложений не бывает
class PeerLink {
  constructor({ iceServers, certificate, initiator, local, send, onTrack, onState, onMedia, onFingerprint }) {
    this.initiator = initiator;
    this.local = local;
    this.screenWanted = true; // смотрит ли собеседник нашу трансляцию; версии до 2.4 не говорят — значит, да
    this.send = send;
    this.onMedia = onMedia;
    this.onFingerprint = onFingerprint;
    this.bound = false;
    this.pending = [];
    this.queue = Promise.resolve();
    this.prev = { lost: 0, received: 0 };
    this.id = Math.random().toString(36).slice(2, 10);
    // Все дорожки в одном «потоке» — так их правильно разберут и версии приложения до 1.5
    this.msid = new MediaStream();

    // Один сертификат на все соединения звонка — тогда у каждого участника один ключ и код у всех общий
    const pc = (this.pc = new RTCPeerConnection({ iceServers, ...(certificate && { certificates: [certificate] }) }));
    pc.onicecandidate = (e) => e.candidate && send({ candidate: e.candidate });
    pc.ontrack = (e) => {
      const slot = SLOTS[pc.getTransceivers().indexOf(e.transceiver)];
      if (slot) onTrack(slot, e.track);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') for (const slot of SLOTS) this.tune(slot);
      // Сеть сменилась или оборвалась — пробуем заново подобрать маршрут
      if (st === 'failed' && initiator) pc.restartIce();
      onState(st);
    };

    if (initiator) {
      for (const slot of SLOTS) {
        const t = pc.addTransceiver(this.localTrack(slot) || SLOT_KIND[slot], { direction: 'sendrecv', streams: [this.msid] });
        if (slot === 'screen') preferScreenCodecs(t);
      }
      this.bound = true;
      pc.onnegotiationneeded = () => this.enqueue(() => this.offer());
    }
  }

  async offer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription({ type: 'offer', sdp: tuneSdp(offer.sdp) });
    this.send({ sdp: this.pc.localDescription });
  }

  // Сигналы обрабатываем строго по очереди, иначе кандидаты могут обогнать SDP
  enqueue(task) {
    this.queue = this.queue.then(task).catch((err) => console.error(err));
  }

  signal(data) {
    this.enqueue(() => this.handle(data));
  }

  async handle(data) {
    const pc = this.pc;
    if (pc.signalingState === 'closed') return;
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        if (this.initiator) return;
        await pc.setRemoteDescription(data.sdp);
        this.bind();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription({ type: 'answer', sdp: tuneSdp(answer.sdp) });
        this.send({ sdp: pc.localDescription });
      } else {
        await pc.setRemoteDescription(data.sdp);
      }
      this.onFingerprint?.(fingerprintOf(data.sdp.sdp));
      for (const c of this.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    } else if (data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
      else this.pending.push(data.candidate);
    } else if (data.media) {
      this.onMedia(data.media);
    } else if (typeof data.watch === 'boolean') {
      // Собеседник начал или перестал смотреть нашу трансляцию
      this.setScreenWanted(data.watch);
    }
  }

  transceiver(slot) {
    const t = this.pc.getTransceivers()[SLOTS.indexOf(slot)];
    return t && t.receiver.track.kind === SLOT_KIND[slot] ? t : null;
  }

  // Отвечающая сторона получает слоты из предложения и кладёт в них свои дорожки
  bind() {
    for (const slot of SLOTS) {
      const t = this.transceiver(slot);
      if (!t) continue;
      if (slot === 'screen') preferScreenCodecs(t);
      t.direction = 'sendrecv';
      t.sender.setStreams?.(this.msid);
      t.sender.replaceTrack(this.localTrack(slot)).catch(() => {});
    }
    this.bound = true;
  }

  async updateTrack(slot) {
    const t = this.bound && this.transceiver(slot);
    if (!t) return;
    await t.sender.replaceTrack(this.localTrack(slot)).catch(() => {});
    this.tune(slot);
  }

  /** Своя дорожка для этого собеседника: экран и его звук — только если он смотрит трансляцию */
  localTrack(slot) {
    if ((slot === 'screen' || slot === 'screenAudio') && !this.screenWanted) return null;
    return this.local.tracks[slot] || null;
  }

  setScreenWanted(on) {
    if (this.screenWanted === on) return;
    this.screenWanted = on;
    this.updateTrack('screen');
    this.updateTrack('screenAudio');
  }

  /** Что сейчас уходит или приходит по видео слота: кадры/с, размер, кодек */
  async videoStats(slot, dir) {
    const t = this.transceiver(slot);
    if (!t) return null;
    this.prevVideo ??= {};
    const prev = (this.prevVideo[slot + dir] ??= {});
    return readVideoStats(await (dir === 'out' ? t.sender : t.receiver).getStats(), dir, prev);
  }

  // Ограничения скорости: голос важнее всего, экран — по режиму (7–14 Мбит/с), камера — до 2,5
  async tune(slot) {
    const t = this.transceiver(slot);
    if (!t || !this.local.tracks[slot]) return;
    const params = t.sender.getParameters();
    const enc = params.encodings?.[0];
    if (!enc) return;
    if (slot === 'mic') {
      enc.priority = enc.networkPriority = 'high';
    } else if (slot === 'cam') {
      enc.maxBitrate = 2_500_000;
      enc.maxFramerate = 30;
    } else if (slot === 'screen') {
      const mode = SCREEN_MODES[this.local.screenMode];
      enc.maxBitrate = mode.bitrate;
      enc.maxFramerate = mode.frameRate;
      enc.scaleResolutionDownBy = 1;
      enc.priority = enc.networkPriority = 'high';
      params.degradationPreference = this.local.screenText ? 'maintain-resolution' : 'maintain-framerate';
    } else {
      return;
    }
    try {
      await t.sender.setParameters(params);
    } catch {
      delete params.degradationPreference;
      await t.sender.setParameters(params).catch(() => {});
    }
  }

  /** Качество связи: пинг, потери пакетов голоса за последний интервал, джиттер, идёт ли через TURN */
  async stats() {
    const report = await this.pc.getStats();
    let rtt = null;
    let pairLocal = null;
    let lost = 0;
    let received = 0;
    let jitter = 0;
    report.forEach((s) => {
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
        if (s.currentRoundTripTime != null) rtt = Math.round(s.currentRoundTripTime * 1000);
        pairLocal = s.localCandidateId;
      }
      if (s.type === 'inbound-rtp' && s.kind === 'audio') {
        lost += s.packetsLost || 0;
        received += s.packetsReceived || 0;
        jitter = Math.max(jitter, Math.round((s.jitter || 0) * 1000));
      }
    });
    const dLost = Math.max(0, lost - this.prev.lost);
    const dReceived = Math.max(0, received - this.prev.received);
    this.prev = { lost, received };
    const loss = dLost + dReceived ? (dLost / (dLost + dReceived)) * 100 : 0;
    const relay = pairLocal ? report.get(pairLocal)?.candidateType === 'relay' : false;
    return { rtt, loss, jitter, relay };
  }

  close() {
    this.pc.close();
  }
}

/** Видео одного направления из отчёта getStats: кадры/с (по разнице с прошлым замером), размер, кодек, ограничение.
 *  prev — объект, где храним прошлый замер этого направления */
function readVideoStats(report, dir, prev) {
  let s = null;
  report.forEach((x) => {
    if (x.type === (dir === 'out' ? 'outbound-rtp' : 'inbound-rtp') && x.kind === 'video' && (!s || (x.frameWidth || 0) > (s.frameWidth || 0))) s = x;
  });
  if (!s) return null;
  const frames = dir === 'out' ? s.framesEncoded : s.framesDecoded;
  const fps = prev.at && frames >= prev.frames ? ((frames - prev.frames) * 1000) / (s.timestamp - prev.at) : s.framesPerSecond || 0;
  Object.assign(prev, { frames, at: s.timestamp });
  const codec = report.get(s.codecId)?.mimeType?.split('/')[1] || '';
  return { fps, width: s.frameWidth, height: s.frameHeight, codec, limit: dir === 'out' ? s.qualityLimitationReason : 'none' };
}

const LIMIT_TEXT = { bandwidth: 'упирается в интернет', cpu: 'упирается в процессор' };
/** «48 к/с · 2560×1440 · VP9 · упирается в интернет» — для плитки трансляции */
function videoStatsText(s) {
  if (!s?.width) return '';
  return [`${Math.round(s.fps)} к/с`, `${s.width}×${s.height}`, s.codec, LIMIT_TEXT[s.limit]].filter(Boolean).join(' · ');
}

/** Оценка связи для значка: 3 — отлично, 2 — нормально, 1 — плохо */
function qualityLevel(q) {
  if (q?.sfu) return q.level || 0;
  if (!q || q.rtt == null) return 0;
  if (q.rtt > 400 || q.loss > 8) return 1;
  if (q.rtt > 180 || q.loss > 2 || q.jitter > 40) return 2;
  return 3;
}

const SFU_QUALITY_TEXT = ['Соединение…', 'через медиасервер · связь плохая', 'через медиасервер · связь нормальная', 'через медиасервер · связь отличная'];

function qualityText(q) {
  if (q?.sfu) return SFU_QUALITY_TEXT[q.level || 0];
  if (!q || q.rtt == null) return 'Соединение…';
  const parts = [`пинг ${q.rtt} мс`, `потери ${q.loss < 0.1 ? 0 : q.loss.toFixed(1)}%`, `джиттер ${q.jitter} мс`];
  if (q.relay) parts.push('через сервер');
  return parts.join(' · ');
}

// Звонок целиком: свои устройства плюс соединения со всеми собеседниками
class MediaSession {
  // allowed(id) -> { speak, video }: что собеседнику разрешено в комнате; без права его не слышно и не видно
  constructor({ settings, sendSignal, onChange, onSpeaking, onPeerState, onStats, volumeOf, allowed }) {
    this.settings = settings;
    this.volumeOf = volumeOf;
    this.allowed = allowed;
    this.sendSignal = sendSignal;
    this.onChange = onChange;
    this.onSpeaking = onSpeaking;
    this.onPeerState = onPeerState;
    this.onStats = onStats;
    this.local = new LocalMedia((slot) => this.onLocal(slot));
    this.peers = new Map(); // id собеседника -> { link, tracks, media, audio, meter, speaking, state, quality }
    this.iceServers = [];
    this.deafened = false;
    this.volumes = {};
    this.sinkId = settings.speakerId || '';
    this.meter = null;
    this.closed = false;
    this.code = null; // код шифрования: { emoji, digits }, когда соединились со всеми
    this.watching = new Set(); // чьи трансляции смотрим (по умолчанию — ничьи)
    this.screenStats = null; // своя трансляция: что уходит
    this.statsTimer = setInterval(() => this.collectStats(), 2000);
  }

  async start({ muted, deafened }) {
    this.local.muted = muted;
    this.deafened = deafened;
    const [{ iceServers }, certificate] = await Promise.all([
      Api.get('/ice').catch(() => ({ iceServers: [] })),
      Promise.resolve()
        .then(() => RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' }))
        .catch(() => null),
      this.local.openMic(this.settings),
    ]);
    this.iceServers = iceServers;
    this.certificate = certificate;
    this.fingerprint = certificate?.getFingerprints?.()[0]?.value?.toUpperCase() || null;
  }

  /** Код шифрования — когда соединились со всеми и знаем ключ каждого; иначе нет */
  async updateCode() {
    const peers = [...this.peers.values()];
    const ready = this.fingerprint && peers.length && peers.every((p) => p.state === 'connected' && p.fingerprint);
    const code = ready ? await securityCode([this.fingerprint, ...peers.map((p) => p.fingerprint)]) : null;
    if (this.closed || JSON.stringify(code) === JSON.stringify(this.code)) return;
    this.code = code;
    this.onChange();
  }

  mediaState() {
    return {
      muted: this.local.muted,
      deafened: this.deafened,
      video: Boolean(this.local.tracks.cam),
      screen: Boolean(this.local.tracks.screen),
    };
  }

  broadcastMedia() {
    for (const id of this.peers.keys()) this.sendSignal(id, { media: this.mediaState() });
  }

  onLocal(slot) {
    if (this.closed) return;
    if (slot === 'mic') {
      this.meter?.stop();
      const track = this.local.tracks.mic;
      this.meter = track && new LevelMeter(new MediaStream([track]), (s) => this.onSpeaking('me', s));
    }
    for (const peer of this.peers.values()) peer.link.updateTrack(slot);
    if (slot !== 'mic') this.broadcastMedia();
    this.onChange();
  }

  addPeer(id, initiator) {
    this.removePeer(id);
    const peer = {
      id,
      tracks: {},
      media: { muted: false, deafened: false, video: false, screen: false },
      audio: {},
      meter: null,
      speaking: false,
      state: 'new',
      quality: null,
    };
    peer.link = new PeerLink({
      iceServers: this.iceServers,
      certificate: this.certificate,
      initiator,
      onFingerprint: (fp) => {
        peer.fingerprint = fp;
        this.updateCode();
      },
      local: this.local,
      send: (data) => this.sendSignal(id, { ...data, link: peer.link.id }),
      onTrack: (slot, track) => this.onRemoteTrack(peer, slot, track),
      onState: (st) => {
        peer.state = st;
        if (st === 'connected') {
          this.sendSignal(id, { media: this.mediaState() });
          this.sendSignal(id, { watch: this.watching.has(id) });
        }
        this.onPeerState?.(id, st);
        this.updateCode();
        this.onChange();
      },
      onMedia: (media) => {
        peer.media = { ...peer.media, ...media };
        // Показ закончился — перестаём смотреть: начнётся снова — снова по желанию
        if (!peer.media.screen) this.watching.delete(id);
        this.onChange();
      },
    });
    this.peers.set(id, peer);
    return peer;
  }

  removePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.link.close();
    peer.meter?.stop();
    for (const el of Object.values(peer.audio)) {
      el.pause();
      el.srcObject = null;
    }
    if (peer.speaking) this.onSpeaking(id, false);
    this.updateCode();
    this.onChange();
  }

  // У каждого соединения свой номер (link). Если собеседник переподключился и прислал новое предложение,
  // старое соединение с ним выбрасываем; сигналы от уже закрытого соединения игнорируем
  handleSignal(id, data) {
    let peer = this.peers.get(id);
    const isOffer = data.sdp?.type === 'offer';
    if (peer && data.link && peer.remoteLink && peer.remoteLink !== data.link) {
      if (!isOffer) return;
      peer = null;
    }
    if (!peer) {
      if (!isOffer) return;
      peer = this.addPeer(id, false);
    }
    if (data.link) peer.remoteLink = data.link;
    peer.link.signal(data);
  }

  onRemoteTrack(peer, slot, track) {
    peer.tracks[slot] = track;
    if (SLOT_KIND[slot] === 'audio') {
      let el = peer.audio[slot];
      if (!el) el = peer.audio[slot] = new Audio();
      el.autoplay = true;
      el.srcObject = new MediaStream([track]);
      this.applyPeerAudio(peer);
      el.play().catch(() => {});
      if (slot === 'mic') {
        peer.meter?.stop();
        peer.meter = new LevelMeter(el.srcObject, (s) => {
          peer.speaking = s;
          this.onSpeaking(peer.id, s);
        });
      }
    }
    this.onChange();
  }

  applyPeerAudio(peer) {
    const volume = this.volumes[peer.id] ?? this.volumeOf?.(peer.id) ?? 1;
    const allowed = this.allowed?.(peer.id) ?? { speak: true, video: true };
    for (const [slot, el] of Object.entries(peer.audio)) {
      el.volume = volume;
      el.muted = this.deafened || !(slot === 'mic' ? allowed.speak : allowed.video) || (slot === 'screenAudio' && !this.watching.has(peer.id));
      if (el.setSinkId && el.sinkId !== this.sinkId) el.setSinkId(this.sinkId).catch(() => {});
    }
  }

  /** Смотреть трансляцию человека или перестать: он шлёт нам экран, только пока мы смотрим */
  setWatching(id, on) {
    if (on) this.watching.add(id);
    else this.watching.delete(id);
    this.sendSignal(id, { watch: on });
    const peer = this.peers.get(id);
    if (peer) this.applyPeerAudio(peer);
    this.onChange();
  }

  setVolume(id, volume) {
    this.volumes[id] = volume;
    const peer = this.peers.get(id);
    if (peer) this.applyPeerAudio(peer);
  }

  /** Права в комнате поменялись — заново решаем, кого слышно */
  applyAllowed() {
    for (const peer of this.peers.values()) this.applyPeerAudio(peer);
    this.onChange();
  }

  setSink(sinkId) {
    this.sinkId = sinkId || '';
    for (const peer of this.peers.values()) this.applyPeerAudio(peer);
  }

  setMuted(muted, deafened) {
    this.local.setMuted(muted);
    this.deafened = deafened;
    for (const peer of this.peers.values()) this.applyPeerAudio(peer);
    this.broadcastMedia();
    this.onChange();
  }

  async switchMic(settings) {
    this.settings = settings;
    await this.local.openMic(settings);
  }

  async toggleCamera() {
    if (this.local.tracks.cam) this.local.stopCamera();
    else await this.local.startCamera(this.settings);
  }

  startScreen(options) {
    return this.local.startScreen(options);
  }

  stopScreen() {
    this.local.stopScreen();
  }

  async collectStats() {
    let own = null;
    for (const peer of this.peers.values()) {
      if (peer.state !== 'connected') continue;
      try {
        peer.quality = await peer.link.stats();
        peer.screenStats = this.watching.has(peer.id) ? await peer.link.videoStats('screen', 'in') : null;
        // Своя трансляция — по любому, кому она уходит
        if (this.local.tracks.screen && peer.link.localTrack('screen')) own ??= await peer.link.videoStats('screen', 'out');
      } catch {}
    }
    this.screenStats = this.local.tracks.screen ? own : null;
    if (!this.closed) this.onStats?.();
  }

  /** Значки людей из списка нашего сервера — нужно только при голосе через медиасервер (SfuSession) */
  applyVoiceState() {}

  /** Свои устройства переходят к другой сессии (вход в большую комнату): эту останавливаем, устройства не трогаем */
  handOver() {
    this.closed = true;
    clearInterval(this.statsTimer);
    this.meter?.stop();
    this.meter = null;
  }

  /** Самое плохое соединение — по нему показываем значок качества связи */
  worstQuality() {
    let worst = null;
    for (const peer of this.peers.values()) {
      if (!peer.quality) continue;
      if (!worst || qualityLevel(peer.quality) < qualityLevel(worst)) worst = peer.quality;
    }
    return worst;
  }

  close() {
    this.closed = true;
    clearInterval(this.statsTimer);
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.meter?.stop();
    this.local.close();
  }
}
