// Панель разговора — общая для звонка и голосовой комнаты: плитки участников (камера, экран или аватар),
// кнопки микрофона, камеры и экрана, качество связи и окно выбора экрана для демонстрации

const activeSession = () => state.call?.session || state.room?.session || null;
const speaking = new Map(); // 'me' или id собеседника -> говорит ли сейчас
let focusedTile = null; // плитка, развёрнутая на всю панель (по клику)
let voiceTimer = null;

// Без права говорить в комнате микрофон выключен, что бы ни стояло на кнопке
// Рация включена — микрофон слышно, только пока держат клавишу
const pttMode = () => Boolean(state.settings.ptt && state.settings.pttBinding && window.desktop?.ptt);
const audioFlags = () => ({ muted: state.muted || state.deafened || forcedMute() || (pttMode() && !state.pttDown), deafened: state.deafened });

function newSession(sendSignal) {
  return new MediaSession(sessionOptions(sendSignal));
}

// Что сессия разговора сообщает интерфейсу — одинаково для «каждый с каждым» и для медиасервера
function sessionOptions(sendSignal) {
  return {
    settings: state.settings,
    sendSignal,
    onChange() {
      renderVoice();
      sendRoomState();
    },
    onSpeaking: (who, on) => setSpeaking(who, on && (who === 'me' || voiceAllowed(who).speak)),
    onPeerState,
    // Раз в 2 секунды: качество связи и статистика трансляций на плитках
    onStats() {
      renderVoiceStatus();
      renderStage();
    },
    volumeOf: (id) => store.get(`volume:${id}`, 100) / 100,
    // Звук трансляции — своя громкость у каждого человека
    screenVolumeOf: (id) => store.get(`volume:screen:${id}`, 100) / 100,
    allowed: voiceAllowed,
  };
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
  if (local.tracks.screen) tiles.push({ key: 'me:screen', user: state.me, isMe: true, screen: true, video: local.tracks.screen, stats: session.screenStats });

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
    // Чужую трансляцию смотрят по желанию: пока не смотрим — карточка с кнопкой «Смотреть»
    if (p.media.screen && allowed.video) {
      const watching = session.watching.has(p.id);
      tiles.push({ key: `u${p.id}:screen`, id: p.id, user, screen: true, watching, video: watching ? p.tracks.screen || null : null, stats: watching ? p.screenStats : null, quality: p.quality });
    }
  }

  // Звонок ещё не принят — показываем собеседника заранее
  if (state.call && !session.peers.size) {
    tiles.push({ key: `u${state.call.peerId}`, id: state.call.peerId, user: state.call.peer, connecting: true });
  }
  return tiles;
}

/** Ползунок громкости: значение хранится в store под своим ключом */
function volumeSlider(title, key, onSet, icon = ICONS.volume) {
  const label = document.createElement('label');
  label.className = 'tile-volume';
  label.title = title;
  label.innerHTML = icon;
  const range = document.createElement('input');
  range.type = 'range';
  range.min = 0;
  range.max = 100;
  range.value = store.get(key, 100);
  range.oninput = () => {
    store.set(key, Number(range.value));
    onSet(range.value / 100);
  };
  range.onclick = (e) => e.stopPropagation();
  label.append(range);
  return label;
}

/** Громкость: у плитки экрана — звук трансляции, у плитки человека — его голос. Это разные ползунки */
function tileVolumes(t) {
  const box = document.createElement('div');
  box.className = 'tile-volumes';
  box.dataset.screen = String(Boolean(t.screen));
  if (t.screen) {
    box.append(volumeSlider('Громкость трансляции', `volume:screen:${t.id}`, (v) => activeSession()?.setScreenVolume(t.id, v), ICONS.screen));
  } else {
    box.append(volumeSlider('Громкость голоса', `volume:${t.id}`, (v) => activeSession()?.setVolume(t.id, v)));
  }
  return box;
}

