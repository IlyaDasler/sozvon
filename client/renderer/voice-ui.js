// Панель разговора — общая для звонка и голосовой комнаты: плитки участников (камера, экран или аватар),
// кнопки микрофона, камеры и экрана, качество связи и окно выбора экрана для демонстрации

const activeSession = () => state.call?.session || state.room?.session || null;
const speaking = new Map(); // 'me' или id собеседника -> говорит ли сейчас
let focusedTile = null; // плитка, развёрнутая на всю панель (по клику)
let voiceTimer = null;

// Без права говорить в комнате микрофон выключен, что бы ни стояло на кнопке
const audioFlags = () => ({ muted: state.muted || state.deafened || forcedMute(), deafened: state.deafened });

function newSession(sendSignal) {
  return new MediaSession({
    settings: state.settings,
    sendSignal,
    onChange() {
      renderVoice();
      sendRoomState();
    },
    onSpeaking: (who, on) => setSpeaking(who, on && (who === 'me' || voiceAllowed(who).speak)),
    onPeerState,
    onStats: renderVoiceStatus,
    volumeOf: (id) => store.get(`volume:${id}`, 100) / 100,
    allowed: voiceAllowed,
  });
}

function mediaErrorText(err, what = 'микрофон') {
  if (err.name === 'NotAllowedError')
    return `Нет доступа: ${what}. Разрешите его в Windows: Параметры → Конфиденциальность и защита.`;
  if (err.name === 'NotFoundError') return `Не найдено устройство: ${what}. Подключите его и попробуйте снова.`;
  if (err.name === 'NotReadableError') return `Устройство (${what}) занято другой программой.`;
  return err.message || 'Не удалось включить устройство';
}

const qualityBars = (q) => {
  const el = document.createElement('span');
  el.className = `q-bars q${qualityLevel(q)}`;
  el.innerHTML = '<i></i><i></i><i></i>';
  el.title = qualityText(q);
  return el;
};

function setQualityBars(el, q) {
  el.className = `q-bars q${qualityLevel(q)}`;
  if (!el.firstChild) el.innerHTML = '<i></i><i></i><i></i>';
  el.title = qualityText(q);
}

// ---------- Плитки ----------

function voiceTiles() {
  const session = activeSession();
  if (!session) return [];
  const local = session.local;
  const tiles = [
    {
      key: 'me',
      user: state.me,
      isMe: true,
      video: local.tracks.cam,
      muted: local.muted,
      deafened: session.deafened,
      speaking: speaking.get('me'),
    },
  ];
  if (local.tracks.screen) tiles.push({ key: 'me:screen', user: state.me, isMe: true, screen: true, video: local.tracks.screen });

  for (const p of session.peers.values()) {
    const user = userById(p.id) || { id: p.id, displayName: '…', avatarColor: '#555' };
    const allowed = voiceAllowed(p.id);
    tiles.push({
      key: `u${p.id}`,
      id: p.id,
      user,
      video: p.media.video && allowed.video ? p.tracks.cam : null,
      muted: p.media.muted || !allowed.speak,
      deafened: p.media.deafened,
      speaking: p.speaking,
      quality: p.quality,
      connecting: p.state !== 'connected',
    });
    if (p.media.screen && p.tracks.screen && allowed.video)
      tiles.push({ key: `u${p.id}:screen`, id: p.id, user, screen: true, video: p.tracks.screen, quality: p.quality });
  }

  // Звонок ещё не принят — показываем собеседника заранее
  if (state.call && !session.peers.size) {
    tiles.push({ key: `u${state.call.peerId}`, id: state.call.peerId, user: state.call.peer, connecting: true });
  }
  return tiles;
}

function createTile(t) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.key = t.key;
  el.innerHTML = `
    <video autoplay playsinline muted></video>
    <div class="tile-avatar"></div>
    <div class="tile-label"><span class="tile-icons"></span><span class="tile-name ellipsis"></span></div>
    <div class="tile-tools"></div>`;
  const tools = el.querySelector('.tile-tools');

  // Громкость человека (своя у каждого, запоминается)
  if (!t.isMe && !t.screen) {
    const label = document.createElement('label');
    label.className = 'tile-volume';
    label.title = 'Громкость';
    label.innerHTML = ICONS.volume;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = 0;
    range.max = 100;
    range.value = store.get(`volume:${t.id}`, 100);
    range.oninput = () => {
      store.set(`volume:${t.id}`, Number(range.value));
      activeSession()?.setVolume(t.id, range.value / 100);
    };
    range.onclick = (e) => e.stopPropagation();
    label.append(range);
    tools.append(label);
  }

  const full = document.createElement('button');
  full.className = 'tile-btn';
  full.title = 'Во весь экран';
  full.innerHTML = ICONS.expand;
  full.onclick = (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => {});
  };
  tools.append(full);

  el.onclick = () => {
    focusedTile = focusedTile === t.key ? null : t.key;
    renderStage();
  };
  el.ondblclick = () => full.click();
  return el;
}

