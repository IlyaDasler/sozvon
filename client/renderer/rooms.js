// Комнаты: голосовые (общий голосовой канал с видео и демонстрацией экрана + чат) и текстовые (только чат)

const ROOM_ERRORS = {
  'not-member': 'Вы не участник этой комнаты',
  'no-access': 'Вам нельзя заходить в голосовой канал этой комнаты',
  'in-call': 'Сначала завершите звонок',
  full: 'В голосовом канале уже 10 человек — больше не поместится',
};

// Почему сервер отключил от голоса
const VOICE_LEFT = {
  moved: 'Вы подключились к голосу с другого устройства',
  'no-access': 'У вас больше нет права заходить в этот голосовой канал',
  disconnected: 'Вас отключили от голосового канала',
};

const roomIcon = (room) => (room.kind === 'voice' ? ICONS.speaker : ICONS.hash);
const roomById = (id) => state.rooms.get(id);
const ROOM_TOOLS = { settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>', invite: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/></svg>' };

// ---------- Права (те же числа, что в server/src/perms.js) ----------

const PERMS = { connect: 1, speak: 2, video: 4, write: 8, invite: 16, kick: 32, ban: 64, manage: 128, admin: 256 };
const ALL_PERMS = 511;
const memberOf = (room, userId) => room?.members.find((m) => m.id === userId);

/** До какого момента участник кикнут на время (создателя не кикают), или null */
function timeoutOf(room, userId = state.me.id) {
  const until = memberOf(room, userId)?.timeoutUntil;
  return room.ownerId !== userId && until > Date.now() ? until : null;
}
const roleOf = (room, userId) => {
  const m = memberOf(room, userId);
  return (m?.roleId && room.roles?.find((r) => r.id === m.roleId)) || null;
};

function permsIn(room, userId = state.me.id) {
  if (!room || room.ownerId === userId) return ALL_PERMS;
  if (!memberOf(room, userId)) return 0;
  // Кикнутый на время только читает чат
  if (timeoutOf(room, userId)) return 0;
  const perms = roleOf(room, userId)?.perms ?? room.defaultPerms ?? ALL_PERMS;
  return perms & PERMS.admin ? ALL_PERMS : perms;
}

const can = (room, perm, userId) => Boolean(permsIn(room, userId) & perm);

// Старшинство: создатель > администратор > модератор > остальные — как на сервере
function rankIn(room, userId) {
  if (room.ownerId === userId) return 4;
  const perms = roleOf(room, userId)?.perms ?? room.defaultPerms ?? 0;
  return perms & PERMS.admin ? 3 : perms & (PERMS.kick | PERMS.ban | PERMS.manage) ? 2 : 1;
}

const outranks = (room, userId) => rankIn(room, state.me.id) > rankIn(room, userId);

/** Что собеседнику можно в текущем голосовом канале (в звонке один на один — всё) */
function voiceAllowed(id) {
  const room = state.room && roomById(state.room.roomId);
  return room ? { speak: can(room, PERMS.speak, id), video: can(room, PERMS.video, id) } : { speak: true, video: true };
}

/** Самому говорить нельзя — микрофон принудительно выключен */
const forcedMute = () => !voiceAllowed(state.me.id).speak;

