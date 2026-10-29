// Голос большой комнаты через медиасервер LiveKit: каждый отправляет свои дорожки один раз на сервер,
// а не каждому участнику. Снаружи — та же сессия, что и каждый с каждым (MediaSession): свои устройства,
// громкости, права, «не слышу» и плитки работают одинаково; другое только — как дорожки ходят по сети.
// Звук и видео зашифрованы ключом комнаты (тем же, что её переписка) — медиасервер их не слышит и не видит.

const LK_SOURCE = { mic: 'microphone', cam: 'camera', screen: 'screen_share', screenAudio: 'screen_share_audio' };
const LK_SLOT = Object.fromEntries(Object.entries(LK_SOURCE).map(([slot, source]) => [source, slot]));
const LK_QUALITY = { excellent: 3, good: 2, poor: 1, lost: 1 };

class SfuSession extends MediaSession {
  /** Забирает уже открытые свои устройства у сессии, с которой начинали вход, — микрофон не переоткрывается */
  constructor(options, from) {
    super(options);
    this.local.close();
    this.local = from.local;
    this.local.onChange = (slot) => this.onLocal(slot);
    from.handOver();
    this.room = null;
    this.published = {}; // слот -> опубликованная дорожка
    this.publishing = Promise.resolve();
    this.quality = null;
  }

  /** grant — { url, token } от нашего сервера; key — ключ шифрования (base64) или null */
  async connect(grant, key) {
    const LK = LivekitClient;
    const options = { adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true };
    if (key) {
      this.keyProvider = new LK.ExternalE2EEKeyProvider();
      await this.keyProvider.setKey(E2EE.fromB64(key).buffer);
      options.e2ee = { keyProvider: this.keyProvider, worker: new Worker('vendor/livekit-client.e2ee.worker.js') };
      this.keyHash = await crypto.subtle.digest('SHA-256', E2EE.fromB64(key));
    }
    const room = (this.room = new LK.Room(options));
    room
      .on(LK.RoomEvent.ParticipantConnected, (p) => this.addRemote(p))
      .on(LK.RoomEvent.ParticipantDisconnected, (p) => this.removePeer(Number(p.identity)))
      .on(LK.RoomEvent.TrackSubscribed, (track, pub, p) => this.setRemoteTrack(p, pub.source, track.mediaStreamTrack, track))
      .on(LK.RoomEvent.TrackUnsubscribed, (track, pub, p) => this.setRemoteTrack(p, pub.source, null, track))
      .on(LK.RoomEvent.ConnectionQualityChanged, (q, p) => {
        if (p === room.localParticipant) this.quality = { sfu: true, level: LK_QUALITY[q] || 0 };
      })
      .on(LK.RoomEvent.Disconnected, () => {
        if (!this.closed) this.onDisconnected?.();
      });
    if (key) await room.setE2EEEnabled(true);
    // Подписываемся сами: голос и камеры — сразу, трансляции — только те, что смотрим
    room.on(LK.RoomEvent.TrackPublished, (pub, p) => this.applySubscription(p, pub));
    await room.connect(grant.url, grant.token, { autoSubscribe: false });
    for (const p of room.remoteParticipants.values()) this.addRemote(p);
    for (const slot of SLOTS) if (this.local.tracks[slot]) this.publish(slot);
    if (this.local.tracks.mic) this.onLocal('mic');
    await this.updateCode();
    this.onChange();
  }

  /** Ключ комнаты сменили (например, кого-то выгнали) — дальше шифруем и расшифровываем новым */
  async setKey(key) {
    if (!this.keyProvider) return;
    await this.keyProvider.setKey(E2EE.fromB64(key).buffer);
    this.keyHash = await crypto.subtle.digest('SHA-256', E2EE.fromB64(key));
    await this.updateCode();
  }

  // ---------- Свои дорожки ----------

  onLocal(slot) {
    if (this.closed) return;
    if (slot === 'mic') {
      this.meter?.stop();
      const track = this.local.tracks.mic;
      this.meter = track && new LevelMeter(new MediaStream([track]), (s) => this.onSpeaking('me', s));
    }
    if (this.room) this.publish(slot);
    this.onChange();
  }

  /** Дорожку слота заменили или убрали — публикуем новую вместо старой. По одной, чтобы не перепутать порядок */
  publish(slot) {
    this.publishing = this.publishing.then(async () => {
      const lp = this.room?.localParticipant;
      if (!lp || this.closed) return;
      const track = this.local.tracks[slot];
      const old = this.published[slot];
      if (old?.mediaStreamTrack === track) return;
      if (old) await lp.unpublishTrack(old, false).catch(() => {});
      delete this.published[slot];
      if (!track) return;
      const m = SCREEN_MODES[this.local.screenMode];
      const options = {
        source: LK_SOURCE[slot],
        name: slot,
        ...(slot === 'mic' && { dtx: true, red: true }),
        ...(slot === 'cam' && { simulcast: true }),
        ...(slot === 'screen' && { simulcast: false, videoCodec: 'vp9', videoEncoding: { maxBitrate: m.bitrate, maxFramerate: m.frameRate } }),
      };
      try {
        const pub = await lp.publishTrack(track, options);
        this.published[slot] = pub.track;
        this.prevVideo = {};
      } catch (err) {
        console.warn('LiveKit: не удалось отправить', slot, err.message);
      }
    });
    return this.publishing;
  }