function createTile(t) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.key = t.key;
  el.innerHTML = `
    <video autoplay playsinline muted></video>
    <div class="tile-avatar"></div>
    <div class="tile-label"><span class="tile-name ellipsis"></span><span class="tile-icons"></span></div>
    <div class="tile-stats"></div>
    <div class="tile-tools"></div>`;
  const tools = el.querySelector('.tile-tools');

  // Громкость: голос и звук трансляции — раздельно, у каждого человека своя и запоминается
  if (!t.isMe) tools.append(tileVolumes(t));

  // Чужая трансляция: «Смотреть» посередине и «Перестать смотреть» среди кнопок плитки
  if (t.screen && !t.isMe) {
    const watch = document.createElement('button');
    watch.type = 'button';
    watch.className = 'tile-watch';
    watch.title = 'Смотреть трансляцию';
    watch.innerHTML = `${ICONS.eye}<span>Смотреть</span>`;
    watch.onclick = (e) => {
      e.stopPropagation();
      activeSession()?.setWatching(t.id, true);
    };
    el.append(watch);
    const unwatch = document.createElement('button');
    unwatch.className = 'tile-btn tile-unwatch';
    unwatch.title = 'Перестать смотреть';
    unwatch.innerHTML = ICONS.eyeOff;
    unwatch.onclick = (e) => {
      e.stopPropagation();
      if (fullView === t.key) closeFullView();
      if (floatView === t.key) closeFloating();
      activeSession()?.setWatching(t.id, false);
    };
    tools.append(unwatch);

    // Увести показ в плавающее окно поверх переписки
    const pip = document.createElement('button');
    pip.className = 'tile-btn tile-pip';
    pip.title = 'Плавающее окно';
    pip.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="11" y="11" width="8" height="6" rx="1"/></svg>';
    pip.onclick = (e) => {
      e.stopPropagation();
      openFloating(t.key);
    };
    tools.append(pip);
  }

  const full = document.createElement('button');
  full.className = 'tile-btn tile-full';
  full.title = 'Во весь экран (двойной щелчок)';
  full.innerHTML = ICONS.expand;
  full.onclick = (e) => {
    e.stopPropagation();
    openFullView(t.key);
  };
  tools.append(full);

  el.onclick = () => {
    // По чужой трансляции щелчок сразу включает показ — кнопка не единственный вход
    if (t.screen && !t.isMe && !t.watching) {
      activeSession()?.setWatching(t.id, true);
      return;
    }
    focusedTile = focusedTile === t.key ? null : t.key;
    renderStage();
  };
  el.ondblclick = () => openFullView(t.key);
  return el;
}

function tileName(t) {
  const name = channelNickOf(t.id) || t.user.displayName || t.user.username || '';
  return t.isMe ? (t.screen ? 'Ваш экран' : 'Вы') : t.screen ? `Экран: ${name}` : name;
}

function updateTile(el, t, focused) {
  const video = el.querySelector('video');
  // Начал или закончил показывать экран — добавляем или убираем ползунок звука трансляции
  if (!t.isMe) {
    const tools = el.querySelector('.tile-tools');
    const box = tools.querySelector('.tile-volumes');
    if (box && box.dataset.screen !== String(Boolean(t.screen))) {
      const fresh = tileVolumes(t);
      if (box) box.replaceWith(fresh);
      else tools.prepend(fresh);
    }
  }
  el.classList.toggle('focused', focused);
  el.classList.toggle('screen', Boolean(t.screen));
  el.classList.toggle('speaking', Boolean(t.speaking) && !t.screen);
  el.classList.toggle('connecting', Boolean(t.connecting));
  el.classList.toggle('has-video', Boolean(t.video));
  el.classList.toggle('not-watching', Boolean(t.screen && !t.isMe && !t.watching));
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

  el.querySelector('.tile-name').textContent = tileName(t);

  const icons = el.querySelector('.tile-icons');
  icons.replaceChildren();
  if (t.screen) icons.insertAdjacentHTML('beforeend', '<b class="live">В ЭФИРЕ</b>');
  icons.insertAdjacentHTML('beforeend', voiceStateIcons({ userId: t.user.id, muted: t.muted, deafened: t.deafened }));
  if (!t.isMe && !t.screen && !t.connecting) icons.append(qualityBars(t.quality));
  el.title = t.connecting ? 'Соединение…' : t.quality ? qualityText(t.quality) : '';
  el.querySelector('.tile-stats').textContent = t.screen ? videoStatsText(t.stats) : '';
}