async function refreshRooms() {
  try {
    const list = await Api.get('/rooms');
    state.rooms = new Map(list.map((r) => [r.id, r]));
    renderRooms();
    scheduleKickExpiry();
    if (state.selectedRoomId && !state.rooms.has(state.selectedRoomId)) selectRoom(null);
    else if (state.selectedRoomId) renderRoomView();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Список в боковой панели ----------

function renderRooms() {
  const list = $('room-list');
  list.replaceChildren();
  const sorted = [...state.rooms.values()].sort(
    (a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'ru') : a.kind === 'voice' ? -1 : 1)
  );

  if (!sorted.length) {
    const li = document.createElement('li');
    li.className = 'muted small pad';
    li.textContent = 'Создайте комнату и позовите друзей — разговаривать можно сразу всем вместе.';
    list.append(li);
  }

  for (const room of sorted) {
    const li = document.createElement('li');
    li.className = 'room-item';
    const row = document.createElement('div');
    row.className = `contact room-row${room.id === state.selectedRoomId ? ' active' : ''}`;
    const tool = (kind, title, onclick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `room-tool ${kind}`;
      b.title = title;
      b.innerHTML = ROOM_TOOLS[kind];
      b.onclick = (e) => {
        e.stopPropagation();
        onclick();
      };
      return b;
    };
    const tools = document.createElement('span');
    tools.className = 'room-tools';
    tools.append(tool('settings', 'Настройки комнаты', () => openRoomManage(room.id)));
    if (can(room, PERMS.invite)) tools.append(tool('invite', 'Пригласить друзей', () => openRoomInvite(room.id)));
    row.append(tools);
    row.insertAdjacentHTML('beforeend', `<span class="room-icon">${roomIcon(room)}</span>`);
    const name = document.createElement('div');
    name.className = 'name ellipsis';
    name.textContent = room.name;
    row.append(name);
    const unread = state.roomUnread.get(room.id);
    if (unread) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = unread > 99 ? '99+' : unread;
      row.append(badge);
    }
    // Голосовая комната: щелчок сразу переносит в её голосовой канал (из другого — тоже)
    row.onclick = () => openRoom(room.id);
    if (room.kind === 'voice')
      row.title = can(room, PERMS.connect) ? 'Подключиться к голосовому каналу' : 'Вам нельзя заходить в голосовой канал';
    li.append(row);

    // Кто сейчас в голосовом канале
    if (room.voice?.length) {
      const users = document.createElement('ul');
      users.className = 'voice-users';
      for (const p of room.voice) {
        const user = room.members.find((m) => m.id === p.userId) || userById(p.userId);
        if (!user) continue;
        const item = document.createElement('li');
        item.dataset.voiceUser = p.userId;
        if (speaking.get(p.userId === state.me.id ? 'me' : p.userId)) item.classList.add('speaking');
        item.append(makeAvatar(user, undefined, 'tiny'));
        const n = document.createElement('span');
        n.className = 'ellipsis';
        n.textContent = user.displayName;
        const role = roleOf(room, p.userId);
        if (role) n.style.color = role.color;
        item.append(n);
        if (p.screen) item.insertAdjacentHTML('beforeend', '<b class="live">В ЭФИРЕ</b>');
        if (p.video) item.insertAdjacentHTML('beforeend', ICONS.cam);
        if (p.deafened) item.insertAdjacentHTML('beforeend', ICONS.soundOff);
        else if (p.muted) item.insertAdjacentHTML('beforeend', ICONS.micOff);
        users.append(item);
      }
      li.append(users);
    }
    list.append(li);
  }
}

/** Свежие данные комнаты: список, страница, голос и открытые окна */
function applyRoomUpdate(room) {
  state.rooms.set(room.id, room);
  renderRooms();
  if (state.selectedRoomId === room.id) renderRoomView();
  if (state.room?.roomId === room.id) applyRoomPerms();
  if (manageRoomId === room.id) renderRoomManage();
  if (inviteRoomId === room.id && !$('room-invite').classList.contains('hidden')) renderRoomInvite();
  scheduleKickExpiry();
}

/** Комнаты больше нет (вышли, убрали, удалили) */
function forgetRoom(id) {
  state.rooms.delete(id);
  state.roomHistory.delete(id);
  state.roomUnread.delete(id);
  if (state.room?.roomId === id) finishRoomVoice();
  if (manageRoomId === id) closeRoomManage();
  if (inviteRoomId === id) $('room-invite').classList.add('hidden');
  if (state.selectedRoomId === id) selectRoom(null);
  renderRooms();
}

// Когда кик закончится, права вернутся сами: перерисовываем всё к ближайшему окончанию
let kickTimer = null;
function scheduleKickExpiry() {
  clearTimeout(kickTimer);
  const now = Date.now();
  const next = Math.min(
    ...[...state.rooms.values()].flatMap((r) => r.members.map((m) => m.timeoutUntil).filter((t) => t > now))
  );
  if (!Number.isFinite(next)) return;
  kickTimer = setTimeout(() => {
    for (const room of state.rooms.values()) applyRoomUpdate(room);
  }, Math.min(next - now + 50, 2 ** 31 - 1));
}

// ---------- Страница комнаты ----------

function openRoom(id) {
  const room = roomById(id);
  if (room?.kind === 'voice' && state.room?.roomId !== id && can(room, PERMS.connect)) joinRoomVoice(id);
  else selectRoom(id);
}

