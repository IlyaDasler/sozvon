// Звонок один на один через WebRTC, звуки вызова и индикатор «говорит»

// Звуки генерируются на лету, без аудиофайлов. Паттерн: [начало, длительность, частота]
const PATTERNS = {
  ring: [[0, 0.18, 880], [0.22, 0.18, 660], [0.44, 0.18, 880]],
  ringback: [[0, 1.0, 425]],
  end: [[0, 0.12, 660], [0.14, 0.18, 440]],
  mute: [[0, 0.07, 520]],
  unmute: [[0, 0.07, 880]],
};

function playPattern(ctx, pattern, volume = 0.12) {
  const now = ctx.currentTime + 0.02;
  for (const [at, dur, freq] of pattern) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + at);
    gain.gain.linearRampToValueAtTime(volume, now + at + 0.015);
    gain.gain.setValueAtTime(volume, now + at + dur - 0.03);
    gain.gain.linearRampToValueAtTime(0, now + at + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + at);
    osc.stop(now + at + dur);
  }
}

class Tone {
  constructor() {
    this.ctx = null;
    this.timer = null;
  }

  /** Повторяющийся сигнал: 'ring' — входящий, 'ringback' — исходящий */
  loop(kind) {
    this.stop();
    this.ctx = new AudioContext();
    const beep = () => playPattern(this.ctx, PATTERNS[kind]);
    beep();
    this.timer = setInterval(beep, kind === 'ring' ? 2000 : 4000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.ctx?.close();
    this.ctx = null;
  }

  /** Короткий одиночный звук: 'end', 'mute', 'unmute' */
  blip(kind) {
    const ctx = new AudioContext();
    playPattern(ctx, PATTERNS[kind], 0.08);
    setTimeout(() => ctx.close(), 1000);
  }
}

// Следит за громкостью потока и сообщает, когда человек начинает и перестаёт говорить
class LevelMeter {
  constructor(stream, onChange) {
    this.ctx = new AudioContext();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    this.ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let speaking = false;
    let lastLoud = 0;

    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const now = performance.now();
      if (Math.sqrt(sum / data.length) > 0.015) lastLoud = now;
      const next = now - lastLoud < 300;
      if (next !== speaking) onChange((speaking = next));
    }, 60);
  }

  stop() {
    clearInterval(this.timer);
    this.ctx.close();
  }
}

function micConstraints(settings) {
  return {
    audio: {
      deviceId: settings.micId ? { ideal: settings.micId } : undefined,
      echoCancellation: settings.noiseSuppression,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: true,
    },
  };
}

class VoiceCall {
  constructor({ peer, socket, audioEl, onState, onSpeaking }) {
    this.peer = peer;
    this.socket = socket;
    this.audioEl = audioEl;
    this.onState = onState;
    this.onSpeaking = onSpeaking;

    this.callId = null;
    this.state = 'idle';
    this.connectedAt = null;
    this.pc = null;
    this.localStream = null;
    this.localMeter = null;
    this.remoteMeter = null;
    this.pendingCandidates = [];
    this.signalQueue = Promise.resolve();
    this.muted = false;
  }

  setState(state) {
    this.state = state;
    this.onState(state);
  }

  async openMic(settings) {
    this.localStream = await navigator.mediaDevices.getUserMedia(micConstraints(settings));
    this.setMuted(this.muted);
    this.localMeter = new LevelMeter(this.localStream, (s) => this.onSpeaking('me', s));
  }

  // Смена микрофона прямо во время звонка, без переподключения
  async switchMic(settings) {
    const stream = await navigator.mediaDevices.getUserMedia(micConstraints(settings));
    const track = stream.getAudioTracks()[0];
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'audio');
    if (sender) await sender.replaceTrack(track);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localMeter?.stop();
    this.localStream = stream;
    this.setMuted(this.muted);
    this.localMeter = new LevelMeter(stream, (s) => this.onSpeaking('me', s));
  }

  async createPeer() {
    const { iceServers } = await Api.get('/ice').catch(() => ({ iceServers: [] }));
    const pc = (this.pc = new RTCPeerConnection({ iceServers }));
    for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);

    pc.onicecandidate = (e) => e.candidate && this.signal({ candidate: e.candidate });

    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      this.audioEl.srcObject = stream;
      this.audioEl.play().catch(() => {});
      this.remoteMeter?.stop();
      this.remoteMeter = new LevelMeter(stream, (s) => this.onSpeaking('peer', s));
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          this.connectedAt ??= Date.now();
          this.setState('connected');
          break;
        case 'disconnected':
          this.setState('reconnecting');
          break;
        case 'failed':
          this.setState('failed');
          break;
      }
    };
  }

  signal(data) {
    this.socket.send({ type: 'signal', callId: this.callId, data });
  }

  async startOffer() {
    this.setState('connecting');
    await this.pc.setLocalDescription(await this.pc.createOffer());
    this.signal({ sdp: this.pc.localDescription });
  }

  // Сигналы обрабатываем строго по очереди, иначе кандидаты могут обогнать SDP
  enqueueSignal(data) {
    this.signalQueue = this.signalQueue.then(() => this.handleSignal(data)).catch((err) => console.error(err));
  }

  async handleSignal(data) {
    if (!this.pc) return;
    if (data.sdp) {
      await this.pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === 'offer') {
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        this.signal({ sdp: this.pc.localDescription });
      }
      for (const c of this.pendingCandidates.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
    } else if (data.candidate) {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(data.candidate).catch(() => {});
      else this.pendingCandidates.push(data.candidate);
    }
  }

  setMuted(muted) {
    this.muted = muted;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  close() {
    this.localMeter?.stop();
    this.remoteMeter?.stop();
    this.pc?.close();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.audioEl.srcObject = null;
    this.pc = null;
  }
}