  // ---------- Собеседники ----------

  /** Трансляцию (экран и его звук) получаем, только пока смотрим; остальное — всегда */
  applySubscription(p, pub) {
    const screen = pub.source === 'screen_share' || pub.source === 'screen_share_audio';
    const want = !screen || this.watching.has(Number(p.identity));
    if (pub.isSubscribed !== want) pub.setSubscribed(want);
  }

  setWatching(id, on) {
    if (on) this.watching.add(id);
    else this.watching.delete(id);
    const p = this.room?.remoteParticipants.get(String(id));
    if (p) for (const pub of p.trackPublications.values()) this.applySubscription(p, pub);
    this.onChange();
  }

  addRemote(p) {
    for (const pub of p.trackPublications.values()) this.applySubscription(p, pub);
    const id = Number(p.identity);
    if (!id || this.peers.has(id)) return;
    this.peers.set(id, {
      id,
      tracks: {},
      media: { muted: false, deafened: false, video: false, screen: false },
      audio: {},
      meter: null,
      speaking: false,
      state: 'connected',
      quality: null,
    });
    this.onPeerState?.(id, 'connected');
    this.onChange();
  }

  setRemoteTrack(p, source, track, lkTrack = null) {
    const slot = LK_SLOT[source];
    if (!slot) return;
    this.addRemote(p);
    const peer = this.peers.get(Number(p.identity));
    if (!peer) return;
    peer.lk ??= {};
    // Дорожку заменили (выкл/вкл шумоподавления): новую уже подписали, а отписка от старой пришла позже —
    // убираем только ту, что сейчас играет, иначе человек замолкает
    if (!track && lkTrack && peer.lk[slot] && peer.lk[slot] !== lkTrack) return;
    peer.lk[slot] = track ? lkTrack : null;
    if (track) return this.onRemoteTrack(peer, slot, track);
    delete peer.tracks[slot];
    const el = peer.audio[slot];
    if (el) {
      el.pause();
      el.srcObject = null;
      delete peer.audio[slot];
    }
    if (slot === 'mic') {
      peer.meter?.stop();
      peer.meter = null;
      if (peer.speaking) this.onSpeaking(peer.id, (peer.speaking = false));
    }
    this.onChange();
  }

  removePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.meter?.stop();
    for (const el of Object.values(peer.audio)) {
      el.pause();
      el.srcObject = null;
    }
    if (peer.speaking) this.onSpeaking(id, false);
    this.onChange();
  }

  /** Значки микрофона, камеры и экрана у людей — из того, что знает наш сервер (room:voice) */
  applyVoiceState(participants) {
    for (const p of participants) {
      const peer = this.peers.get(p.userId);
      if (peer) peer.media = { muted: p.muted, deafened: p.deafened, video: p.video, screen: p.screen };
    }
  }

  // Сигналы WebRTC через наш сервер не нужны — всё идёт через LiveKit; своё состояние уходит в room:state
  addPeer() {}
  handleSignal() {}
  broadcastMedia() {}

  /** Код шифрования: одинаковый у всех, у кого тот же ключ комнаты */
  async updateCode() {
    const code = this.keyHash ? await securityCode([E2EE.toB64(this.keyHash), 'sozvon-sfu']) : null;
    if (this.closed || JSON.stringify(code) === JSON.stringify(this.code)) return;
    this.code = code;
    this.onChange();
  }

  async collectStats() {
    // Качество связи с медиасервером — одно на всех
    this.prevVideo ??= {};
    const stats = async (track, key, dir) => {
      const report = await track?.getRTCStatsReport?.().catch(() => null);
      return report ? readVideoStats(report, dir, (this.prevVideo[key] ??= {})) : null;
    };
    for (const peer of this.peers.values()) {
      peer.quality = this.quality;
      peer.screenStats = this.watching.has(peer.id) ? await stats(peer.lk?.screen, `in${peer.id}`, 'in') : null;
    }
    this.screenStats = this.local.tracks.screen ? await stats(this.published.screen, 'out', 'out') : null;
    if (!this.closed) this.onStats?.();
  }

  close() {
    this.closed = true;
    clearInterval(this.statsTimer);
    this.room?.disconnect().catch(() => {});
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.meter?.stop();
    this.local.close();
  }
}