function renderStage() {
  const stage = $('stage');
  const strip = $('tile-strip');
  const tiles = voiceTiles();
  if (focusedTile && !tiles.some((t) => t.key === focusedTile)) focusedTile = null;
  // Чужой экран, который смотрим, сам разворачивается на всю панель
  const focus = focusedTile || tiles.find((t) => t.screen && !t.isMe && t.watching)?.key || null;
  stage.classList.toggle('has-focus', Boolean(focus));
  stage.classList.toggle('has-video', tiles.some((t) => t.video));

  // Пока смотрим экран, профили живут отдельной строкой с прокруткой: большой экран их не съедает
  const stageTiles = focus ? tiles.filter((t) => t.key === focus) : tiles;
  const stripTiles = focus ? tiles.filter((t) => t.key !== focus) : [];

  // Плитки двигаем, только если порядок поменялся: перенос элемента сбивает щелчок и выводит его из полноэкранного режима
  const place = (container, list) => {
    const existing = new Map([...container.children].map((el) => [el.dataset.key, el]));
    list.forEach((t, i) => {
      let el = existing.get(t.key);
      if (el) existing.delete(t.key);
      // Плитка могла переехать из другой строки — тогда берём существующий элемент, а не создаём новый
      else el = $('call-panel').querySelector(`.tile[data-key="${t.key}"]`) || null;
      if (!el) el = createTile(t);
      updateTile(el, t, t.key === focus);
      if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null);
    });
    for (const el of existing.values()) el.remove();
  };
  place(stage, stageTiles);
  place(strip, stripTiles);
  // Плитки, которых больше нет в разговоре
  for (const el of $('call-panel').querySelectorAll('.tile')) {
    if (!tiles.some((t) => t.key === el.dataset.key)) el.remove();
  }
  updateFullView();
  updateFloating();
}

// ---------- Просмотр развёрнуто и в плавающем окне ----------
// Развернуть можно внутри приложения (на всё его окно) и во весь монитор — это две разные
// вещи, переключаются кнопкой. Отдельно трансляцию можно увести в плавающее окно поверх чатов

let fullView = null; // ключ плитки, которую смотрим развёрнуто
let fullViewBarTimer = null;

function openFullView(key) {
  if (!voiceTiles().some((t) => t.key === key && t.video)) return;
  closeFloating();
  fullView = key;
  $('fullview').classList.remove('hidden');
  updateFullView();
  showFullViewBar();
  updateFullViewScreenButton();
}

function closeFullView() {
  if (!fullView) return;
  fullView = null;
  clearTimeout(fullViewBarTimer);
  $('fullview').classList.add('hidden');
  $('fullview-video').srcObject = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function updateFullView() {
  if (!fullView) return;
  const t = voiceTiles().find((x) => x.key === fullView);
  if (!t?.video) return closeFullView(); // показ закончился или человек вышел
  const video = $('fullview-video');
  if (video.srcObject?.getVideoTracks()[0] !== t.video) video.srcObject = new MediaStream([t.video]);
  if (video.paused) video.play().catch(() => {});
  video.classList.toggle('mirror', Boolean(t.isMe && !t.screen));
  $('fullview-name').textContent = tileName(t);
  const size = video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '';
  $('fullview-info').textContent = [size, t.quality && qualityText(t.quality)].filter(Boolean).join(' · ');
}

// Кнопка говорит, что произойдёт: развернуть на весь монитор или вернуть в окно приложения
function updateFullViewScreenButton() {
  $('fullview-screen').textContent = document.fullscreenElement ? 'Свернуть в окно' : 'Во весь экран';
}

// ---------- Плавающее окно ----------

let floatView = null; // ключ плитки в плавающем окне
// true — картинка ушла в отдельное окно Windows; иначе показываем её внутри приложения
let pipActive = false;
const FLOAT_SIZES = ['small', 'medium', 'large'];

const floatBox = () => $('stream-float');

function applyFloatSize(size) {
  const box = floatBox();
  box.classList.remove(...FLOAT_SIZES.map((s) => `size-${s}`));
  box.classList.add(`size-${FLOAT_SIZES.includes(size) ? size : 'small'}`);
}

function placeFloating() {
  applyFloatSize(store.get('float:size', 'small'));
  const pos = store.get('float:pos', null);
  const box = floatBox();
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    box.classList.remove('at-corner');
    box.style.left = `${Math.max(4, Math.min(pos.x, innerWidth - 120))}px`;
    const safeTop = document.documentElement.classList.contains('is-win') ? 44 : 4;
    box.style.top = `${Math.max(safeTop, Math.min(pos.y, innerHeight - 80))}px`;
  } else {
    box.classList.add('at-corner');
    box.style.left = '';
    box.style.top = '';
  }
}

