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

// ---------- Права (те же числа, что в server/src/perms.js) ----------

const PERMS = { connect: 1, speak: 2, video: 4, write: 8, invite: 16, kick: 32, ban: 64, manage: 128, admin: 256 };
const ALL_PERMS = 511;
const PERM_LABELS = [
  ['connect', 'Заходить в голосовой канал'],
  ['speak', 'Говорить'],
  ['video', 'Камера и демонстрация экрана'],
  ['write', 'Писать в чат'],
  ['invite', 'Звать своих друзей'],
  ['kick', 'Выгонять и отключать от голоса'],
  ['ban', 'Банить'],
  ['manage', 'Настраивать комнату и роли'],
  ['admin', 'Администратор — может всё'],
];

const memberOf = (room, userId) => room?.members.find((m) => m.id === userId);
const roleOf = (room, userId) => {
  const m = memberOf(room, userId);
  return (m?.roleId && room.roles?.find((r) => r.id === m.roleId)) || null;
};

function permsIn(room, userId = state.me.id) {
  if (!room || room.ownerId === userId) return ALL_PERMS;
  if (!memberOf(room, userId)) return 0;
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
  $('room-message-input').focus();
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
  $('room-message-input').disabled = !canWrite;
  $('room-message-input').placeholder = canWrite ? 'Написать в комнату' : 'Вам нельзя писать в этой комнате';
  $('room-message-form').querySelector('button').disabled = !canWrite;

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
    notify(room?.name || 'Комната', `${userById(m.fromId)?.displayName || '?'}: ${m.text}`);
  }
}

$('room-message-form').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('room-message-input');
  const text = input.value.trim();
  const id = state.selectedRoomId;
  if (!text || !id) return;
  input.value = '';
  try {
    addRoomMessage(await Api.post(`/rooms/${id}/messages`, { text }));
  } catch (err) {
    input.value = text;
    toast(err.message);
  }
};

// ---------- События с сервера ----------