function updateTile(el, t, focused) {
  const video = el.querySelector('video');
  el.classList.toggle('focused', focused);
  el.classList.toggle('screen', Boolean(t.screen));
  el.classList.toggle('speaking', Boolean(t.speaking) && !t.screen);
  el.classList.toggle('connecting', Boolean(t.connecting));
  el.classList.toggle('has-video', Boolean(t.video));
  video.classList.toggle('mirror', Boolean(t.isMe && !t.screen));

  if (t.video) {
    if (video.srcObject?.getVideoTracks()[0] !== t.video) video.srcObject = new MediaStream([t.video]);
    // Видео ставится на паузу, если панель убирали со страницы
    if (video.paused) video.play().catch(() => {});
  } else if (video.srcObject) {
    video.srcObject = null;
  }

  const avatar = el.querySelector('.tile-avatar');
  avatar.replaceChildren(makeAvatar(t.user, undefined, 'big'));

  const name = t.user.displayName || t.user.username || '';
  el.querySelector('.tile-name').textContent = t.isMe ? (t.screen ? 'Ваш экран' : 'Вы') : t.screen ? `Экран: ${name}` : name;

  const icons = el.querySelector('.tile-icons');
  icons.replaceChildren();
  if (t.screen) icons.insertAdjacentHTML('beforeend', '<b class="live">В ЭФИРЕ</b>');
  if (t.deafened) icons.insertAdjacentHTML('beforeend', ICONS.soundOff);
  else if (t.muted) icons.insertAdjacentHTML('beforeend', ICONS.micOff);
  if (!t.isMe && !t.screen && !t.connecting) icons.append(qualityBars(t.quality));
  el.title = t.connecting ? 'Соединение…' : t.quality ? qualityText(t.quality) : '';
}

function renderStage() {
  const stage = $('stage');
  const tiles = voiceTiles();
  if (focusedTile && !tiles.some((t) => t.key === focusedTile)) focusedTile = null;
  // Чужой экран сам разворачивается на всю панель
  const focus = focusedTile || tiles.find((t) => t.screen && !t.isMe)?.key || null;
  stage.classList.toggle('has-focus', Boolean(focus));
  stage.classList.toggle('has-video', tiles.some((t) => t.video));

  // Плитки двигаем, только если порядок поменялся: перенос элемента сбивает щелчок и выводит его из полноэкранного режима
  const existing = new Map([...stage.children].map((el) => [el.dataset.key, el]));
  tiles.forEach((t, i) => {
    let el = existing.get(t.key);
    existing.delete(t.key);
    if (!el) el = createTile(t);
    updateTile(el, t, t.key === focus);
    if (stage.children[i] !== el) stage.insertBefore(el, stage.children[i] || null);
  });
  for (const el of existing.values()) el.remove();
}

function setSpeaking(who, isSpeaking) {
  speaking.set(who, isSpeaking);
  const key = who === 'me' ? 'me' : `u${who}`;
  $('stage').querySelector(`.tile[data-key="${key}"]`)?.classList.toggle('speaking', isSpeaking);
  const id = who === 'me' ? state.me?.id : who;
  for (const el of document.querySelectorAll(`[data-voice-user="${id}"]`)) el.classList.toggle('speaking', isSpeaking);
}

// ---------- Панель целиком ----------

function voiceTitle() {
  if (state.call) return `Звонок: ${state.call.peer.displayName}`;
  if (state.room) return state.rooms.get(state.room.roomId)?.name || 'Голосовая комната';
  return '';
}