/** В приложении плавающее окно — отдельное окно Windows, в браузере — картинка внутри страницы */
const nativePip = () => Boolean(window.desktop?.pip);

let pipVideo = null;
let pipTimer = null;
let pipCanvas = null;

/** Скрытое видео, из которого снимаем кадры для отдельного окна */
function pipSource() {
  if (!pipVideo) {
    pipVideo = document.createElement('video');
    pipVideo.autoplay = true;
    pipVideo.muted = true;
    pipVideo.playsInline = true;
    // Не display:none — иначе браузер перестаёт рисовать кадры, и снимать нечего
    pipVideo.style.cssText = 'position:fixed;left:-4px;top:-4px;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.append(pipVideo);
  }
  return pipVideo;
}

function startPipFrames() {
  stopPipFrames();
  pipCanvas ??= document.createElement('canvas');
  pipTimer = setInterval(() => {
    const t = floatView && voiceTiles().find((x) => x.key === floatView);
    if (!t?.video) return;
    const v = pipSource();
    if (v.srcObject?.getVideoTracks()[0] !== t.video) {
      v.srcObject = new MediaStream([t.video]);
      v.play().catch(() => {});
    }
    if (!v.videoWidth) return;
    // 960 px по ширине и 20 кадров в секунду — картинка читаемая, а канал не забит
    const w = Math.min(960, v.videoWidth);
    const h = Math.round((v.videoHeight * w) / v.videoWidth);
    if (pipCanvas.width !== w || pipCanvas.height !== h) {
      pipCanvas.width = w;
      pipCanvas.height = h;
    }
    pipCanvas.getContext('2d').drawImage(v, 0, 0, w, h);
    window.desktop.pip.frame(pipCanvas.toDataURL('image/jpeg', 0.7));
  }, 50);
}

function stopPipFrames() {
  clearInterval(pipTimer);
  pipTimer = null;
}

async function openFloating(key) {
  const t = voiceTiles().find((x) => x.key === key && x.video);
  if (!t) return;
  floatView = key;
  pipActive = false;
  if (nativePip()) {
    // Размер и место отдельного окна запоминаем
    try {
      // Если главный процесс не ответил за секунду, не ждём: показываем окно внутри приложения
      const res = await Promise.race([
        window.desktop.pip.open({ title: `Экран: ${tileName(t)}`, bounds: store.get('pip:bounds', null) }).catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), 1200)),
      ]);
      // Успех — только явное подтверждение главного процесса
      if (res?.ok === true) {
        pipActive = true;
        startPipFrames();
        return;
      }
    } catch {
      // Отдельное окно не открылось (нет прав, сбой системы) — показываем внутри приложения
    }
    if (!floatView) return;
  }
  floatBox().classList.remove('hidden');
  placeFloating();
  updateFloating();
}

function closeFloating() {
  if (!floatView) return;
  floatView = null;
  const wasPip = pipActive;
  pipActive = false;
  stopPipFrames();
  if (wasPip && nativePip()) window.desktop.pip.close();
  floatBox().classList.add('hidden');
  $('stream-float-video').srcObject = null;
}

