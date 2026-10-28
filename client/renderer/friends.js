// Раздел «Друзья»: кто в сети, все друзья, входящие и отправленные заявки, заблокированные и добавление по логину.
// Дружба взаимная: заявку нужно принять. Заблокированный не может звать в друзья, а дружба с ним пропадает.

state.requests = { incoming: [], outgoing: [] };
state.blocked = [];
let friendsTab = 'online';

const FRIEND_ICONS = {
  chat: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  call: '<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  accept: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  decline: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  block: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  unfriend: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 11h6"/></svg>',
};

const FRIEND_TABS = {
  online: { title: 'В сети', empty: 'Сейчас никого нет в сети. Загляните позже — или позовите друзей.' },
  all: { title: 'Все друзья', empty: 'Друзей пока нет. Добавьте кого-нибудь по логину во вкладке «Добавить в друзья».' },
  incoming: { title: 'Входящие заявки', empty: 'Новых заявок нет.' },
  outgoing: { title: 'Отправленные заявки', empty: 'Вы никому не отправляли заявок, на которые ещё не ответили.' },
  blocked: { title: 'Заблокированные', empty: 'Вы никого не блокировали.' },
};

async function refreshFriendRequests() {
  try {
    const [requests, blocked] = await Promise.all([Api.get('/friend-requests'), Api.get('/blocks')]);
    state.requests = requests;
    state.blocked = blocked;
  } catch {
    // Старый сервер без заявок: просто не показываем их
    state.requests = { incoming: [], outgoing: [] };
    state.blocked = [];
  }
  renderFriends();
}

const dropRequest = (id) => {
  state.requests.incoming = state.requests.incoming.filter((u) => u.id !== id);
  state.requests.outgoing = state.requests.outgoing.filter((u) => u.id !== id);
};

/** Входящие заявки — на кнопке «Друзья» и на вкладке */
function renderFriendBadges() {
  const n = state.requests.incoming.length;
  for (const id of ['friends-nav-badge', 'ftab-incoming']) {
    $(id).textContent = n > 99 ? '99+' : n;
    $(id).classList.toggle('hidden', !n);
  }
}

function friendsOfTab(tab) {
  const friends = [...state.contacts.values()].sort(
    (a, b) => isAvailable(b) - isAvailable(a) || a.displayName.localeCompare(b.displayName, 'ru')
  );
  if (tab === 'online') return friends.filter(isAvailable);
  if (tab === 'all') return friends;
  if (tab === 'blocked') return state.blocked;
  return state.requests[tab] || [];
}

function roundButton(icon, title, onclick, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `friend-btn ${cls}`;
  b.title = title;
  b.dataset.action = title;
  b.innerHTML = icon;
  b.onclick = (e) => {
    e.stopPropagation();
    onclick();
  };
  return b;
}

function friendRow(user, tab) {
  const row = document.createElement('div');
  row.className = 'friend-row';
  const isFriend = tab === 'online' || tab === 'all';
  const avatar = makeAvatar(user, isFriend ? presenceOf(user) : undefined);
  avatar.dataset.profile = user.id;
  const info = document.createElement('div');
  info.className = 'friend-info';
  const name = document.createElement('div');
  name.className = 'friend-name ellipsis';
  name.textContent = user.displayName;
  const login = document.createElement('span');
  login.className = 'friend-login';
  login.textContent = ` @${user.username}`;
  name.append(login);
  const sub = document.createElement('div');
  sub.className = 'muted small ellipsis';
  sub.textContent = isFriend
    ? state.call?.peerId === user.id ? 'В звонке' : STATUS[presenceOf(user)].sub
    : tab === 'incoming' ? 'Хочет добавить вас в друзья'
    : tab === 'outgoing' ? 'Заявка отправлена — ждём ответа'
    : `Заблокирован ${new Date(user.blockedAt).toLocaleDateString('ru')}`;
  info.append(name, sub);
  const actions = document.createElement('div');
  actions.className = 'friend-actions';

  if (isFriend) {
    actions.append(
      roundButton(FRIEND_ICONS.chat, 'Написать', () => selectContact(user.id)),
      roundButton(FRIEND_ICONS.call, 'Позвонить', async () => {
        await selectContact(user.id);
        startCall();
      }),
      roundButton(FRIEND_ICONS.unfriend, 'Удалить из друзей', () => removeFriend(user), 'danger'),
      roundButton(FRIEND_ICONS.block, 'Заблокировать', () => blockUser(user), 'danger')
    );
    actions.querySelector('[data-action="Позвонить"]').disabled = !isAvailable(user) || Boolean(state.call);
    row.onclick = () => selectContact(user.id);
    row.classList.add('clickable');
  } else if (tab === 'incoming') {
    actions.append(
      roundButton(FRIEND_ICONS.accept, 'Принять', () => acceptFriend(user), 'ok'),
      roundButton(FRIEND_ICONS.decline, 'Отклонить', () => cancelRequest(user, `Заявка от ${user.displayName} отклонена`), 'danger'),
      roundButton(FRIEND_ICONS.block, 'Заблокировать', () => blockUser(user), 'danger')
    );
  } else if (tab === 'outgoing') {
    actions.append(roundButton(FRIEND_ICONS.decline, 'Отменить заявку', () => cancelRequest(user, 'Заявка отменена'), 'danger'));
  } else {
    const unblock = smallButton('Разблокировать', '', () => unblockUser(user));
    actions.append(unblock);
  }
  row.append(avatar, info, actions);
  return row;
}

