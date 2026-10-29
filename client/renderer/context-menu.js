// Меню по правой кнопке мыши — одно место для всего приложения. По тому, на что нажали, собираем пункты
// из того, что приложение умеет: человек (аватарка, имя, друзья, участники, кто в голосе), сообщение,
// ссылка или картинка в нём, комната в списке, личный чат, поле ввода и выделенный текст.
// Пункты, на которые нет прав, не показываем. Каналы и группы в столбце слева — своё меню (hubs.js).

/** Скопировать в буфер обмена: в приложении — средствами Electron, в браузере — браузерными */
async function copyText(text, done = 'Скопировано') {
  try {
    if (window.desktop?.copy) await window.desktop.copy(text);
    else await navigator.clipboard.writeText(text);
    toast(done, 1500);
  } catch {
    toast('Не удалось скопировать');
  }
}

// ---------- Человек ----------

/** Комната, в которой сейчас действует человек: открытая, если он в ней есть */
function roomContext(userId) {
  const room = state.selectedRoomId && roomById(state.selectedRoomId);
  return room && memberOf(room, userId) ? room : null;
}

function toggleMuteFor(userId) {
  const muted = store.get(`volume:${userId}`, 100) === 0;
  store.set(`volume:${userId}`, muted ? 100 : 0);
  activeSession()?.setVolume(userId, muted ? 1 : 0);
  renderStage();
  renderRooms(); // знак «заглушён для вас» в списке голоса
}

function userMenu(userId, anchor) {
  const user = userById(userId);
  if (!user) return [];
  if (userId === state.me.id)
    return [
      { label: 'Профиль', onclick: () => openProfileCard(userId, anchor) },
      { label: 'Настройки профиля', onclick: () => openSettings('profile') },
      'sep',
      { label: 'Скопировать логин', onclick: () => copyText(`@${user.username}`, 'Логин скопирован') },
    ];

  const friend = state.contacts.get(userId);
  const incoming = state.requests.incoming.some((u) => u.id === userId);
  const outgoing = state.requests.outgoing.some((u) => u.id === userId);
  const blocked = state.blocked.some((u) => u.id === userId);
  const session = activeSession();
  const inVoiceWithMe = Boolean(session?.peers.has(userId));
  const muted = store.get(`volume:${userId}`, 100) === 0;
  const call = state.call;
  const canAddToCall = call && call.phase === 'connected' && friend && isAvailable(friend) && !session.peers.has(userId);
  const hub = currentHub();
  const canInviteToHub = hub && friend && canManageHub(hub) && !hub.members.some((m) => m.id === userId) && !hub.invited?.includes(userId);
  const room = roomContext(userId);
  const above = room && outranks(room, userId);
  const roomMember = room && memberOf(room, userId);
  const inRoomVoice = room && (room.voice || []).some((p) => p.userId === userId);

  return [
    { label: 'Профиль', onclick: () => openProfileCard(userId, anchor) },
    friend && { label: 'Написать', onclick: () => selectContact(userId) },
    friend && !call && isAvailable(friend) && { label: 'Позвонить', onclick: () => selectContact(userId).then(() => startCall()) },
    canAddToCall && { label: 'Добавить в звонок', onclick: () => socket.send({ type: 'call:add', callId: call.callId, to: userId }) },
    inVoiceWithMe && { label: muted ? 'Включить звук у себя' : 'Заглушить для себя', onclick: () => toggleMuteFor(userId) },
    canInviteToHub && { label: `Пригласить в «${hub.name}»`, onclick: () => hubAction(Api.post(`/hubs/${hub.id}/invites`, { userIds: [userId] }), `${user.displayName}: приглашение отправлено`) },
    'sep',
    !friend && !blocked && incoming && { label: 'Принять заявку в друзья', onclick: () => acceptFriend(user) },
    !friend && !blocked && !incoming && !outgoing && { label: 'Добавить в друзья', onclick: () => sendFriendRequest(user.username).then(() => toast(`Заявка отправлена: ${user.displayName}`)).catch((err) => toast(err.message)) },
    { label: 'Скопировать логин', onclick: () => copyText(`@${user.username}`, 'Логин скопирован') },
    // Комната: кик на время, отключить от голоса, исключить, бан — тем, у кого меньше прав
    roomMember && above && can(room, PERMS.kick) && 'sep',
    roomMember && above && can(room, PERMS.kick) && (timeoutOf(room, userId)
      ? { label: 'Снять кик', onclick: () => liftKick(room, roomMember) }
      : { label: 'Кикнуть на время…', danger: true, onclick: () => openKick(room, roomMember) }),
    roomMember && above && can(room, PERMS.kick) && inRoomVoice && { label: 'Отключить от голоса', danger: true, onclick: () => disconnectMember(room, roomMember) },
    roomMember && above && can(room, PERMS.kick) && { label: `Исключить из «${room.name}»`, danger: true, onclick: () => removeRoomMember(room, roomMember) },
    roomMember && above && can(room, PERMS.ban) && { label: `Забанить в «${room.name}»`, danger: true, onclick: () => banMember(room, roomMember) },
    'sep',
    friend && { label: 'Удалить из друзей', danger: true, onclick: () => removeFriend(friend) },
    blocked ? { label: 'Разблокировать', onclick: () => unblockUser(user) } : { label: 'Заблокировать', danger: true, onclick: () => blockUser(user) },
  ];
}