// Окно закрыли крестиком или Alt+F4 — прекращаем снимать кадры и запоминаем его размер
window.desktop?.pip?.onClosed?.((bounds) => {
  if (bounds && Number.isFinite(bounds.width)) store.set('pip:bounds', bounds);
  if (!floatView) return;
  floatView = null;
  stopPipFrames();
});

function updateFloating() {
  if (!floatView) return;
  const t = voiceTiles().find((x) => x.key === floatView);
  if (!t?.video) return closeFloating();
  // В отдельном окне картинку собирает startPipFrames, страница для этого не нужна
  if (pipActive) return;
  const video = $('stream-float-video');
  if (video.srcObject?.getVideoTracks()[0] !== t.video) video.srcObject = new MediaStream([t.video]);
  if (video.paused) video.play().catch(() => {});
  video.classList.toggle('mirror', Boolean(t.isMe && !t.screen));
  $('stream-float-name').textContent = tileName(t);
}

// Панель с названием и кнопкой выхода видна при движении мыши и прячется через 2,5 секунды
function showFullViewBar() {
  $('fullview').classList.add('show-bar');
  clearTimeout(fullViewBarTimer);
  fullViewBarTimer = setTimeout(() => $('fullview').classList.remove('show-bar'), 2500);
}

$('fullview').onmousemove = showFullViewBar;
$('fullview-video').ondblclick = closeFullView;
$('fullview-exit').onclick = closeFullView;
$('fullview-screen').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else $('fullview').requestFullscreen().catch(() => {});
};
$('fullview-float').onclick = () => {
  const key = fullView;
  if (!key) return;
  closeFullView();
  openFloating(key);
};
// Выход из полноэкранного режима ОС не закрывает просмотр — остаёмся развёрнутыми в окне
document.addEventListener('fullscreenchange', updateFullViewScreenButton);

// Перетаскивание плавающего окна за заголовок
let floatDrag = null;
$('stream-float-bar').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  const r = floatBox().getBoundingClientRect();
  floatDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  floatBox().classList.remove('at-corner');
  e.preventDefault();
});
addEventListener('pointermove', (e) => {
  if (!floatDrag) return;
  const box = floatBox();
  const x = Math.max(4, Math.min(e.clientX - floatDrag.dx, innerWidth - box.offsetWidth - 4));
  const safeTop = document.documentElement.classList.contains('is-win') ? 44 : 4;
  const y = Math.max(safeTop, Math.min(e.clientY - floatDrag.dy, innerHeight - box.offsetHeight - 4));
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  store.set('float:pos', { x, y });
});
addEventListener('pointerup', () => {
  floatDrag = null;
});
$('stream-float-close').onclick = closeFloating;
$('stream-float-size').onclick = () => {
  const cur = store.get('float:size', 'small');
  const next = FLOAT_SIZES[(FLOAT_SIZES.indexOf(cur) + 1) % FLOAT_SIZES.length];
  store.set('float:size', next);
  applyFloatSize(next);
};
$('stream-float-restore').onclick = () => {
  const key = floatView;
  closeFloating();
  if (key) openFullView(key);
};

function setSpeaking(who, isSpeaking) {
  speaking.set(who, isSpeaking);
  const key = who === 'me' ? 'me' : `u${who}`;
  $('call-panel').querySelector(`.tile[data-key="${key}"]`)?.classList.toggle('speaking', isSpeaking);
  const id = who === 'me' ? state.me?.id : who;
  for (const el of document.querySelectorAll(`[data-voice-user="${id}"]`)) el.classList.toggle('speaking', isSpeaking);
}

// ---------- Панель целиком ----------

function voiceTitle() {
  if (state.call) {
    const ids = state.call.session.peers.size ? [...state.call.session.peers.keys()] : [state.call.peerId];
    return `Звонок: ${ids.map((id) => userById(id)?.displayName || '…').join(', ')}`;
  }
  if (state.room) return state.rooms.get(state.room.roomId)?.name || 'Голосовая комната';
  return '';
}

