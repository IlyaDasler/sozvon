// Комнаты: голосовые (общий голосовой канал с видео и демонстрацией экрана + чат) и текстовые (только чат).
// Каждая комната — в канале (hubs.js); в боковой панели видны комнаты открытого канала

const ROOM_ERRORS = {
  'not-member': 'Вы не участник этой комнаты',
  'no-access': 'Вам нельзя заходить в голосовой канал этой комнаты',
  'in-call': 'Сначала завершите звонок',
  full: 'В голосовом канале уже нет мест',
  'old-version': 'В этой комнате голос идёт через медиасервер — обновите Созвон',
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

// Как на сервере (rooms.standing): создатель комнаты и создатель её канала могут всё, управляющий каналом — как администратор
const isRoomOwner = (room, userId) => room.ownerId === userId || state.hubs.get(room.hubId)?.ownerId === userId;
const managesHubOf = (room, userId) => Boolean(state.hubs.get(room.hubId)?.members.find((m) => m.id === userId)?.manager);
// Удалить комнату может её создатель и тот, кто управляет каналом
const canRemoveRoom = (room) => isRoomOwner(room, state.me.id) || managesHubOf(room, state.me.id);

/** До какого момента участник кикнут на время (создателя не кикают), или null */
function timeoutOf(room, userId = state.me.id) {
  const until = memberOf(room, userId)?.timeoutUntil;
  return !isRoomOwner(room, userId) && until > Date.now() ? until : null;
}
const roleOf = (room, userId) => {
  const m = memberOf(room, userId);
  return (m?.roleId && room.roles?.find((r) => r.id === m.roleId)) || null;
};

/** Права по роли (кик на время не учитывается) */
const rolePermsIn = (room, userId) =>
  (roleOf(room, userId)?.perms ?? room.defaultPerms ?? ALL_PERMS) | (managesHubOf(room, userId) ? PERMS.admin : 0);

function permsIn(room, userId = state.me.id) {
  if (!room || isRoomOwner(room, userId)) return ALL_PERMS;
  if (!memberOf(room, userId)) return 0;
  // Кикнутый на время только читает чат
  if (timeoutOf(room, userId)) return 0;
  const perms = rolePermsIn(room, userId);
  return perms & PERMS.admin ? ALL_PERMS : perms;
}

const can = (room, perm, userId) => Boolean(permsIn(room, userId) & perm);

// Старшинство: создатель > администратор > модератор > остальные — как на сервере
function rankIn(room, userId) {
  if (isRoomOwner(room, userId)) return 4;
  const perms = rolePermsIn(room, userId);
  return perms & PERMS.admin ? 3 : perms & (PERMS.kick | PERMS.ban | PERMS.manage) ? 2 : 1;
}

const outranks = (room, userId) => rankIn(room, state.me.id) > rankIn(room, userId);

/** Что собеседнику можно в текущем голосовом канале (в звонке один на один — всё) */
function voiceAllowed(id) {
  const room = state.room && roomById(state.room.roomId);
  return room ? { speak: can(room, PERMS.speak, id), video: can(room, PERMS.video, id) } : { speak: true, video: true };
}

/** Самому говорить нельзя — микрофон принудительно выключен (до входа — некому и нечего запрещать) */
const forcedMute = () => Boolean(state.me) && !voiceAllowed(state.me.id).speak;

async function refreshRooms() {
  try {
    const list = await Api.get('/rooms');
    state.rooms = new Map(list.map((r) => [r.id, r]));
    renderRooms();
    scheduleKickExpiry();
    if (state.selectedRoomId && !state.rooms.has(state.selectedRoomId)) leaveSelectedRoom();
    else if (state.selectedRoomId) renderRoomView();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Список в боковой панели ----------

function renderRooms() {
  renderRail();
  const list = $('room-list');
  list.replaceChildren();
  const hub = currentHub();
  if (!hub) return;
  const sorted = roomsOfHub(hub.id).sort(
    (a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'ru') : a.kind === 'voice' ? -1 : 1)
  );

  // Разделы «Голосовые» и «Текстовые»; кто управляет каналом, создаёт комнаты прямо отсюда
  for (const [kind, title] of [['voice', 'Голосовые'], ['text', 'Текстовые']]) {
    const head = document.createElement('li');
    head.className = 'list-title with-action room-section';
    head.dataset.section = kind;
    head.append(Object.assign(document.createElement('span'), { textContent: title }));
    if (canManageHub(hub)) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'icon-btn';
      add.title = kind === 'voice' ? 'Создать голосовую комнату' : 'Создать текстовую комнату';
      add.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
      add.onclick = () => openRoomCreate(kind);
      head.append(add);
    }
    list.append(head);
    if (!sorted.some((r) => r.kind === kind)) {
      const li = document.createElement('li');
      li.className = 'muted small pad room-none';
      li.textContent = kind === 'voice' ? 'Голосовых комнат нет' : 'Текстовых комнат нет';
      list.append(li);
    }
    for (const room of sorted.filter((r) => r.kind === kind)) list.append(roomItem(room));
  }
}

function roomItem(room) {
  const li = document.createElement('li');
  li.className = 'room-item';
  const row = document.createElement('div');
  row.className = `contact room-row${room.id === state.selectedRoomId ? ' active' : ''}`;
  row.dataset.room = room.id;
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
      item.dataset.profile = p.userId;
      item.title = user.displayName;
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
  return li;
}

/** Свежие данные комнаты: список, страница, голос и открытые окна */
function applyRoomUpdate(room) {
  state.rooms.set(room.id, room);
  renderRooms();
  if (state.selectedRoomId === room.id) renderRoomView();
  if (state.room?.roomId === room.id) applyRoomPerms();
  if (manageRoomId === room.id) renderRoomManage();
  if (inviteRoomId === room.id && !$('room-invite').classList.contains('hidden')) renderRoomInvite();
  renderMembers();
  scheduleKickExpiry();
}

/** Комнаты больше нет (вышли, убрали, удалили) */
function forgetRoom(id) {
  e2ee.convs.delete(roomConvOf(id));
  state.rooms.delete(id);
  state.roomHistory.delete(id);
  state.roomUnread.delete(id);
  if (room) readNotifsOf({ room: id });
  if (state.room?.roomId === id) finishRoomVoice();
  if (manageRoomId === id) closeRoomManage();
  if (inviteRoomId === id) $('room-invite').classList.add('hidden');
  if (state.selectedRoomId === id) leaveSelectedRoom();
  renderRooms();
  renderMembers();
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
  const room = roomById(id);
  if (room) {
    state.view = room.hubId;
    lastRoomOf.set(room.hubId, room.id);
  }
  state.selectedRoomId = room ? id : null;
  state.selectedId = null;
  state.roomUnread.delete(id);
  renderContacts();
  renderRooms();

  $('chat').classList.add('hidden');
  $('room-view').classList.toggle('hidden', !room);
  $('empty-state').classList.toggle('hidden', Boolean(room) || state.view !== 'home');
  renderHubChrome();
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
    await decryptMessages(loaded, roomConvOf(id));
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
  // Свой фон комнаты — под перепиской и разговором
  $('room-view').classList.toggle('has-bg', Boolean(room.backgroundUrl));
  $('room-view').style.setProperty('--room-bg', room.backgroundUrl ? `url("${Api.base}${room.backgroundUrl}")` : 'none');
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
  const room = roomById(id);
  renderMessageList(
    $('room-messages'),
    state.roomHistory.get(id) || [],
    state.roomHistory.has(id),
    'Сообщений пока нет. Напишите первым!',
    // Своё — всегда, чужое — тот, кто настраивает комнату и старше автора (как решает сервер)
    {
      chat: { kind: 'room', roomId: id },
      canDelete: (m) => m.fromId === state.me.id || (can(room, PERMS.manage) && outranks(room, m.fromId)),
      remove: (m) => Api.del(`/rooms/${id}/messages/${m.id}`),
    }
  );
  refreshPinned({ kind: 'room', roomId: id });
}

function addRoomMessage(m) {
  const list = state.roomHistory.get(m.roomId);
  const known = list?.find((x) => x.id === m.id);
  if (known) {
    known.plain ??= m.plain;
    m = known;
  } else list?.push(m);
  decryptMessages([m], roomConvOf(m.roomId)).then(() => showNewRoomMessage(m));
}

function showNewRoomMessage(m) {
  const viewing = m.roomId === state.selectedRoomId;
  if (viewing) renderRoomMessages();
  if (m.fromId === state.me.id) return;
  if (!viewing || !document.hasFocus()) {
    if (!viewing) state.roomUnread.set(m.roomId, (state.roomUnread.get(m.roomId) || 0) + 1);
    renderRooms();
    const room = roomById(m.roomId);
    const who = userById(m.fromId)?.displayName || '?';
    // Упомянули — так и говорим в заголовке
    const title = mentionsMe(m) ? `${who} упоминает вас в «${room?.name || 'комнате'}»` : room?.name || 'Комната';
    notify(title, `${who}: ${messageSummary(m)}`, { kind: 'room', open: { room: m.roomId } });
  }
}

// ---------- События с сервера ----------

function handleRoomEvent(msg) {
  switch (msg.type) {
    case 'room:updated': {
      const room = msg.room;
      const old = roomById(room.id);
      // Комнаты канала появляются у всех его участников сами — об этом не шумим
      if (!old && room.ownerId !== state.me.id && !room.hubId) {
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
      // Состав мог поменяться: новичку нужен ключ, после ухода — новая версия ключа
      refreshConv(roomConvOf(room.id));
      return;
    }
    case 'room:removed': {
      const room = roomById(msg.roomId);
      forgetRoom(msg.roomId);
      // hub — ушли из канала целиком: об этом скажет hub:removed
      if (!room || msg.reason === 'left' || msg.reason === 'hub') return;
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
    case 'room:message:deleted':
      if (dropMessage(state.roomHistory, msg.roomId, msg.id) && msg.roomId === state.selectedRoomId) renderRoomMessages();
      return;
    case 'room:message:edited': {
      const list = state.roomHistory.get(msg.message.roomId) || [];
      const i = list.findIndex((x) => x.id === msg.message.id);
      if (i >= 0) {
        list[i] = { ...list[i], ...msg.message, plain: list[i].plain };
        decryptMessages([list[i]], roomConvOf(msg.message.roomId)).then(() => {
          if (msg.message.roomId === state.selectedRoomId) renderRoomMessages();
        });
      }
      return;
    }
    case 'room:message:reactions': {
      const found = (state.roomHistory.get(msg.roomId) || []).find((x) => x.id === msg.id);
      if (found) found.reactions = msg.reactions;
      if (msg.roomId === state.selectedRoomId) renderRoomMessages();
      return;
    }
    case 'room:message:pinned': {
      const found = (state.roomHistory.get(msg.roomId) || []).find((x) => x.id === msg.id);
      if (found) found.pinned = msg.pinned;
      if (msg.roomId === state.selectedRoomId) {
        renderRoomMessages();
        refreshPinned({ kind: 'room', roomId: msg.roomId });
      }
      return;
    }
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
    v.session.applyVoiceState(participants);
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
    if (!(await ask('Звонок завершится, и вы подключитесь к комнате.', { title: 'Сейчас идёт звонок', ok: 'Завершить и подключиться' }))) return;
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
  if (!sendRoomJoin(roomId)) finishRoomVoice('Нет связи с сервером');
}

// sfu — умеем голос через медиасервер (большие комнаты)
const sendRoomJoin = (roomId) => socket?.send({ type: 'room:join', roomId, sfu: true, ...audioFlags() });

// Каждый с каждым соединения рвутся вместе с сервером; медиасервер живёт своей связью — его собеседников не трогаем
function dropP2pPeers(v) {
  if (v.session instanceof SfuSession) return;
  for (const id of [...v.session.peers.keys()]) v.session.removePeer(id);
}

// Сервер прислал, кто уже в канале: новичок сам соединяется с каждым.
// Большая комната — подключаемся к медиасерверу, забрав уже открытый микрофон
async function onRoomJoined({ roomId, peers, media, livekit }) {
  const v = state.room;
  if (!v || v.roomId !== roomId) return;
  if (media === 'sfu' && !(v.session instanceof SfuSession)) {
    try {
      await startSfu(v, livekit);
    } catch (err) {
      if (state.room === v) leaveRoomVoice();
      return toast(err.message, 6000);
    }
    if (state.room !== v) return;
  }
  dropP2pPeers(v);
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

/** Голос через медиасервер, зашифрованный ключом комнаты (его же ключом шифруется переписка комнаты) */
async function startSfu(v, grant) {
  if (!e2eeReady()) throw new Error('Для голоса в большой комнате нужен ключ шифрования — перенесите его на это устройство (Настройки → Аккаунт)');
  const { key } = await sendKey(roomConvOf(v.roomId));
  const session = new SfuSession(sessionOptions(), v.session);
  session.onDisconnected = () => state.room === v && finishRoomVoice('Связь с медиасервером прервалась');
  v.session = session;
  await session.connect(grant, key);
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
      dropP2pPeers(v);
      renderVoice();
    }
    return;
  }
  if (!v.joined) sendRoomJoin(v.roomId);
}

// ---------- Создание комнаты ----------

let createHubId = null;

function openRoomCreate(kind = 'voice', hubId = state.view) {
  const hub = hubById(hubId);
  if (!hub) return;
  createHubId = hub.id;
  $('room-name').value = '';
  $('room-create-error').textContent = '';
  $('room-create-hint').textContent = `Комната появится в «${hub.name}» у всех участников канала.`;
  document.querySelector(`input[name="room-kind"][value="${kind}"]`).checked = true;
  $('room-create').classList.remove('hidden');
  $('room-name').focus();
}

$('room-create-cancel').onclick = () => $('room-create').classList.add('hidden');
$('room-create-form').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('room-name').value.trim();
  if (!name) return ($('room-create-error').textContent = 'Придумайте название');
  const kind = document.querySelector('input[name="room-kind"]:checked').value;
  const button = $('room-create-submit');
  button.disabled = true;
  try {
    const room = await Api.post('/rooms', { hubId: createHubId, name, kind });
    state.rooms.set(room.id, room);
    $('room-create').classList.add('hidden');
    selectRoom(room.id);
  } catch (err) {
    $('room-create-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
};