function handleRoomEvent(msg) {
  switch (msg.type) {
    case 'room:updated': {
      const room = msg.room;
      const isNew = !state.rooms.has(room.id);
      state.rooms.set(room.id, room);
      if (isNew && room.ownerId !== state.me.id) {
        toast(`Вас добавили в комнату «${room.name}»`);
        notify('Новая комната', `Вас добавили в «${room.name}»`);
      }
      renderRooms();
      if (state.selectedRoomId === room.id) renderRoomView();
      if (state.room?.roomId === room.id) applyRoomPerms();
      if (!$('room-manage').classList.contains('hidden') && state.selectedRoomId === room.id) renderRoomManage();
      return;
    }
    case 'room:removed': {
      const room = roomById(msg.roomId);
      state.rooms.delete(msg.roomId);
      state.roomHistory.delete(msg.roomId);
      state.roomUnread.delete(msg.roomId);
      if (state.room?.roomId === msg.roomId) finishRoomVoice();
      if (state.selectedRoomId === msg.roomId) {
        $('room-manage').classList.add('hidden');
        selectRoom(null);
      }
      renderRooms();
      if (!room || msg.reason === 'left') return;
      if (msg.reason === 'banned') toast(`Вас забанили в комнате «${room.name}»`);
      else if (msg.reason === 'kicked') toast(`Вас выгнали из комнаты «${room.name}»`);
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
      if (state.room?.roomId === msg.roomId) finishRoomVoice(VOICE_LEFT[msg.reason]);
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

// ---------- Участники, роли и баны ----------

let manageTab = 'members';

function openRoomManage(tab = 'members') {
  if (!roomById(state.selectedRoomId)) return;
  manageTab = tab;
  $('rm-error').textContent = '';
  renderRoomManage();
  $('room-manage').classList.remove('hidden');
}

function renderRoomManage() {
  const room = roomById(state.selectedRoomId);
  if (!room) return $('room-manage').classList.add('hidden');
  const isOwner = room.ownerId === state.me.id;
  $('rm-title').textContent = room.name;
  $('rm-rename').classList.toggle('hidden', !can(room, PERMS.manage));
  if (document.activeElement !== $('rm-name')) $('rm-name').value = room.name;

  const bans = room.bans || [];
  $('rm-ban-count').textContent = bans.length ? ` (${bans.length})` : '';
  for (const t of document.querySelectorAll('#rm-tabs .tab')) t.classList.toggle('active', t.dataset.tab === manageTab);
  for (const p of document.querySelectorAll('#room-manage [data-pane]')) p.classList.toggle('hidden', p.dataset.pane !== manageTab);

  renderManageMembers(room);
  renderManageRoles(room);
  renderManageBans(room);
  $('rm-leave').textContent = isOwner ? 'Удалить комнату' : 'Выйти из комнаты';
}

function smallButton(text, cls, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls}`;
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

function renderManageMembers(room) {
  const list = $('rm-members');
  list.replaceChildren();
  const manage = can(room, PERMS.manage);
  const inVoice = new Set((room.voice || []).map((p) => p.userId));

  for (const m of room.members) {
    const row = document.createElement('div');
    row.className = 'member-row';
    const info = document.createElement('div');
    info.className = 'grow ellipsis';
    const name = document.createElement('div');
    name.className = 'ellipsis';
    name.textContent = m.id === state.me.id ? `${m.displayName} (вы)` : m.displayName;
    const role = roleOf(room, m.id);
    if (role) name.style.color = role.color;
    const sub = document.createElement('div');
    sub.className = 'muted small ellipsis';
    sub.textContent = `@${m.username} · ${m.id === room.ownerId ? 'создатель' : role?.name || 'без роли'}${inVoice.has(m.id) ? ' · в голосе' : ''}`;
    info.append(name, sub);
    row.append(makeAvatar(m, m.online), info);

    const mine = m.id === state.me.id;
    const above = !mine && outranks(room, m.id);
    const actions = document.createElement('div');
    actions.className = 'member-actions';
    row.append(actions);
    // Роль: назначает тот, у кого есть право, и только тем, кто младше (себе — тоже можно, кроме создателя)
    if (manage && m.id !== room.ownerId && (above || mine)) {
      const select = document.createElement('select');
      select.className = 'role-select';
      select.title = 'Роль';
      select.add(new Option('Без роли', ''));
      for (const r of room.roles || []) {
        const opt = new Option(r.name, r.id);
        opt.disabled = Boolean(r.perms & PERMS.admin) && room.ownerId !== state.me.id;
        select.add(opt);
      }
      select.value = m.roleId ?? '';
      select.onchange = () => setMemberRole(room, m, select.value ? Number(select.value) : null);
      actions.append(select);
    }
    if (above && inVoice.has(m.id) && can(room, PERMS.kick))
      actions.append(smallButton('Отключить', '', () => disconnectMember(room, m)));
    if (above && can(room, PERMS.kick)) actions.append(smallButton('Выгнать', 'danger-outline', () => removeRoomMember(room, m)));
    if (above && can(room, PERMS.ban)) actions.append(smallButton('Бан', 'danger-outline', () => banMember(room, m)));
    list.append(row);
  }

  const canInvite = can(room, PERMS.invite);
  $('rm-invite').classList.toggle('hidden', !canInvite);
  if (canInvite) {
    friendChecklist($('rm-friends'), new Set([...room.members, ...(room.bans || [])].map((m) => m.id)));
    $('rm-add').classList.toggle('hidden', !$('rm-friends').querySelector('input'));
  }
}

// Роль — это набор прав. Первая карточка — права всех, у кого роли нет
function renderManageRoles(room) {
  const box = $('rm-roles');
  box.replaceChildren();
  const manage = can(room, PERMS.manage);
  const isOwner = room.ownerId === state.me.id;
  box.append(roleCard(room, null, manage));
  for (const r of room.roles || []) box.append(roleCard(room, r, manage && (isOwner || !(r.perms & PERMS.admin))));
  $('rm-role-new').classList.toggle('hidden', !manage);
}

function roleCard(room, role, editable) {
  const isOwner = room.ownerId === state.me.id;
  const card = document.createElement('form');
  card.className = 'role-card';
  const head = document.createElement('div');
  head.className = 'role-head';
  let nameInput = null;
  let colorInput = null;
  if (role) {
    colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = role.color;
    colorInput.disabled = !editable;
    colorInput.title = 'Цвет имени';
    nameInput = document.createElement('input');
    nameInput.value = role.name;
    nameInput.maxLength = 24;
    nameInput.disabled = !editable;
    const count = room.members.filter((m) => m.roleId === role.id).length;
    const n = document.createElement('span');
    n.className = 'muted small';
    n.textContent = `${count} ${plural(count, 'участник', 'участника', 'участников')}`;
    head.append(colorInput, nameInput, n);
  } else {
    const title = document.createElement('b');
    title.textContent = 'Все участники без роли';
    head.append(title);
  }
  card.append(head);

  const perms = role ? role.perms : room.defaultPerms ?? ALL_PERMS;
  const grid = document.createElement('div');
  grid.className = 'perm-grid';
  const boxes = {};
  for (const [key, label] of PERM_LABELS) {
    // Админку раздаёт только создатель, а у «всех без роли» её не бывает
    if (key === 'admin' && !role) continue;
    const l = document.createElement('label');
    l.className = 'check small';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(perms & PERMS[key]);
    cb.disabled = !editable || (key === 'admin' && !isOwner);
    boxes[key] = cb;
    l.append(cb, ` ${label}`);
    grid.append(l);
  }
  // Администратор и так может всё — остальные галочки не нужны
  const syncAdmin = () => {
    const admin = boxes.admin?.checked;
    for (const [key, cb] of Object.entries(boxes)) if (key !== 'admin') cb.closest('label').classList.toggle('dim', Boolean(admin));
  };
  boxes.admin?.addEventListener('change', syncAdmin);
  syncAdmin();
  card.append(grid);

  if (editable) {
    const row = document.createElement('div');
    row.className = 'row';
    if (role) row.append(smallButton('Удалить роль', 'danger-outline', () => deleteRole(room, role)));
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    const save = document.createElement('button');
    save.className = 'btn primary';
    save.textContent = 'Сохранить';
    row.append(spacer, save);
    card.append(row);
  }

  card.onsubmit = async (e) => {
    e.preventDefault();
    let value = 0;
    for (const [key, cb] of Object.entries(boxes)) if (cb.checked) value |= PERMS[key];
    const body = role ? { name: nameInput.value.trim(), color: colorInput.value, perms: value } : { defaultPerms: value };
    await roomAction(role ? Api.patch(`/rooms/${room.id}/roles/${role.id}`, body) : Api.patch(`/rooms/${room.id}`, body), 'Права сохранены');
  };
  return card;
}

function renderManageBans(room) {
  const list = $('rm-bans');
  list.replaceChildren();
  const bans = room.bans || [];
  if (!bans.length) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'Забаненных нет. Забаненного нельзя снова позвать в комнату, пока не снимете бан.';
    list.append(p);
  }
  for (const b of bans) {
    const row = document.createElement('div');
    row.className = 'member-row';
    const info = document.createElement('div');
    info.className = 'grow ellipsis';
    info.textContent = b.displayName;
    const sub = document.createElement('div');
    sub.className = 'muted small';
    sub.textContent = `@${b.username} · с ${new Date(b.bannedAt).toLocaleDateString('ru')}`;
    info.append(sub);
    row.append(makeAvatar(b, undefined, 'small'), info);
    if (can(room, PERMS.ban)) row.append(smallButton('Снять бан', '', () => roomAction(Api.del(`/rooms/${room.id}/bans/${b.id}`), `${b.displayName} разбанен`)));
    list.append(row);
  }
}

// Запрос к серверу из окна управления: свежая комната приходит ответом (и всем остальным — через room:updated)
async function roomAction(request, done) {
  $('rm-error').textContent = '';
  try {
    const updated = await request;
    if (updated?.id) {
      state.rooms.set(updated.id, updated);
      renderRooms();
      renderRoomView();
      if (state.room?.roomId === updated.id) applyRoomPerms();
    }
    renderRoomManage();
    if (done) toast(done);
    return true;
  } catch (err) {
    $('rm-error').textContent = err.message;
    return false;
  }
}

function setMemberRole(room, member, roleId) {
  return roomAction(Api.put(`/rooms/${room.id}/members/${member.id}/role`, { roleId }));
}

async function removeRoomMember(room, member) {
  if (!confirm(`Выгнать ${member.displayName} из комнаты «${room.name}»? Позвать обратно можно будет в любой момент.`)) return;
  if (await roomAction(Api.del(`/rooms/${room.id}/members/${member.id}`))) {
    room.members = room.members.filter((m) => m.id !== member.id);
    renderRoomManage();
  }
}

async function banMember(room, member) {
  if (!confirm(`Забанить ${member.displayName}? Он пропадёт из комнаты «${room.name}», и позвать его обратно не получится, пока бан не снимут.`)) return;
  roomAction(Api.post(`/rooms/${room.id}/bans`, { userId: member.id }), `${member.displayName} забанен`);
}

function disconnectMember(room, member) {
  roomAction(Api.del(`/rooms/${room.id}/voice/${member.id}`), `${member.displayName} отключён от голоса`);
}

async function deleteRole(room, role) {
  if (!confirm(`Удалить роль «${role.name}»? У её участников останутся права по умолчанию.`)) return;
  roomAction(Api.del(`/rooms/${room.id}/roles/${role.id}`));
}

$('rm-role-new').onclick = () => {
  const room = roomById(state.selectedRoomId);
  if (!room) return;
  const n = (room.roles?.length || 0) + 1;
  // Новая роль начинается с прав по умолчанию — дальше их правят галочками
  roomAction(Api.post(`/rooms/${room.id}/roles`, { name: `Роль ${n}`, color: '#3e9cff', perms: (room.defaultPerms ?? ALL_PERMS) & ~PERMS.admin }));
};

for (const t of document.querySelectorAll('#rm-tabs .tab')) {
  t.onclick = () => {
    manageTab = t.dataset.tab;
    renderRoomManage();
  };
}

$('room-manage-btn').onclick = () => openRoomManage();
$('rm-close').onclick = () => $('room-manage').classList.add('hidden');

$('rm-rename').onsubmit = async (e) => {
  e.preventDefault();
  const room = roomById(state.selectedRoomId);
  if (await roomAction(Api.patch(`/rooms/${room.id}`, { name: $('rm-name').value.trim() }), 'Название сохранено')) renderVoice();
};

$('rm-add').onclick = async () => {
  const room = roomById(state.selectedRoomId);
  const ids = checkedIds($('rm-friends'));
  if (!ids.length) return ($('rm-error').textContent = 'Отметьте друзей, которых хотите добавить');
  roomAction(Api.post(`/rooms/${room.id}/members`, { userIds: ids }));
};

$('rm-leave').onclick = async () => {
  const room = roomById(state.selectedRoomId);
  if (!room) return;
  const isOwner = room.ownerId === state.me.id;
  const question = isOwner
    ? `Удалить комнату «${room.name}» вместе с сообщениями? Это нельзя отменить.`
    : `Выйти из комнаты «${room.name}»? Вернуть вас сможет любой, у кого есть право звать друзей.`;
  if (!confirm(question)) return;
  try {
    if (isOwner) await Api.del(`/rooms/${room.id}`);
    else await Api.del(`/rooms/${room.id}/members/${state.me.id}`);
    $('room-manage').classList.add('hidden');
    if (state.room?.roomId === room.id) finishRoomVoice();
    state.rooms.delete(room.id);
    state.roomHistory.delete(room.id);
    selectRoom(null);
  } catch (err) {
    $('rm-error').textContent = err.message;
  }
};