function renderVoice() {
  const session = activeSession();
  const panel = $('call-panel');

  // Панель видна в чате с собеседником или в открытой комнате, где идёт разговор
  const host = state.call && state.call.peerId === state.selectedId ? $('chat') : state.room && state.room.roomId === state.selectedRoomId ? $('room-view') : null;
  if (host) {
    const before = host.querySelector('.messages');
    if (panel.parentElement !== host || panel.nextElementSibling !== before) host.insertBefore(panel, before);
  }
  panel.classList.toggle('hidden', !host);
  if (host) renderStage();
  if (!session) {
    $('stage').replaceChildren();
    speaking.clear();
    focusedTile = null;
  }

  const cam = Boolean(session?.local.tracks.cam);
  const screen = Boolean(session?.local.tracks.screen);
  for (const id of ['call-cam', 'voice-cam']) {
    $(id).innerHTML = cam ? ICONS.cam : ICONS.camOff;
    $(id).classList.toggle('on', cam);
    $(id).title = cam ? 'Выключить камеру' : 'Включить камеру';
  }
  for (const id of ['call-screen', 'voice-screen']) {
    $(id).innerHTML = screen ? ICONS.screenStop : ICONS.screen;
    $(id).classList.toggle('on', screen);
    $(id).title = screen ? 'Остановить демонстрацию' : 'Показать экран';
  }
  $('hangup-btn').title = state.room ? 'Выйти из голосового канала' : 'Завершить звонок';
  renderNoiseButton();

  // Панель «На связи» над профилем — видна из любого места приложения
  $('voice-panel').classList.toggle('hidden', !session);
  document.body.classList.toggle('has-voice', Boolean(session));
  $('voice-where').textContent = voiceTitle();

  if (session && !voiceTimer) voiceTimer = setInterval(renderVoiceStatus, 1000);
  if (!session) {
    clearInterval(voiceTimer);
    voiceTimer = null;
  }
  renderVoiceStatus();
}

function renderVoiceStatus() {
  const session = activeSession();
  if (!session) return;
  const q = session.worstQuality();
  let text = '';
  let connected = false;
  if (state.call) {
    const call = state.call;
    connected = call.phase === 'connected';
    text = {
      calling: 'Вызов…',
      connecting: 'Соединение…',
      reconnecting: 'Связь прервалась, переподключаемся…',
      connected: call.connectedAt ? formatDuration(Date.now() - call.connectedAt) : '',
    }[call.phase];
  } else if (state.room) {
    const room = state.room;
    connected = room.joined;
    const count = session.peers.size + 1;
    text = room.joined
      ? `${formatDuration(Date.now() - room.connectedAt)} · ${count} ${plural(count, 'участник', 'участника', 'участников')}`
      : 'Подключение…';
  }
  $('call-status').textContent = text ?? '';
  const withPeers = connected && session.peers.size > 0;
  $('call-quality').classList.toggle('hidden', !withPeers);
  if (withPeers) {
    setQualityBars($('call-quality'), q);
    $('call-quality-text').textContent = qualityText(q);
  }
  $('call-quality-text').classList.toggle('hidden', !withPeers);

  // Значки качества на плитках собеседников
  for (const p of session.peers.values()) {
    const tile = $('stage').querySelector(`.tile[data-key="u${p.id}"]`);
    const bars = tile?.querySelector('.q-bars');
    if (bars && p.quality) {
      setQualityBars(bars, p.quality);
      tile.title = qualityText(p.quality);
    }
  }

  $('voice-state').textContent = connected ? 'На связи' : 'Подключение…';
  $('voice-state').classList.toggle('ok', connected);
  setQualityBars($('voice-quality'), connected ? q : null);
}

function onPeerState(id, st) {
  const call = state.call;
  if (!call || id !== call.peerId) return;
  if (st === 'connected') {
    call.phase = 'connected';
    call.connectedAt ??= Date.now();
    clearTimeout(call.failTimer);
    call.failTimer = null;
  } else if (st === 'disconnected' || st === 'failed') {
    // Ни разу не соединились — дальше ждать бессмысленно; иначе даём время на переподключение
    if (st === 'failed' && !call.connectedAt)
      return hangup('Не удалось соединиться. Скорее всего, мешает сеть — попробуйте ещё раз.');
    call.phase = 'reconnecting';
    call.failTimer ??= setTimeout(() => {
      if (state.call === call && call.phase !== 'connected') hangup('Связь потеряна');
    }, 20_000);
  }
  renderVoice();
  renderChatHeader();
  renderContacts();
}

// ---------- Камера и экран ----------

const noVideoRight = () => !voiceAllowed(state.me.id).video && (toast('В этой комнате вам нельзя включать камеру и показывать экран'), true);

async function toggleCamera() {
  const session = activeSession();
  if (!session) return;
  if (!session.local.tracks.cam && noVideoRight()) return;
  try {
    await session.toggleCamera();
  } catch (err) {
    toast(mediaErrorText(err, 'камера'));
  }
}

function toggleScreen() {
  const session = activeSession();
  if (!session) return;
  if (session.local.tracks.screen) return session.stopScreen();
  if (noVideoRight()) return;
  openScreenPicker();
}

