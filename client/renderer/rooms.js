// Комнаты: голосовые (общий голосовой канал с видео и демонстрацией экрана + чат) и текстовые (только чат)

const ROOM_ERRORS = {
  'not-member': 'Вы не участник этой комнаты',
  'in-call': 'Сначала завершите звонок',
  full: 'В голосовом канале уже 10 человек — больше не поместится',
};

const roomIcon = (room) => (room.kind === 'voice' ? ICONS.speaker : ICONS.hash);
const roomById = (id) => state.rooms.get(id);

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
    row.onclick = () => selectRoom(room.id);
    if (room.kind === 'voice') {
      row.ondblclick = () => joinRoomVoice(room.id);
      row.title = 'Двойной щелчок — подключиться к голосу';
    }
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
  $('room-join-btn').classList.toggle('hidden', !isVoice || here);
  $('room-join-btn').disabled = (room.voice?.length || 0) >= 10;

  // Кто сидит в голосе, пока ты сам не подключился
  const lobby = $('room-lobby');
  lobby.classList.toggle('hidden', !isVoice || here);
  if (isVoice && !here) {
    lobby.replaceChildren();
    const people = (room.voice || []).map((p) => room.members.find((m) => m.id === p.userId)).filter(Boolean);
    const text = document.createElement('div');
    text.className = 'muted';
    text.textContent = people.length
      ? `Сейчас в голосовом канале: ${people.length}`
      : 'В голосовом канале пока никого. Подключитесь первым — друзья увидят вас в списке комнат.';
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
      if (state.room?.roomId === room.id) renderVoice();
      return;
    }
    case 'room:removed': {
      const room = roomById(msg.roomId);
      state.rooms.delete(msg.roomId);
      state.roomHistory.delete(msg.roomId);
      state.roomUnread.delete(msg.roomId);
      if (state.room?.roomId === msg.roomId) finishRoomVoice();
      if (state.selectedRoomId === msg.roomId) selectRoom(null);
      renderRooms();
      if (room && room.ownerId !== state.me.id) toast(`Комната «${room.name}» вам больше недоступна`);
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
      if (state.room?.roomId === msg.roomId)
        finishRoomVoice(msg.reason === 'moved' ? 'Вы подключились к голосу с другого устройства' : 'Вас отключили от голосового канала');
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
  renderVoice();
  renderRooms();
  if (state.selectedRoomId === v.roomId) renderRoomView();
  if (message) toast(message);
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

$('room-join-btn').onclick = () => joinRoomVoice(state.selectedRoomId);

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

// ---------- Участники и настройки комнаты ----------

function openRoomManage() {
  const room = roomById(state.selectedRoomId);
  if (!room) return;
  const isOwner = room.ownerId === state.me.id;
  $('rm-error').textContent = '';
  $('rm-title').textContent = room.name;
  $('rm-rename').classList.toggle('hidden', !isOwner);
  $('rm-name').value = room.name;

  const list = $('rm-members');
  list.replaceChildren();
  for (const m of room.members) {
    const row = document.createElement('div');
    row.className = 'member-row';
    const info = document.createElement('div');
    info.className = 'grow ellipsis';
    const name = document.createElement('div');
    name.className = 'ellipsis';
    name.textContent = m.id === state.me.id ? `${m.displayName} (вы)` : m.displayName;
    const sub = document.createElement('div');
    sub.className = 'muted small';
    sub.textContent = `@${m.username}${m.id === room.ownerId ? ' · создатель' : ''}`;
    info.append(name, sub);
    row.append(makeAvatar(m, m.online), info);
    if (isOwner && m.id !== state.me.id) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn danger-outline';
      remove.textContent = 'Убрать';
      remove.onclick = () => removeRoomMember(room, m);
      row.append(remove);
    }
    list.append(row);
  }

  friendChecklist($('rm-friends'), new Set(room.members.map((m) => m.id)));
  $('rm-add').classList.toggle('hidden', !$('rm-friends').querySelector('input'));
  $('rm-leave').textContent = isOwner ? 'Удалить комнату' : 'Выйти из комнаты';
  $('room-manage').classList.remove('hidden');
}

async function removeRoomMember(room, member) {
  if (!confirm(`Убрать ${member.displayName} из комнаты «${room.name}»?`)) return;
  try {
    await Api.del(`/rooms/${room.id}/members/${member.id}`);
    room.members = room.members.filter((m) => m.id !== member.id);
    openRoomManage();
  } catch (err) {
    $('rm-error').textContent = err.message;
  }
}

$('room-manage-btn').onclick = openRoomManage;
$('rm-close').onclick = () => $('room-manage').classList.add('hidden');

$('rm-rename').onsubmit = async (e) => {
  e.preventDefault();
  const room = roomById(state.selectedRoomId);
  try {
    const updated = await Api.patch(`/rooms/${room.id}`, { name: $('rm-name').value.trim() });
    state.rooms.set(updated.id, updated);
    renderRooms();
    renderRoomView();
    renderVoice();
    openRoomManage();
    toast('Название сохранено');
  } catch (err) {
    $('rm-error').textContent = err.message;
  }
};

$('rm-add').onclick = async () => {
  const room = roomById(state.selectedRoomId);
  const ids = checkedIds($('rm-friends'));
  if (!ids.length) return ($('rm-error').textContent = 'Отметьте друзей, которых хотите добавить');
  try {
    const updated = await Api.post(`/rooms/${room.id}/members`, { userIds: ids });
    state.rooms.set(updated.id, updated);
    renderRoomView();
    openRoomManage();
  } catch (err) {
    $('rm-error').textContent = err.message;
  }
};

$('rm-leave').onclick = async () => {
  const room = roomById(state.selectedRoomId);
  if (!room) return;
  const isOwner = room.ownerId === state.me.id;
  const question = isOwner
    ? `Удалить комнату «${room.name}» вместе с сообщениями? Это нельзя отменить.`
    : `Выйти из комнаты «${room.name}»? Вернуть вас сможет любой участник.`;
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