function renderVoice() {
  syncPreviews();
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
    closeFullView();
    $('stage').replaceChildren();
    $('tile-strip').replaceChildren();
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
    $(id).title = screen ? 'Сменить окно или качество, остановить показ' : 'Показать экран';
  }
  $('hangup-btn').title = state.room ? 'Выйти из голосового канала' : 'Завершить звонок';
  renderNoiseButton();

  // Панель «В голосе» над профилем — видна из любого места приложения
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
    // Время разговора — по серверным часам и от первого вошедшего: иначе в панели и в списке
    // комнат получаются разные цифры
    const since = roomById(room.roomId)?.voiceSince;
    const elapsed = Number.isFinite(since) ? serverNow() - since : Date.now() - room.connectedAt;
    text = room.joined
      ? `${formatDuration(elapsed)} · ${count} ${plural(count, 'участник', 'участника', 'участников')}`
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
  renderCallCode(session.code);
  // Позвать ещё кого-то можно в личный звонок, когда уже соединились
  $('call-add').classList.toggle('hidden', !(state.call && connected));

  // Значки качества на плитках собеседников
  for (const p of session.peers.values()) {
    const tile = $('call-panel').querySelector(`.tile[data-key="u${p.id}"]`);
    const bars = tile?.querySelector('.q-bars');
    if (bars && p.quality) {
      setQualityBars(bars, p.quality);
      tile.title = qualityText(p.quality);
    }
  }

  updateFullView();
  $('voice-state').textContent = connected ? 'В голосе' : 'Подключение…';
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
      if (state.call !== call) return;
      // Связи с сервером нет — звонок не рвём сами: сервер держит наше место, ждём переподключения
      if (!Api.online) return;
      if (call.phase !== 'connected') hangup('Связь потеряна');
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
  if (noVideoRight()) return;
  openScreenPicker({ change: Boolean(session.local.tracks.screen) });
}

let pickedSource = null;

let sharingSource = null; // что показываем сейчас — в окне смены уже выбрано

/** change — показ уже идёт: можно сменить окно и качество или остановить */
async function openScreenPicker({ change = false } = {}) {
  // В браузере экран выбирают в системном окне браузера
  if (!window.desktop?.screen) {
    try {
      await activeSession()?.startScreen({ audio: true });
    } catch (err) {
      if (err.name !== 'NotAllowedError') toast(mediaErrorText(err, 'экран'));
    }
    return;
  }

  pickedSource = change ? sharingSource : null;
  $('screen-title').textContent = change ? 'Сменить трансляцию' : 'Что показать?';
  $('screen-start').textContent = change ? 'Сменить' : 'Начать показ';
  $('screen-stop').classList.toggle('hidden', !change);
  $('screen-start').disabled = true;
  $('screen-error').textContent = '';
  $('screen-audio').checked = store.get('screenAudio', false);
  const savedMode = screenMode(store.get('screenMode', DEFAULT_SCREEN_MODE));
  for (const r of document.querySelectorAll('input[name="screen-mode"]')) r.checked = r.value === savedMode;
  $('screen-text').checked = store.get('screenText', false);
  $('screen-picker').classList.remove('hidden');
  await loadScreenSources(store.get('screenTab', 'screen'));
}

// Две вкладки: «Весь экран» (мониторы) и «Окно приложения» (игра, браузер, любая программа)
let screenSourceList = [];
let screenTab = 'screen';

async function loadScreenSources(tab = screenTab) {
  $('screen-sources').innerHTML = '<p class="muted">Загрузка…</p>';
  try {
    screenSourceList = await window.desktop.screen.sources();
  } catch (err) {
    screenSourceList = [];
    $('screen-sources').replaceChildren();
    $('screen-error').textContent = 'Не удалось получить список экранов: ' + cleanError(err);
    return;
  }
  showScreenTab(tab);
}