let pickedSource = null;

async function openScreenPicker() {
  // В браузере экран выбирают в системном окне браузера
  if (!window.desktop?.screen) {
    try {
      await activeSession()?.startScreen({ mode: 'motion', audio: true });
    } catch (err) {
      if (err.name !== 'NotAllowedError') toast(mediaErrorText(err, 'экран'));
    }
    return;
  }

  pickedSource = null;
  $('screen-start').disabled = true;
  $('screen-error').textContent = '';
  $('screen-audio').checked = store.get('screenAudio', false);
  for (const r of document.querySelectorAll('input[name="screen-mode"]')) r.checked = r.value === store.get('screenMode', 'motion');
  $('screen-sources').innerHTML = '<p class="muted">Загрузка…</p>';
  $('screen-picker').classList.remove('hidden');

  let sources;
  try {
    sources = await window.desktop.screen.sources();
  } catch (err) {
    $('screen-sources').replaceChildren();
    $('screen-error').textContent = 'Не удалось получить список экранов: ' + cleanError(err);
    return;
  }
  const box = $('screen-sources');
  box.replaceChildren();
  for (const [title, list] of [
    ['Экраны', sources.filter((s) => s.screen)],
    ['Окна', sources.filter((s) => !s.screen)],
  ]) {
    if (!list.length) continue;
    const h = document.createElement('h4');
    h.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'source-grid';
    for (const s of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'source';
      const img = document.createElement('img');
      img.src = s.thumbnail;
      img.alt = '';
      const name = document.createElement('span');
      name.className = 'ellipsis';
      name.textContent = s.name;
      b.title = s.name;
      b.append(img, name);
      b.onclick = () => {
        pickedSource = s.id;
        for (const el of box.querySelectorAll('.source')) el.classList.toggle('selected', el === b);
        $('screen-start').disabled = false;
      };
      b.ondblclick = () => $('screen-start').click();
      grid.append(b);
    }
    box.append(h, grid);
  }
  // Один экран — сразу выбран
  if (sources.filter((s) => s.screen).length === 1) box.querySelector('.source')?.click();
}

function closeScreenPicker() {
  $('screen-picker').classList.add('hidden');
  $('screen-sources').replaceChildren();
}

async function startScreenShare() {
  const session = activeSession();
  if (!session || !pickedSource) return closeScreenPicker();
  const audio = $('screen-audio').checked;
  const mode = document.querySelector('input[name="screen-mode"]:checked')?.value || 'motion';
  store.set('screenAudio', audio);
  store.set('screenMode', mode);
  $('screen-start').disabled = true;
  try {
    await window.desktop.screen.choose(pickedSource, audio);
    await session.startScreen({ mode, audio });
    closeScreenPicker();
  } catch (err) {
    $('screen-error').textContent = mediaErrorText(err, 'экран');
    $('screen-start').disabled = false;
  }
}

// ---------- Шумоподавление ----------

function renderNoiseButton() {
  const on = state.settings.noiseSuppression;
  $('call-ns').innerHTML = on ? ICONS.noise : ICONS.noiseOff;
  $('call-ns').classList.toggle('on', on);
  $('call-ns').title = on ? 'Шумоподавление включено — нажмите, чтобы выключить' : 'Шумоподавление выключено — нажмите, чтобы включить';
}

/** Включает или выключает шумоподавление сразу, без переподключения к разговору */
async function setNoiseSuppression(on) {
  state.settings = { ...state.settings, noiseSuppression: on };
  store.set('audio', state.settings);
  renderNoiseButton();
  if ($('set-ns')) $('set-ns').checked = on;
  const session = activeSession();
  if (session) await session.switchMic(state.settings).catch((err) => toast(mediaErrorText(err)));
  toast(on ? 'Шумоподавление включено' : 'Шумоподавление выключено');
}

$('call-ns').onclick = () => setNoiseSuppression(!state.settings.noiseSuppression);
$('call-cam').onclick = toggleCamera;
$('voice-cam').onclick = toggleCamera;
$('call-screen').onclick = toggleScreen;
$('voice-screen').onclick = toggleScreen;
$('screen-cancel').onclick = closeScreenPicker;
$('screen-start').onclick = startScreenShare;
$('hangup-btn').onclick = () => (state.call ? hangup() : leaveRoomVoice());
$('voice-leave').onclick = () => (state.call ? hangup() : leaveRoomVoice());
$('voice-where').onclick = (e) => {
  e.preventDefault();
  if (state.call) selectContact(state.call.peerId);
  else if (state.room) selectRoom(state.room.roomId);
};