// ---------- Личный чат в списке ----------

function contactMenu(userId, anchor) {
  const unread = state.unread.get(userId);
  return [
    unread && {
      label: 'Отметить прочитанным',
      onclick: () => {
        state.unread.delete(userId);
        renderContacts();
        renderRail();
      },
    },
    ...userMenu(userId, anchor),
  ];
}

// ---------- Комната в списке ----------

function roomMenu(roomId) {
  const room = roomById(roomId);
  if (!room) return [];
  const voice = room.kind === 'voice';
  const here = state.room?.roomId === room.id;
  return [
    { label: 'Открыть', onclick: () => selectRoom(room.id) },
    voice && !here && can(room, PERMS.connect) && { label: 'Подключиться к голосу', onclick: () => openRoom(room.id) },
    voice && here && { label: 'Отключиться от голоса', onclick: () => leaveRoomVoice() },
    state.roomUnread.get(room.id) && {
      label: 'Отметить прочитанным',
      onclick: () => {
        state.roomUnread.delete(room.id);
        renderRooms();
        renderRail();
      },
    },
    'sep',
    can(room, PERMS.invite) && { label: 'Пригласить', onclick: () => openRoomInvite(room.id) },
    { label: can(room, PERMS.manage) ? 'Настройки комнаты' : 'Участники и права', onclick: () => openRoomManage(room.id, can(room, PERMS.manage) ? 'overview' : 'members') },
    { label: 'Скопировать название', onclick: () => copyText(room.name, 'Название скопировано') },
    'sep',
    {
      label: canRemoveRoom(room) ? 'Удалить комнату' : 'Выйти из комнаты',
      danger: true,
      onclick: () => leaveOrDeleteRoom(room).catch((err) => toast(err.message)),
    },
  ];
}

// ---------- Сообщение ----------

function messageMenu(row, target) {
  const m = row.message;
  const link = target.closest('a[href]');
  const image = target.closest('.msg-images img');
  const author = userById(m.fromId);
  return [
    link && { label: 'Открыть ссылку', onclick: () => link.click() },
    link && { label: 'Скопировать ссылку', onclick: () => copyText(link.href, 'Ссылка скопирована') },
    image && { label: 'Открыть картинку', onclick: () => image.click() },
    image && { label: 'Скопировать ссылку на картинку', onclick: () => copyText(image.src, 'Ссылка скопирована') },
    (link || image) && 'sep',
    messageView(m).text && { label: 'Скопировать текст', onclick: () => copyText(messageView(m).text, 'Текст скопирован') },
    author && { label: `Профиль: ${author.displayName}`, onclick: () => openProfileCard(m.fromId, row.querySelector('.avatar')) },
    row.actions?.canDelete(m) && 'sep',
    row.actions?.canDelete(m) && { label: 'Удалить сообщение', danger: true, onclick: () => deleteMessage(m, row.actions.remove, false) },
  ];
}

// ---------- Поле ввода и выделенный текст ----------

function editMenu(field) {
  const selected = field ? field.selectionStart !== field.selectionEnd : Boolean(getSelection()?.toString());
  const edit = (command) => () => {
    field?.focus();
    window.desktop?.edit ? window.desktop.edit(command) : document.execCommand(command);
  };
  if (!field) return selected ? [{ label: 'Копировать', onclick: () => copyText(getSelection().toString()) }] : [];
  return [
    selected && !field.readOnly && { label: 'Вырезать', onclick: edit('cut') },
    selected && { label: 'Копировать', onclick: edit('copy') },
    !field.readOnly && !field.disabled && { label: 'Вставить', onclick: edit('paste') },
    'sep',
    { label: 'Выделить всё', onclick: edit('selectAll') },
  ];
}

// ---------- Кто что получает ----------

const USER_TARGET = '[data-profile], [data-voice-user], [data-user]';

/** Пункты для места, где нажали; пустой список — своё меню не показываем */
function contextItems(target) {
  const field = target.closest('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), textarea');
  if (field) return editMenu(field);
  // Выделили текст — сначала «Копировать», дальше то, что есть у места
  const selection = getSelection()?.toString() ? editMenu(null) : [];
  const userEl = target.closest(USER_TARGET);
  const row = target.closest('.msg');
  if (row?.message && !userEl) return [...selection, ...(selection.length ? ['sep'] : []), ...messageMenu(row, target)];
  if (userEl) {
    const id = Number(userEl.dataset.profile || userEl.dataset.voiceUser || userEl.dataset.user);
    return [...selection, ...userMenu(id, userEl)];
  }
  const contact = target.closest('[data-contact]');
  if (contact) return contactMenu(Number(contact.dataset.contact), contact);
  const roomRow = target.closest('[data-room]');
  if (roomRow) return roomMenu(Number(roomRow.dataset.room));
  return selection;
}

document.addEventListener('contextmenu', (e) => {
  // У каналов и групп в столбце — своё меню
  if (e.defaultPrevented || e.target.closest('#rail')) return;
  const items = contextItems(e.target).filter(Boolean);
  e.preventDefault();
  // Только разделители — показывать нечего
  if (!items.some((i) => i !== 'sep')) return hideMenu();
  closeProfileCard();
  showMenu(e.clientX, e.clientY, items);
});