function showScreenTab(tab) {
  screenTab = tab;
  store.set('screenTab', tab);
  const screens = screenSourceList.filter((s) => s.screen);
  const windows = screenSourceList.filter((s) => !s.screen);
  $('screen-count-screen').textContent = screens.length ? `(${screens.length})` : '';
  $('screen-count-window').textContent = windows.length ? `(${windows.length})` : '';
  for (const t of document.querySelectorAll('#screen-tabs .tab')) t.classList.toggle('active', t.dataset.tab === tab);

  const list = tab === 'screen' ? screens : windows;
  const box = $('screen-sources');
  box.replaceChildren();
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = tab === 'screen' ? 'Экраны не найдены.' : 'Открытых окон нет. Запустите игру или программу и нажмите «Обновить список».';
    box.append(p);
  }
  const grid = document.createElement('div');
  grid.className = 'source-grid';
  for (const s of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'source';
    b.classList.toggle('selected', s.id === pickedSource);
    const preview = document.createElement('div');
    preview.className = 'source-preview';
    if (s.thumbnail) {
      const img = document.createElement('img');
      img.src = s.thumbnail;
      img.alt = '';
      preview.append(img);
    } else {
      // Свёрнутое окно: картинки нет, показываем значок приложения
      preview.classList.add('empty');
      preview.textContent = 'Окно свёрнуто — разверните его, иначе друзья увидят чёрный экран';
    }
    const caption = document.createElement('span');
    caption.className = 'source-name';
    if (s.icon) {
      const icon = document.createElement('img');
      icon.src = s.icon;
      icon.alt = '';
      icon.className = 'source-icon';
      caption.append(icon);
    }
    const name = document.createElement('span');
    name.className = 'ellipsis';
    name.textContent = s.name;
    caption.append(name);
    b.title = s.name;
    b.append(preview, caption);
    b.onclick = () => {
      pickedSource = s.id;
      for (const el of box.querySelectorAll('.source')) el.classList.toggle('selected', el === b);
      $('screen-start').disabled = false;
    };
    b.ondblclick = () => $('screen-start').click();
    grid.append(b);
  }
  box.append(grid);
  $('screen-start').disabled = !screenSourceList.some((s) => s.id === pickedSource);
  // Один экран — сразу выбран
  if (tab === 'screen' && screens.length === 1 && !pickedSource) box.querySelector('.source')?.click();
}

for (const t of document.querySelectorAll('#screen-tabs .tab')) t.onclick = () => showScreenTab(t.dataset.tab);
$('screen-refresh').onclick = () => loadScreenSources();

function closeScreenPicker() {
  $('screen-picker').classList.add('hidden');
  $('screen-sources').replaceChildren();
}

async function startScreenShare() {
  const session = activeSession();
  if (!session || !pickedSource) return closeScreenPicker();
  const audio = $('screen-audio').checked;
  const mode = document.querySelector('input[name="screen-mode"]:checked')?.value || DEFAULT_SCREEN_MODE;
  const text = $('screen-text').checked;
  store.set('screenAudio', audio);
  store.set('screenMode', mode);
  store.set('screenText', text);
  $('screen-start').disabled = true;
  try {
    await window.desktop.screen.choose(pickedSource, audio);
    await session.startScreen({ mode, text, audio });
    sharingSource = pickedSource;
    closeScreenPicker();
  } catch (err) {
    $('screen-error').textContent = mediaErrorText(err, 'экран');
    $('screen-start').disabled = false;
  }
}

// ---------- Шумоподавление ----------

// Уровни: 0 — выкл, 1 — мягкое, 2 — среднее, 3 — сильное. Интенсивность — доля очищенного
// звука в миксе (см. denoiseTrack в call.js), поэтому «мягкое» сохраняет дыхание комнаты
const NOISE_LEVELS = [
  { value: 0, name: 'Выключено' },
  { value: 1, name: 'Мягкое' },
  { value: 2, name: 'Среднее' },
  { value: 3, name: 'Сильное' },
];
let lastNoiseLevel = 2; // что включить, если человек выключил и снова нажал