function selectRoom(id) {
  state.selectedRoomId = state.rooms.has(id) ? id : null;
  state.selectedId = null;
  state.roomUnread.delete(id);
  renderContacts();
  renderRooms();

  const room = roomById(state.selectedRoomId);
  $('chat').classList.add('hidden');
  $('room-view').classList.toggle('hidden', !room);
  $('empty-state').classList.toggle('hidden', Boolean(room));
  renderVoice();
  if (!room) return;

  renderRoomView();
  renderRoomMessages();
  roomComposer.focus();
  if (!state.roomHistory.has(room.id)) loadRoomHistory(room.id);
}

async function loadRoomHistory(id) {
  try {
    const loaded = await Api.get(`/rooms/${id}/messages`);
    const known = state.roomHistory.get(id) || [];
    const merged = new Map([...loaded, ...known].map((m) => [m.id, m]));
    state.roomHistory.set(id, [...merged.values()].sort((a, b) => a.id - b.id));
    if (state.selectedRoomId === id) renderRoomMessages();
  } catch (err) {
    toast(err.message);
  }
}

function renderRoomView() {
  const room = roomById(state.selectedRoomId);
  if (!room) return;
  $('room-icon').innerHTML = roomIcon(room);
  $('room-title').textContent = room.name;
  const count = room.members.length;
  $('room-sub').textContent = `${room.kind === 'voice' ? 'Голосовая' : 'Текстовая'} комната · ${count} ${plural(count, 'участник', 'участника', 'участников')}`;

  const isVoice = room.kind === 'voice';
  const here = state.room?.roomId === room.id;

  // Писать в чат можно не всем
  const canWrite = can(room, PERMS.write);
  const kickedUntil = timeoutOf(room);
  roomComposer.setDisabled(
    !canWrite,
    canWrite ? 'Написать в комнату'
    : kickedUntil ? `Вас кикнули до ${timeText(kickedUntil)} — пока можно только читать`
    : 'Вам нельзя писать в этой комнате'
  );

  // Кто сидит в голосе, пока ты сам не подключился
  const lobby = $('room-lobby');
  lobby.classList.toggle('hidden', !isVoice || here);
  if (isVoice && !here) {
    lobby.replaceChildren();
    const people = (room.voice || []).map((p) => room.members.find((m) => m.id === p.userId)).filter(Boolean);
    const text = document.createElement('div');
    text.className = 'muted';
    const how = can(room, PERMS.connect)
      ? `Чтобы подключиться, нажмите на «${room.name}» в списке слева.`
      : kickedUntil ? `Вас кикнули до ${timeText(kickedUntil)} — зайти в голос можно будет после.`
      : 'Вам нельзя заходить в голосовой канал этой комнаты.';
    text.textContent = people.length
      ? `Сейчас в голосовом канале: ${people.length}. ${how}`
      : `В голосовом канале пока никого. ${how}`;
    const avatars = document.createElement('div');
    avatars.className = 'lobby-people';
    for (const u of people) {
      const p = document.createElement('div');
      p.className = 'lobby-person';
      p.dataset.voiceUser = u.id;
      p.dataset.profile = u.id;
      const n = document.createElement('span');
      n.className = 'ellipsis';
      n.textContent = u.displayName;
      p.append(makeAvatar(u), n);
      avatars.append(p);
    }
    lobby.append(text, avatars);
  }
}

function renderRoomMessages() {
  const id = state.selectedRoomId;
  renderMessageList(
    $('room-messages'),
    state.roomHistory.get(id) || [],
    state.roomHistory.has(id),
    'Сообщений пока нет. Напишите первым!'
  );
}

function addRoomMessage(m) {
  const list = state.roomHistory.get(m.roomId);
  if (list && !list.some((x) => x.id === m.id)) list.push(m);
  const viewing = m.roomId === state.selectedRoomId;
  if (viewing) renderRoomMessages();
  if (m.fromId === state.me.id) return;
  if (!viewing || !document.hasFocus()) {
    if (!viewing) state.roomUnread.set(m.roomId, (state.roomUnread.get(m.roomId) || 0) + 1);
    renderRooms();
    const room = roomById(m.roomId);
    notify(room?.name || 'Комната', `${userById(m.fromId)?.displayName || '?'}: ${messageSummary(m)}`, { kind: 'room', open: { room: m.roomId } });
  }
}

