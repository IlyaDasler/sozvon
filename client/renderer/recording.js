// Запись звонка на компьютер того, кто её начал. Только звук: микрофон и голоса
// собеседников (плюс звук трансляции, если он есть). Сервер в записи не участвует.
(() => {
  const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) || '';

  class CallRecorder {
    constructor() {
      this.ctx = null;
      this.dest = null;
      this.recorder = null;
      this.sources = new Map();
      this.syncTimer = null;
      this.chain = Promise.resolve();
      this.chunkCount = 0;
      this.file = null;
      this.stopping = false;
    }

    get active() {
      return Boolean(this.recorder && this.recorder.state !== 'inactive');
    }

    async toggle() {
      if (this.active) return this.stop();
      return this.start();
    }

    async start() {
      if (this.active || this.stopping) return;
      const session = activeSession();
      if (!session) return toast('Запись доступна только во время звонка или голосовой комнаты');
      if (!window.desktop?.recording) return toast('Запись недоступна в этой версии');
      const where = state.room ? roomById(state.room.roomId)?.name || 'Комната' : userById(state.call?.peerId)?.displayName || 'Звонок';
      const target = await window.desktop.recording.start(where);
      if (!target) return;

      this.file = target;
      this.ctx = new AudioContext({ sampleRate: 48000 });
      await this.ctx.resume?.().catch(() => {});
      this.dest = this.ctx.createMediaStreamDestination();
      this.syncSources();
      this.syncTimer = setInterval(() => {
        if (!activeSession()) return this.stop();
        this.syncSources();
      }, 1000);

      const options = { audioBitsPerSecond: 128000 };
      if (MIME) options.mimeType = MIME;
      this.recorder = new MediaRecorder(this.dest.stream, options);
      this.recorder.ondataavailable = (event) => {
        if (!event.data?.size) return;
        this.chunkCount += 1;
        this.chain = this.chain
          .then(async () => {
            const buffer = await event.data.arrayBuffer();
            window.desktop.recording.chunk(this.file.id, buffer);
          })
          .catch(() => {});
      };
      this.recorder.start(5000);
      this.render();
      toast('Запись звонка началась — файл сохранится на этом компьютере');
    }

    syncSources() {
      if (!this.ctx || !this.dest) return;
      const session = activeSession();
      if (!session) return;
      const tracks = [];
      const localMic = session.local?.tracks?.mic;
      if (localMic) tracks.push(localMic);
      const localScreen = session.local?.tracks?.screenAudio;
      if (localScreen) tracks.push(localScreen);
      for (const peer of session.peers?.values() || []) {
        if (peer.tracks?.mic) tracks.push(peer.tracks.mic);
        if (peer.tracks?.screenAudio) tracks.push(peer.tracks.screenAudio);
      }
      const wanted = new Set(tracks.map((track) => track.id));
      for (const [id, source] of this.sources) {
        if (wanted.has(id)) continue;
        try {
          source.disconnect();
        } catch {}
        this.sources.delete(id);
      }
      for (const track of tracks) {
        if (this.sources.has(track.id)) continue;
        try {
          const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
          source.connect(this.dest);
          this.sources.set(track.id, source);
        } catch {}
      }
    }

    async stop() {
      if (!this.active || this.stopping) return;
      this.stopping = true;
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      const recorder = this.recorder;
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      try {
        recorder.requestData?.();
        await new Promise((resolve) => setTimeout(resolve, 100));
        recorder.stop();
        await stopped;
        // Финальный dataavailable может прийти после onstop — даём ему очередь.
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch {}
      await this.chain.catch(() => {});
      await Promise.resolve(window.desktop?.recording?.flush?.(this.file?.id)).catch(() => {});
      for (const source of this.sources.values()) {
        try {
          source.disconnect();
        } catch {}
      }
      this.sources.clear();
      await this.ctx?.close?.().catch(() => {});
      this.ctx = null;
      this.dest = null;
      this.recorder = null;
      this.stopping = false;
      const result = await Promise.resolve(window.desktop?.recording?.stop(this.file?.id)).catch(() => null);
      this.file = null;
      this.render();
      if (result?.filePath) {
        toast(`Запись сохранена: ${result.filePath}`);
        window.desktop.recording.reveal(result.filePath).catch(() => {});
      } else {
        toast('Не удалось сохранить запись');
      }
    }

    render() {
      for (const id of ['call-record', 'voice-record']) {
        const button = document.getElementById(id);
        if (!button) continue;
        button.classList.toggle('recording', this.active);
        button.title = this.active ? 'Остановить запись звонка' : 'Записать звонок';
        button.setAttribute('aria-pressed', String(this.active));
      }
    }
  }

  window.CallRecorder = new CallRecorder();
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('call-record')?.addEventListener('click', () => window.CallRecorder.toggle());
    document.getElementById('voice-record')?.addEventListener('click', () => window.CallRecorder.toggle());
  });
})();