function renderNoiseButton() {
  const level = noiseLevelOf();
  const on = level > 0;
  const name = NOISE_LEVELS.find((l) => l.value === level)?.name ?? '';
  $('call-ns').innerHTML = on ? ICONS.noise : ICONS.noiseOff;
  $('call-ns').classList.toggle('on', on);
  $('call-ns').title = on
    ? `Шумоподавление: ${name.toLowerCase()} — нажмите, чтобы выключить, или правой кнопкой для уровня`
    : 'Шумоподавление выключено — нажмите, чтобы включить';
}

/** Уровень шумоподавления применяется сразу, без переподключения к разговору */
async function setNoiseLevel(level) {
  const value = Math.min(3, Math.max(0, Number(level) || 0));
  if (value > 0) lastNoiseLevel = value;
  state.settings = { ...state.settings, noiseLevel: value };
  store.set('audio', state.settings);
  renderNoiseButton();
  if ($('set-ns-level')) $('set-ns-level').value = String(value);
  const session = activeSession();
  if (session) await session.switchMic(state.settings).catch((err) => toast(mediaErrorText(err)));
  const name = NOISE_LEVELS.find((l) => l.value === value)?.name ?? '';
  toast(value ? `Шумоподавление: ${name.toLowerCase()}` : 'Шумоподавление выключено');
}

/** Меню уровней: одно и то же в звонке, голосовом канале и по правой кнопке на кнопке микрофона */
function openNoiseMenu(x, y) {
  const level = noiseLevelOf();
  showMenu(
    x,
    y,
    NOISE_LEVELS.map((l) => ({
      label: `${l.value === level ? '✓ ' : ''}${l.name}`,
      onclick: () => setNoiseLevel(l.value),
    }))
  );
}

$('call-ns').onclick = () => setNoiseLevel(noiseLevelOf() > 0 ? 0 : lastNoiseLevel);
// Правая кнопка в звонке и в голосовом канале — выбор интенсивности
$('call-ns').oncontextmenu = (e) => {
  e.preventDefault();
  e.stopPropagation();
  openNoiseMenu(e.clientX, e.clientY);
};
$('call-panel').oncontextmenu = (e) => {
  if (e.target.closest('input, textarea, select, a')) return;
  e.preventDefault();
  openNoiseMenu(e.clientX, e.clientY);
};
$('call-cam').onclick = toggleCamera;
$('voice-cam').onclick = toggleCamera;
$('call-screen').onclick = toggleScreen;
$('voice-screen').onclick = toggleScreen;
$('screen-cancel').onclick = closeScreenPicker;
$('screen-start').onclick = startScreenShare;
$('screen-stop').onclick = () => {
  activeSession()?.stopScreen();
  closeScreenPicker();
};
$('hangup-btn').onclick = () => (state.call ? hangup() : leaveRoomVoice());
$('voice-leave').onclick = () => (state.call ? hangup() : leaveRoomVoice());
$('voice-where').onclick = (e) => {
  e.preventDefault();
  if (state.call) selectContact(state.call.peerId);
  else if (state.room) selectRoom(state.room.roomId);
};

// ---------- Код шифрования ----------

/** Замок, четыре смайлика и цифры: одинаковы у всех участников, если разговор не перехватили */
function renderCallCode(code) {
  const chip = $('call-code');
  chip.classList.toggle('hidden', !code);
  if (!code) return;
  chip.innerHTML = '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const emoji = document.createElement('span');
  emoji.className = 'code-emoji';
  emoji.textContent = code.emoji.join(' ');
  const digits = document.createElement('span');
  digits.className = 'code-digits';
  digits.textContent = code.digits;
  chip.append(emoji, digits);
  chip.title = 'Сквозное шифрование: звук и видео идут напрямую и шифруются ключами на ваших компьютерах. Сверьте код с собеседниками — у всех он должен быть одинаковым';
}

$('call-code').onclick = () => {
  const code = activeSession()?.code;
  if (code) toast(`Код шифрования: ${code.emoji.join(' ')} ${code.digits}. Если у собеседников такой же — разговор слышат только участники`, 7000);
};