// ---------- События с сервера ----------

function handleRoomEvent(msg) {
  switch (msg.type) {
    case 'room:updated': {
      const room = msg.room;
      const old = roomById(room.id);
      if (!old && room.ownerId !== state.me.id) {
        toast(`Вас добавили в комнату «${room.name}»`);
        notify('Новая комната', `Вас добавили в «${room.name}»`, { kind: 'room-invite', open: { room: room.id } });
      }
      // Меня кикнули на время — скажем, до какого момента
      const until = timeoutOf(room);
      if (until && (!old || timeoutOf(old) !== until)) {
        const text = `Вас кикнули в «${room.name}» до ${timeText(until)} — пока можно только читать чат`;
        toast(text);
        notify('Комната', text, { kind: 'room-removed', open: { room: room.id } });
      } else if (old && timeoutOf(old) && !until) toast(`Кик в «${room.name}» снят — права вернулись`);
      applyRoomUpdate(room);
      return;
    }
    case 'room:removed': {
      const room = roomById(msg.roomId);
      forgetRoom(msg.roomId);
      if (!room || msg.reason === 'left') return;
      if (msg.reason === 'banned' || msg.reason === 'kicked') {
        const text = msg.reason === 'banned' ? `Вас забанили в комнате «${room.name}»` : `Вас убрали из комнаты «${room.name}»`;
        toast(text);
        notify('Комната', text, { kind: 'room-removed' });
      }
      else if (room.ownerId !== state.me.id) toast(`Комната «${room.name}» вам больше недоступна`);
      return;
    }
    case 'room:message':
      return addRoomMessage(msg.message);
    case 'room:voice':
      return onRoomVoice(msg);
    case 'room:joined':
      return onRoomJoined(msg);
    case 'room:signal':
      if (state.room?.roomId === msg.roomId && state.room.joined) state.room.session.handleSignal(msg.from, msg.data);
      return;
    case 'room:left':
      // Выгнали или забанили — об этом скажет room:removed
      if (state.room?.roomId === msg.roomId) {
        const until = msg.reason === 'no-access' && timeoutOf(roomById(msg.roomId));
        finishRoomVoice(until ? `Вас кикнули до ${timeText(until)} — голос вернётся вместе с правами` : VOICE_LEFT[msg.reason]);
      }
      return;
    case 'room:error':
      if (state.room?.roomId === msg.roomId) finishRoomVoice(ROOM_ERRORS[msg.reason] || 'Не удалось подключиться');
      return;
  }
}

function onRoomVoice({ roomId, participants }) {
  const room = roomById(roomId);
  if (room) room.voice = participants;
  const v = state.room;
  if (v?.roomId === roomId && v.joined) {
    const ids = new Set(participants.map((p) => p.userId));
    for (const id of [...v.session.peers.keys()]) if (!ids.has(id)) v.session.removePeer(id);
    // Звуки входа и выхода других участников
    if (v.lastIds) {
      const joined = [...ids].some((id) => !v.lastIds.has(id));
      const left = [...v.lastIds].some((id) => !ids.has(id));
      if (joined) tone.blip('join');
      else if (left) tone.blip('leave');
    }
    v.lastIds = ids;
  }
  renderRooms();
  if (state.selectedRoomId === roomId) renderRoomView();
}

// ---------- Голосовой канал ----------

async function joinRoomVoice(roomId) {
  const room = roomById(roomId);
  if (!room || room.kind !== 'voice' || state.room?.roomId === roomId) return;
  if (state.call) {
    if (!confirm('Сейчас идёт звонок. Завершить его и подключиться к комнате?')) return;
    hangup();
  }
  if (state.room) leaveRoomVoice();

  const v = { roomId, joined: false, connectedAt: null, lastIds: null, sentState: '' };
  v.session = newSession((to, data) => socket?.send({ type: 'room:signal', roomId, to, data }));
  state.room = v;
  if (state.selectedRoomId !== roomId) selectRoom(roomId);
  renderVoice();
  renderRoomView();
  try {
    await v.session.start(audioFlags());
  } catch (err) {
    return finishRoomVoice(mediaErrorText(err));
  }
  if (state.room !== v) return;
  if (!socket?.send({ type: 'room:join', roomId, ...audioFlags() })) finishRoomVoice('Нет связи с сервером');
}