function renderFriends() {
  renderFriendBadges();
  renderRail();
  $('friends-nav').classList.toggle('active', !state.selectedId && !state.selectedRoomId);
  for (const t of document.querySelectorAll('#friend-tabs [data-tab]')) t.classList.toggle('active', t.dataset.tab === friendsTab);
  const adding = friendsTab === 'add';
  $('friend-add-form').classList.toggle('hidden', !adding);
  $('friends-listing').classList.toggle('hidden', adding);
  if (adding) return;

  const query = $('friend-search').value.trim().toLowerCase();
  const all = friendsOfTab(friendsTab);
  const shown = all.filter((u) => !query || `${u.displayName} ${u.username}`.toLowerCase().includes(query));
  $('friends-list-title').textContent = `${FRIEND_TABS[friendsTab].title} — ${shown.length}`;
  const list = $('friends-list');
  list.replaceChildren(...shown.map((u) => friendRow(u, friendsTab)));
  $('friends-empty').textContent = all.length ? 'Никого не нашли' : FRIEND_TABS[friendsTab].empty;
  $('friends-empty').classList.toggle('hidden', shown.length > 0);
  $('friend-search').classList.toggle('hidden', !all.length);
}

function showFriendsTab(tab) {
  friendsTab = tab;
  if (state.selectedId || state.selectedRoomId || state.view !== 'home') selectContact(null);
  renderFriends();
  if (tab === 'add') $('friend-add-input').focus();
}

// ---------- Действия ----------

async function friendAction(request, done) {
  try {
    const result = await request;
    if (done) toast(done);
    return result ?? true;
  } catch (err) {
    toast(err.message);
    return null;
  }
}

/** Отправить заявку по логину; если он уже звал вас — сразу друзья */
async function sendFriendRequest(username) {
  const user = await Api.post('/contacts', { username });
  if (user.friendship === 'friends') {
    dropRequest(user.id);
    state.contacts.set(user.id, user);
    renderContacts();
  } else if (!state.requests.outgoing.some((u) => u.id === user.id)) {
    state.requests.outgoing.unshift({ ...user, requestedAt: Date.now() });
  }
  renderFriends();
  return user;
}

async function acceptFriend(user) {
  const friend = await friendAction(Api.post(`/friend-requests/${user.id}/accept`), `${user.displayName} теперь у вас в друзьях`);
  if (!friend) return;
  dropRequest(user.id);
  state.contacts.set(friend.id, friend);
  renderContacts();
  renderFriends();
}

async function cancelRequest(user, done) {
  if (!(await friendAction(Api.del(`/friend-requests/${user.id}`), done))) return;
  dropRequest(user.id);
  renderFriends();
}

async function removeFriend(user) {
  if (!confirm(`Удалить ${user.displayName} из друзей? Чтобы снова дружить, понадобится новая заявка.`)) return;
  if (!(await friendAction(Api.del(`/contacts/${user.id}`)))) return;
  if (state.call?.peerId === user.id) hangup();
  state.contacts.delete(user.id);
  state.history.delete(user.id);
  if (state.selectedId === user.id) selectContact(null);
  renderContacts();
  renderFriends();
}

async function blockUser(user) {
  if (!confirm(`Заблокировать ${user.displayName}? Дружба и заявки пропадут, и звать вас в друзья он больше не сможет.`)) return;
  const blocked = await friendAction(Api.post('/blocks', { userId: user.id }), `${user.displayName} заблокирован`);
  if (!blocked) return;
  if (state.call?.peerId === user.id) hangup();
  state.contacts.delete(user.id);
  state.history.delete(user.id);
  dropRequest(user.id);
  state.blocked = [blocked, ...state.blocked.filter((u) => u.id !== user.id)];
  if (state.selectedId === user.id) selectContact(null);
  renderContacts();
  renderFriends();
}

async function unblockUser(user) {
  if (!(await friendAction(Api.del(`/blocks/${user.id}`), `${user.displayName} разблокирован`))) return;
  state.blocked = state.blocked.filter((u) => u.id !== user.id);
  renderFriends();
}

// ---------- События сервера ----------

function onFriendRequest(user) {
  dropRequest(user.id);
  state.requests.incoming.unshift(user);
  renderFriends();
  notify('Заявка в друзья', `${user.displayName} хочет добавить вас в друзья`, { kind: 'friend', open: { friends: 'incoming' } });
}

function onFriendRequestRemoved(userId) {
  dropRequest(userId);
  renderFriends();
}

// ---------- Разметка ----------

$('friends-nav').onclick = () => showFriendsTab(friendsTab === 'add' ? 'online' : friendsTab);
for (const t of document.querySelectorAll('#friend-tabs [data-tab]')) t.onclick = () => showFriendsTab(t.dataset.tab);
$('friend-search').oninput = renderFriends;

$('friend-add-form').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('friend-add-input');
  const username = input.value.trim().replace(/^@/, '');
  const result = $('friend-add-result');
  result.className = 'small';
  result.textContent = '';
  if (!username) return;
  try {
    const user = await sendFriendRequest(username);
    input.value = '';
    result.classList.add('ok-text');
    result.textContent =
      user.friendship === 'friends'
        ? `${user.displayName} тоже звал вас — теперь вы друзья!`
        : `Заявка отправлена: ${user.displayName} (@${user.username}). Как только примет — появится в друзьях.`;
  } catch (err) {
    result.classList.add('error');
    result.textContent = err.message;
  }
};
$('friend-add-input').oninput = () => ($('friend-add-submit').disabled = !$('friend-add-input').value.trim());