// Сервер прислал, кто уже в канале: новичок сам соединяется с каждым
function onRoomJoined({ roomId, peers }) {
  const v = state.room;
  if (!v || v.roomId !== roomId) return;
  for (const id of [...v.session.peers.keys()]) v.session.removePeer(id);
  v.joined = true;
  v.connectedAt ??= Date.now();
  v.lastIds = null;
  v.sentState = '';
  for (const id of peers) v.session.addPeer(id, true);
  applyAudioState();
  sendRoomState();
  tone.blip('join');
  renderVoice();
  renderRooms();
}

function leaveRoomVoice() {
  const v = state.room;
  if (!v) return;
  socket?.send({ type: 'room:leave', roomId: v.roomId });
  finishRoomVoice();
}

function finishRoomVoice(message) {
  const v = state.room;
  if (!v) return;
  state.room = null;
  v.session.close();
  tone.blip('leave');
  applyAudioState();
  renderVoice();
  renderRooms();
  if (state.selectedRoomId === v.roomId) renderRoomView();
  if (message) toast(message);
}

// Права в комнате поменялись: заново решаем, кого слышно и видно, и что можно самому
function applyRoomPerms() {
  const v = state.room;
  const session = v?.session;
  if (!session) return;
  const mine = voiceAllowed(state.me.id);
  if (!mine.video && (session.local.tracks.cam || session.local.tracks.screen)) {
    session.local.stopCamera();
    session.stopScreen();
    toast('В этой комнате вам больше нельзя включать камеру и показывать экран');
  }
  applyAudioState();
  session.applyAllowed();
}

// Микрофон, звук, камера и экран — чтобы другие видели значки в списке
function sendRoomState() {
  const v = state.room;
  if (!v?.joined) return;
  const st = v.session.mediaState();
  const key = JSON.stringify(st);
  if (key === v.sentState) return;
  v.sentState = key;
  socket?.send({ type: 'room:state', roomId: v.roomId, ...st });
}

// Связь с сервером пропала: из голоса сервер нас уже убрал. Вернулась — заходим обратно
function onVoiceSocketStatus(ok) {
  const v = state.room;
  if (!v) return;
  if (!ok) {
    if (v.joined) {
      v.joined = false;
      for (const id of [...v.session.peers.keys()]) v.session.removePeer(id);
      renderVoice();
    }
    return;
  }
  if (!v.joined) socket.send({ type: 'room:join', roomId: v.roomId, ...audioFlags() });
}

// ---------- Создание комнаты ----------

function friendChecklist(box, exclude = new Set()) {
  box.replaceChildren();
  const friends = [...state.contacts.values()]
    .filter((c) => !exclude.has(c.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));
  if (!friends.length) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = exclude.size ? 'Все ваши друзья уже здесь.' : 'Друзей пока нет — их можно будет добавить позже.';
    box.append(p);
  }
  for (const c of friends) {
    const label = document.createElement('label');
    label.className = 'friend-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = c.id;
    const name = document.createElement('span');
    name.className = 'ellipsis';
    name.textContent = c.displayName;
    const login = document.createElement('span');
    login.className = 'muted small';
    login.textContent = `@${c.username}`;
    label.append(cb, makeAvatar(c, undefined, 'small'), name, login);
    box.append(label);
  }
}

const checkedIds = (box) => [...box.querySelectorAll('input:checked')].map((cb) => Number(cb.value));

function openRoomCreate() {
  $('room-name').value = '';
  $('room-create-error').textContent = '';
  document.querySelector('input[name="room-kind"][value="voice"]').checked = true;
  friendChecklist($('room-friends'));
  $('room-create').classList.remove('hidden');
  $('room-name').focus();
}

$('new-room-btn').onclick = openRoomCreate;
$('room-create-cancel').onclick = () => $('room-create').classList.add('hidden');
$('room-create-form').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('room-name').value.trim();
  if (!name) return ($('room-create-error').textContent = 'Придумайте название');
  const kind = document.querySelector('input[name="room-kind"]:checked').value;
  const button = $('room-create-submit');
  button.disabled = true;
  try {
    const room = await Api.post('/rooms', { name, kind, memberIds: checkedIds($('room-friends')) });
    state.rooms.set(room.id, room);
    $('room-create').classList.add('hidden');
    selectRoom(room.id);
  } catch (err) {
    $('room-create-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
};
