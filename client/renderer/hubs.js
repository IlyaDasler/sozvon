// Каналы — свой «сервер» для своих: комнаты внутри, участники, приглашения друзей.
// Здесь: столбец каналов слева (личный порядок и группы — rail-layout.js), шапка канала с меню,
// список участников справа, окна «Создать канал», настройки, приглашения. Комнаты канала — в rooms.js

const HUB_MODALS = ['hub-create', 'hub-settings', 'hub-invite', 'hub-join', 'folder-edit'];
const lastRoomOf = new Map(); // id канала -> последняя открытая в нём комната

const hubById = (id) => state.hubs.get(id);
const currentHub = () => (state.view === 'home' ? null : hubById(state.view) || null);
const roomsOfHub = (hubId) => [...state.rooms.values()].filter((r) => r.hubId === hubId);

/** Старшинство в канале, как на сервере: создатель 3, управляющий 2, участник 1 */
function hubRank(hub, userId = state.me.id) {
  if (hub.ownerId === userId) return 3;
  const member = hub.members.find((m) => m.id === userId);
  return member ? (member.manager ? 2 : 1) : 0;
}
const canManageHub = (hub) => Boolean(hub) && hubRank(hub) >= 2;

// «Наш двор» -> «НД»
const hubInitials = (name) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function fillHubIcon(tile, hub) {
  tile.style.setProperty('--hub-color', hub.iconColor);
  const hasImage = AVATAR_URL_RE.test(hub.iconUrl || '');
  tile.classList.add('hub-tile');
  tile.classList.toggle('has-image', hasImage);
  tile.style.backgroundImage = hasImage ? `url("${Api.base}${hub.iconUrl}")` : '';
  tile.textContent = hasImage ? '' : hubInitials(hub.name);
}

// ---------- Данные ----------

async function refreshHubs() {
  try {
    const [list, invites] = await Promise.all([Api.get('/hubs'), Api.get('/hub-invites')]);
    state.hubs = new Map(list.map((h) => [h.id, h]));
    state.hubInvites = invites;
    state.hubsLoaded = true;
    if (state.view !== 'home' && !state.hubs.has(state.view)) selectContact(null);
    renderRooms();
    renderHubChrome();
  } catch (err) {
    toast(err.message);
  }
}

/** Свежие данные канала: столбец, шапка, права в его комнатах и открытые окна */
function applyHub(hub) {
  state.hubs.set(hub.id, hub);
  state.hubInvites = state.hubInvites.filter((i) => i.hub.id !== hub.id);
  renderRooms();
  if (state.view === hub.id) renderHubChrome();
  if (roomById(state.selectedRoomId)?.hubId === hub.id) renderRoomView();
  if (state.room && roomById(state.room.roomId)?.hubId === hub.id) applyRoomPerms();
  if (settingsHubId === hub.id) renderHubSettings();
  if (inviteHubId === hub.id) renderHubInvite();
}

/** Канала больше нет (вышли, выгнали, удалили) */
function forgetHub(id) {
  state.hubs.delete(id);
  for (const room of roomsOfHub(id)) forgetRoom(room.id);
  lastRoomOf.delete(id);
  if (settingsHubId === id) closeHubSettings();
  if (inviteHubId === id) $('hub-invite').classList.add('hidden');
  if (state.view === id) selectContact(null);
  renderRail();
}

// ---------- Что открыто: дом или канал ----------

/** Открыть канал: его последнюю комнату, иначе первую текстовую, иначе любую; комнат нет — «Тут пока пусто» */
function openHub(id) {
  if (!hubById(id)) return;
  readNotifsOf({ hub: id });
  const rooms = roomsOfHub(id);
  const room = rooms.find((r) => r.id === lastRoomOf.get(id)) || rooms.find((r) => r.kind === 'text') || rooms[0];
  if (room) return selectRoom(room.id);
  state.view = id;
  state.selectedRoomId = null;
  state.selectedId = null;
  for (const box of ['chat', 'room-view', 'empty-state']) $(box).classList.add('hidden');
  renderContacts();
  renderRooms();
  renderHubChrome();
  renderVoice();
}

/** Открытая комната пропала: в канале — другая его комната, дома — раздел «Друзья» */
const leaveSelectedRoom = () => (currentHub() ? openHub(state.view) : selectRoom(null));

/** Боковая панель и центр под то, что открыто: дом (друзья и личные сообщения) или канал */
function renderHubChrome() {
  const hub = currentHub();
  $('home-nav').classList.toggle('hidden', Boolean(hub));
  $('room-list').classList.toggle('hidden', !hub);
  $('head-home').classList.toggle('hidden', Boolean(hub));
  $('hub-menu-btn').classList.toggle('hidden', !hub);
  if (hub) $('hub-menu-name').textContent = hub.name;
  const empty = Boolean(hub) && !state.selectedRoomId;
  $('hub-empty').classList.toggle('hidden', !empty);
  if (empty) renderHubEmpty(hub);
  renderMembers();
}

function renderHubEmpty(hub) {
  $('hub-empty-title').textContent = hub.name;
  if (!$('hub-empty-mascot').firstChild) $('hub-empty-mascot').innerHTML = SOVON_SVG;
  const manager = canManageHub(hub);
  $('hub-empty-text').textContent = manager
    ? 'Создайте первую комнату: голосовую — чтобы разговаривать, текстовую — чтобы переписываться.'
    : 'Комнат пока нет — их создаёт тот, кто управляет каналом.';
  const actions = $('hub-empty-actions');
  actions.replaceChildren();
  if (manager)
    actions.append(
      smallButton('Создать комнату', 'primary', () => openRoomCreate('voice')),
      smallButton('Пригласить друзей', '', () => openHubInvite(hub.id))
    );
}

// ---------- Столбец каналов ----------

const layoutKey = () => `rail:${state.me.id}`;

/** Своя раскладка, починенная под нынешний список каналов */
const currentLayout = () => normalizeLayout(store.get(layoutKey(), null), [...state.hubs.keys()]);

function saveLayout(layout) {
  store.set(layoutKey(), layout);
  renderRail();
}

let dragKey = null; // что тащим: id канала (число) или id группы (строка)
let railDirty = false;

const hubUnread = (hubId) => roomsOfHub(hubId).some((r) => state.roomUnread.get(r.id));
const hubInVoice = (hubId) => Boolean(state.room) && roomById(state.room.roomId)?.hubId === hubId;

function renderRail() {
  if (!state.me) return;
  // Пока тащим, не перестраиваем — иначе перетаскивание оборвётся
  if (dragKey !== null) return (railDirty = true);
  railDirty = false;

  const home = state.view === 'home';
  $('rail-home-item').classList.toggle('active', home);
  const unread = [...state.unread.values()].reduce((a, b) => a + b, 0) + (state.requests?.incoming.length || 0);
  const badge = $('rail-home-badge');
  badge.classList.toggle('hidden', !unread);
  badge.textContent = unread > 99 ? '99+' : unread;

  renderRailCall();

  const list = $('rail-list');
  list.replaceChildren();
  for (const invite of state.hubInvites) list.append(inviteItem(invite));
  if (!state.hubsLoaded) return;
  const layout = currentLayout();
  // Битые или устаревшие сохранённые данные чиним сразу
  if (JSON.stringify(layout) !== JSON.stringify(store.get(layoutKey(), null))) store.set(layoutKey(), layout);
  for (const item of layout.items) list.append(typeof item === 'number' ? hubItem(hubById(item)) : folderItem(item));
}

/** Значок идущего личного звонка: аватарка собеседника (или «+N» для группы) и зелёная пульсация */
function renderRailCall() {
  const call = state.call;
  const item = $('rail-call-item');
  item.classList.toggle('hidden', !call);
  if (!call) return;
  const tile = $('rail-call');
  tile.replaceChildren();
  fillAvatar(tile, call.peer);
  const others = call.session.peers.size - 1;
  if (others > 0) tile.append(Object.assign(document.createElement('span'), { className: 'rail-call-more', textContent: `+${others}` }));
  tile.dataset.tip = voiceTitle();
  item.classList.toggle('active', state.selectedId === call.peerId);
}

$('rail-call').onclick = () => state.call && selectContact(state.call.peerId);

function railItem(tile, { active = false, unread = false, draggable = false } = {}) {
  const item = document.createElement('div');
  item.className = `rail-item${active ? ' active' : ''}${unread ? ' unread' : ''}`;
  item.draggable = draggable;
  item.append(tile);
  return item;
}

function hubItem(hub) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'rail-tile';
  tile.dataset.tip = hub.name;
  fillHubIcon(tile, hub);
  tile.onclick = () => openHub(hub.id);
  const item = railItem(tile, { active: state.view === hub.id, unread: hubUnread(hub.id), draggable: true });
  item.dataset.hub = hub.id;
  item.oncontextmenu = (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      { label: 'Открыть', onclick: () => openHub(hub.id) },
      hubUnread(hub.id) && { label: 'Отметить прочитанным', onclick: () => markHubRead(hub.id) },
      'sep',
      ...hubMenuItems(hub),
    ]);
  };
  if (hubInVoice(hub.id)) item.insertAdjacentHTML('beforeend', `<span class="rail-voice" title="Вы в голосе">${ICONS.volume}</span>`);
  return item;
}

function folderItem(folder) {
  const hubs = folder.hubs.map(hubById);
  const box = document.createElement('div');
  box.className = `rail-folder${folder.collapsed ? '' : ' open'}`;
  box.style.setProperty('--folder-color', folder.color || 'var(--accent)');

  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'rail-tile folder-tile';
  tile.dataset.tip = folder.name || hubs.map((h) => h.name).join(', ');
  if (folder.collapsed) {
    // Свёрнутая группа — мозаика из первых четырёх каналов
    for (const hub of hubs.slice(0, 4)) {
      const mini = document.createElement('span');
      fillHubIcon(mini, hub);
      mini.classList.add('mini');
      tile.append(mini);
    }
  } else tile.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  tile.onclick = () => saveLayout(updateFolder(currentLayout(), folder.folder, { collapsed: !folder.collapsed }));

  const inside = folder.hubs.includes(state.view);
  const head = railItem(tile, {
    active: folder.collapsed && inside,
    unread: folder.collapsed && folder.hubs.some(hubUnread),
    draggable: true,
  });
  head.classList.add('folder-head');
  head.dataset.folder = folder.folder;
  head.oncontextmenu = (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      { label: 'Название и цвет…', onclick: () => openFolderEdit(folder) },
      { label: folder.collapsed ? 'Развернуть' : 'Свернуть', onclick: () => tile.click() },
      folder.hubs.some(hubUnread) && { label: 'Отметить прочитанным', onclick: () => folder.hubs.forEach(markHubRead) },
      'sep',
      { label: 'Разгруппировать', onclick: () => saveLayout(ungroup(currentLayout(), folder.folder)) },
    ]);
  };
  box.append(head);
  if (!folder.collapsed) for (const hub of hubs) box.append(hubItem(hub));
  return box;
}

// Приглашение — канал с пунктирной рамкой в начале столбца: щелчок открывает «Вступить / Отказаться»
function inviteItem(invite) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'rail-tile';
  tile.dataset.tip = `Приглашение: ${invite.hub.name}`;
  fillHubIcon(tile, invite.hub);
  tile.onclick = () => openHubJoin(invite.hub.id);
  const item = railItem(tile, { unread: true });
  item.classList.add('invite');
  item.dataset.invite = invite.hub.id;
  return item;
}

function markHubRead(hubId) {
  for (const room of roomsOfHub(hubId)) state.roomUnread.delete(room.id);
  renderRooms();
}

// ---------- Перетаскивание: порядок и группы ----------

const keyOf = (item) => (item.dataset.hub ? Number(item.dataset.hub) : item.dataset.folder);
const newFolderId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Куда бросят: в верхнюю треть — перед элементом, на середину канала — в группу с ним, на группу — внутрь.
 *  Группу можно только переставить. Мимо элементов — в конец */
function dropTarget(e) {
  const item = e.target.closest('#rail-list .rail-item[draggable="true"]');
  if (!item) return { zone: 'end' };
  const key = keyOf(item);
  if (key === dragKey) return null;
  const r = item.getBoundingClientRect();
  if (typeof dragKey === 'string' || e.clientY - r.top < r.height * 0.3) return { item, key, zone: 'before' };
  return { item, key, zone: item.dataset.hub ? 'group' : 'into' };
}

function clearDropMarks() {
  for (const node of document.querySelectorAll('.drop-before, .drop-group, .drop-into, .drop-end, .dragging'))
    node.classList.remove('drop-before', 'drop-group', 'drop-into', 'drop-end', 'dragging');
}

function applyDrop({ key, zone }) {
  const layout = currentLayout();
  if (zone === 'end') return saveLayout(moveItem(layout, dragKey, null));
  if (zone === 'before') return saveLayout(moveItem(layout, dragKey, key));
  if (zone === 'group') return saveLayout(groupHubs(layout, dragKey, key, newFolderId()));
  const folder = layout.items.find((i) => i.folder === key);
  if (folder) saveLayout(groupHubs(layout, dragKey, folder.hubs.at(-1), newFolderId()));
}

$('rail-list').addEventListener('dragstart', (e) => {
  const item = e.target.closest('.rail-item[draggable="true"]');
  if (!item) return;
  dragKey = keyOf(item);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragKey));
  item.classList.add('dragging');
  hideRailTip();
});
$('rail-list').addEventListener('dragover', (e) => {
  if (dragKey === null) return;
  e.preventDefault();
  for (const node of document.querySelectorAll('.drop-before, .drop-group, .drop-into, .drop-end'))
    node.classList.remove('drop-before', 'drop-group', 'drop-into', 'drop-end');
  const target = dropTarget(e);
  if (target) (target.item || $('rail-list')).classList.add(`drop-${target.zone}`);
});
$('rail-list').addEventListener('drop', (e) => {
  if (dragKey === null) return;
  e.preventDefault();
  const target = dropTarget(e);
  clearDropMarks();
  if (target) applyDrop(target);
  dragKey = null;
  renderRail();
});
$('rail-list').addEventListener('dragend', () => {
  dragKey = null;
  clearDropMarks();
  if (railDirty) renderRail();
});

// ---------- Подсказка с названием у столбца ----------

function hideRailTip() {
  $('rail-tip').classList.add('hidden');
}

$('rail').addEventListener('mouseover', (e) => {
  const target = e.target.closest('[data-tip]');
  if (!target || dragKey !== null) return hideRailTip();
  const tip = $('rail-tip');
  const r = target.getBoundingClientRect();
  tip.textContent = target.dataset.tip;
  tip.style.top = `${r.top + r.height / 2}px`;
  tip.style.left = `${r.right + 12}px`;
  tip.classList.remove('hidden');
});
$('rail').addEventListener('mouseleave', hideRailTip);

// ---------- Группа: название и цвет ----------

let editFolderId = null;
let folderColor = null;

function openFolderEdit(folder) {
  editFolderId = folder.folder;
  folderColor = folder.color || COLORS[5];
  $('folder-name').value = folder.name;
  renderFolderColors();
  $('folder-edit').classList.remove('hidden');
  $('folder-name').focus();
}

function renderFolderColors() {
  colorChoices($('folder-colors'), COLORS, folderColor, (c) => {
    folderColor = c;
    renderFolderColors();
  });
}

$('folder-form').onsubmit = (e) => {
  e.preventDefault();
  saveLayout(updateFolder(currentLayout(), editFolderId, { name: $('folder-name').value.trim(), color: folderColor }));
  $('folder-edit').classList.add('hidden');
};
$('folder-cancel').onclick = () => $('folder-edit').classList.add('hidden');

// ---------- Всплывающее меню ----------

/** items: { label, onclick, danger } или 'sep'; пустые (false) пропускаются */
function showMenu(x, y, items) {
  const menu = $('popup-menu');
  menu.replaceChildren();
  for (const item of items.filter(Boolean)) {
    if (item === 'sep') {
      if (menu.lastChild && !menu.lastChild.classList.contains('popup-sep')) menu.append(el('div', { className: 'popup-sep' }));
      continue;
    }
    menu.append(
      el('button', {
        type: 'button',
        className: `popup-item${item.danger ? ' danger' : ''}`,
        textContent: item.label,
        onclick: () => {
          hideMenu();
          item.onclick();
        },
      })
    );
  }
  menu.classList.remove('hidden');
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
}

const hideMenu = () => $('popup-menu').classList.add('hidden');

document.addEventListener(
  'mousedown',
  (e) => {
    if (!e.target.closest('#popup-menu, #hub-menu-btn')) hideMenu();
  },
  true
);

// ---------- Меню канала ----------

function hubMenuItems(hub) {
  const manager = canManageHub(hub);
  return [
    manager && { label: 'Пригласить друзей', onclick: () => openHubInvite(hub.id) },
    manager && { label: 'Создать комнату', onclick: () => openRoomCreate('voice', hub.id) },
    { label: manager ? 'Настройки канала' : 'Участники канала', onclick: () => openHubSettings(hub.id, manager ? 'overview' : 'members') },
    'sep',
    hub.ownerId === state.me.id
      ? { label: 'Удалить канал', danger: true, onclick: () => deleteHub(hub) }
      : { label: 'Выйти из канала', danger: true, onclick: () => leaveHub(hub) },
  ];
}

$('hub-menu-btn').onclick = () => {
  const hub = currentHub();
  if (!hub) return;
  if (!$('popup-menu').classList.contains('hidden')) return hideMenu();
  const r = $('hub-menu-btn').getBoundingClientRect();
  showMenu(r.left + 8, r.bottom + 4, hubMenuItems(hub));
};

async function deleteHub(hub) {
  if (!(await ask(`Канал «${hub.name}» удалится вместе со всеми комнатами и перепиской. Это нельзя отменить.`, { title: 'Удалить канал?', ok: 'Удалить', danger: true }))) return;
  try {
    await Api.del(`/hubs/${hub.id}`);
    forgetHub(hub.id);
    toast(`Канал «${hub.name}» удалён`);
  } catch (err) {
    toast(err.message);
  }
}

async function leaveHub(hub) {
  if (!(await ask(`Вернуться в «${hub.name}» можно будет только по новому приглашению.`, { title: 'Выйти из канала?', ok: 'Выйти', danger: true }))) return;
  try {
    await Api.del(`/hubs/${hub.id}/members/${state.me.id}`);
    forgetHub(hub.id);
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Участники справа ----------

const membersHidden = () => store.get('membersHidden', false);
// Себя показываем по своему статусу: невидимый для себя — «не в сети», как его видят другие
const presenceIn = (m) => (m.id === state.me.id ? (myStatus() === 'invisible' ? 'offline' : myStatus()) : presenceOf(m));

function renderMembers() {
  const hub = currentHub();
  const show = Boolean(hub) && !membersHidden();
  $('members-panel').classList.toggle('hidden', !show);
  for (const b of document.querySelectorAll('.members-toggle')) {
    b.classList.toggle('on', show);
    b.title = show ? 'Скрыть участников' : 'Показать участников';
  }
  if (!show) return;

  // Открыта комната — её участники по её ролям; иначе — весь канал
  const room = roomById(state.selectedRoomId);
  const people = room ? room.members : hub.members;
  const inVoice = new Set((room?.voice || []).map((p) => p.userId));
  const byName = (a, b) => a.displayName.localeCompare(b.displayName, 'ru');
  const groups = (room?.roles || []).map((r) => ({ role: r, title: r.name, people: [] }));
  const online = { title: 'В сети', people: [] };
  const offline = { title: 'Не в сети', people: [], offline: true };
  for (const m of people) {
    if (presenceIn(m) === 'offline') offline.people.push(m);
    else (groups.find((g) => g.role.id === roleOf(room, m.id)?.id) || online).people.push(m);
  }

  const box = $('members-list');
  box.replaceChildren();
  box.append(
    el('div', { className: 'members-head' },
      el('b', { textContent: 'Участники' }),
      el('span', { className: 'muted small ellipsis', textContent: room ? `· ${room.name}` : `· весь канал` }))
  );
  for (const g of [...groups, online, offline]) {
    if (!g.people.length) continue;
    box.append(el('div', { className: 'members-group', textContent: `${g.title} — ${g.people.length}` }));
    for (const m of g.people.sort(byName)) {
      const hubMember = hub.members.find((x) => x.id === m.id);
      const name = el('div', { className: 'member-nick ellipsis', textContent: m.displayName });
      if (g.role) name.style.color = g.role.color;
      const sub = inVoice.has(m.id) ? 'В голосе'
        : m.id === hub.ownerId ? 'Создатель канала'
        : hubMember?.manager ? 'Управляет каналом'
        : presenceIn(m) === 'idle' || presenceIn(m) === 'dnd' ? STATUS[presenceIn(m)].label : '';
      const row = el('div', { className: `member-item${g.offline ? ' offline' : ''}` },
        makeAvatar(m, presenceIn(m), 'small'),
        el('div', { className: 'member-text' }, name, sub && el('div', { className: 'muted small ellipsis', textContent: sub })));
      if (m.id === hub.ownerId)
        row.insertAdjacentHTML('beforeend', '<svg class="crown" viewBox="0 0 24 24"><title>Создатель канала</title><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>');
      row.dataset.profile = m.id;
      box.append(row);
    }
  }
}

for (const b of document.querySelectorAll('.members-toggle'))
  b.onclick = () => {
    store.set('membersHidden', !membersHidden());
    renderMembers();
  };

// ---------- Создать канал ----------

let newHubColor = COLORS[0];

function openHubCreate() {
  newHubColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  $('hub-name').value = '';
  $('hub-name').placeholder = `Канал ${state.me.displayName}`.slice(0, 40);
  $('hub-create-error').textContent = '';
  renderHubCreate();
  $('hub-create').classList.remove('hidden');
  $('hub-name').focus();
}

function renderHubCreate() {
  const name = $('hub-name').value.trim() || $('hub-name').placeholder;
  fillHubIcon($('hub-create-preview'), { name, iconColor: newHubColor });
  colorChoices($('hub-colors'), COLORS, newHubColor, (c) => {
    newHubColor = c;
    renderHubCreate();
  });
}

$('rail-add').onclick = openHubCreate;
$('hub-name').oninput = renderHubCreate;
$('hub-create-cancel').onclick = () => $('hub-create').classList.add('hidden');
$('hub-create-form').onsubmit = async (e) => {
  e.preventDefault();
  const button = $('hub-create-submit');
  button.disabled = true;
  try {
    const hub = await Api.post('/hubs', { name: $('hub-name').value.trim() || $('hub-name').placeholder, iconColor: newHubColor });
    applyHub(hub);
    // Комнаты нового канала приходят отдельно — дождёмся их, чтобы сразу открыть
    await refreshRooms();
    $('hub-create').classList.add('hidden');
    openHub(hub.id);
  } catch (err) {
    $('hub-create-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
};

$('rail-home').onclick = () => selectContact(null);

// ---------- Настройки канала ----------

let settingsHubId = null;
let settingsTab = 'overview';
let hubMemberQuery = '';
const HUB_TABS = { overview: 'Обзор', members: 'Участники', bans: 'Баны' };

function openHubSettings(id, tab = 'overview') {
  if (!hubById(id)) return;
  settingsHubId = id;
  settingsTab = tab;
  hubMemberQuery = '';
  $('hs-error').textContent = '';
  renderHubSettings();
  $('hub-settings').classList.remove('hidden');
}

function closeHubSettings() {
  $('hub-settings').classList.add('hidden');
  settingsHubId = null;
}

function renderHubSettings() {
  const hub = hubById(settingsHubId);
  if (!hub) return closeHubSettings();
  const manager = canManageHub(hub);
  if (!manager && settingsTab !== 'members') settingsTab = 'members';
  $('hs-hub-name').textContent = hub.name;
  $('hs-title').textContent = HUB_TABS[settingsTab];
  $('hs-member-count').textContent = hub.members.length;
  $('hs-ban-count').textContent = hub.bans.length || '';
  for (const t of document.querySelectorAll('#hs-nav [data-tab]')) {
    t.classList.toggle('active', t.dataset.tab === settingsTab);
    t.classList.toggle('hidden', !manager && t.dataset.tab !== 'members');
  }
  $('hs-leave').textContent = hub.ownerId === state.me.id ? 'Удалить канал' : 'Выйти из канала';

  const body = $('hs-body');
  const focused = document.activeElement?.dataset?.keep;
  const draft = focused && document.activeElement.value;
  body.replaceChildren(...{ overview: hubOverviewPane, members: hubMembersPane, bans: hubBansPane }[settingsTab](hub));
  if (focused) {
    const input = body.querySelector(`[data-keep="${focused}"]`);
    if (input) {
      input.value = draft;
      input.focus();
    }
  }
}

async function hubAction(promise, okText) {
  $('hs-error').textContent = '';
  try {
    const hub = await promise;
    if (hub?.id) applyHub(hub);
    if (okText) toast(okText);
    return true;
  } catch (err) {
    $('hs-error').textContent = err.message;
    return false;
  }
}

function hubOverviewPane(hub) {
  const icon = el('div', { className: 'hub-tile huge' });
  fillHubIcon(icon, hub);
  const name = el('input', { value: hub.name, maxLength: 40 });
  name.dataset.keep = 'hub-name';
  let color = hub.iconColor;
  const colors = el('div', { className: 'colors' });
  const paint = () =>
    colorChoices(colors, COLORS, color, (c) => {
      color = c;
      icon.style.setProperty('--hub-color', c);
      paint();
    });
  paint();
  const form = el('form', { className: 'hs-overview' },
    el('div', { className: 'hs-icon-row' }, icon,
      el('div', { className: 'hs-icon-actions' },
        el('div', { className: 'row' },
          smallButton('Загрузить картинку', 'primary', () => $('hub-icon-input').click()),
          hub.iconUrl && smallButton('Убрать', '', () => hubAction(Api.del(`/hubs/${hub.id}/icon`), 'Картинка убрана'))),
        el('p', { className: 'muted small', textContent: 'Загрузите картинку, чтобы канал отличался не только названием.' }))),
    el('label', { className: 'field' }, el('span', { textContent: 'Название' }), name),
    el('div', { className: 'field' }, el('span', { textContent: 'Цвет' }), colors),
    el('div', { className: 'row' }, el('div', { className: 'spacer' }), el('button', { className: 'btn primary', textContent: 'Сохранить' })));
  form.onsubmit = (e) => {
    e.preventDefault();
    hubAction(Api.patch(`/hubs/${hub.id}`, { name: name.value.trim(), iconColor: color }), 'Сохранено');
  };
  const owner = hub.members.find((m) => m.id === hub.ownerId);
  const facts = el('div', { className: 'rs-facts' },
    el('div', {}, el('span', { className: 'muted small', textContent: 'Создатель' }), el('b', { textContent: owner?.displayName || '—' })),
    el('div', {}, el('span', { className: 'muted small', textContent: 'Участников' }), el('b', { textContent: hub.members.length })),
    el('div', {}, el('span', { className: 'muted small', textContent: 'Комнат' }), el('b', { textContent: roomsOfHub(hub.id).length })),
    el('div', {}, el('span', { className: 'muted small', textContent: 'Создан' }), el('b', { textContent: formatDay(hub.createdAt) })));
  return [form, facts];
}

function hubMembersPane(hub) {
  const out = [];
  const search = el('input', { className: 'friend-search', placeholder: 'Поиск участников', value: hubMemberQuery });
  search.dataset.keep = 'hub-member-search';
  search.oninput = () => {
    hubMemberQuery = search.value;
    renderHubSettings();
  };
  const top = el('div', { className: 'rs-row' }, search);
  if (canManageHub(hub)) top.append(smallButton('Пригласить друзей', 'primary', () => openHubInvite(hub.id)));
  out.push(top);

  const q = hubMemberQuery.trim().toLowerCase();
  const members = hub.members.filter((m) => !q || `${m.displayName} ${m.username}`.toLowerCase().includes(q));
  out.push(el('div', { className: 'list-title', textContent: `Участники — ${members.length}` }));
  const list = el('div', { className: 'member-list', id: 'hs-members' });
  const myRank = hubRank(hub);
  for (const m of members) {
    const mine = m.id === state.me.id;
    const tags = el('div', { className: 'member-tags' }, el('span', { className: 'muted small', textContent: `@${m.username}` }));
    if (m.id === hub.ownerId) tags.append(el('span', { className: 'tag owner', textContent: 'Создатель' }));
    else if (m.manager) tags.append(el('span', { className: 'tag', textContent: 'Управляет' }));
    const info = el('div', { className: 'grow member-info' },
      el('div', { className: 'ellipsis member-name', textContent: mine ? `${m.displayName} (вы)` : m.displayName }), tags);
    info.dataset.profile = m.id;
    const avatar = makeAvatar(m, presenceIn(m));
    avatar.dataset.profile = m.id;
    const actions = el('div', { className: 'member-actions' });
    // Право управлять раздаёт создатель; выгнать и забанить — только тех, кто младше
    if (hub.ownerId === state.me.id && !mine) {
      const sw = el('input', { type: 'checkbox', className: 'switch', checked: Boolean(m.manager), title: 'Может управлять каналом' });
      sw.onchange = () => hubAction(Api.put(`/hubs/${hub.id}/members/${m.id}/manager`, { manager: sw.checked }));
      actions.append(el('label', { className: 'manager-switch' }, el('span', { className: 'small', textContent: 'Управляет' }), sw));
    }
    if (!mine && myRank >= 2 && myRank > hubRank(hub, m.id)) {
      actions.append(
        smallButton('Выгнать', 'warn-outline', async () => {
          if (await ask(`Пригласить ${m.displayName} снова можно будет в любой момент.`, { title: 'Выгнать из канала?', ok: 'Выгнать', danger: true }))
            hubAction(Api.del(`/hubs/${hub.id}/members/${m.id}`), `${m.displayName} больше не в канале`);
        }),
        smallButton('Забанить', 'danger', async () => {
          if (await ask(`${m.displayName} пропадёт из канала и всех его комнат, позвать его будет нельзя, пока не снимете бан.`, { title: 'Забанить?', ok: 'Забанить', danger: true }))
            hubAction(Api.post(`/hubs/${hub.id}/bans`, { userId: m.id }), `${m.displayName} забанен`);
        })
      );
    }
    list.append(el('div', { className: 'member-row' }, avatar, info, actions));
  }
  out.push(list);
  return out;
}

function hubBansPane(hub) {
  if (!hub.bans.length) return [el('p', { className: 'muted', textContent: 'Банов нет. Забаненный пропадает из канала и всех его комнат, и позвать его нельзя, пока бан не снимут.' })];
  const list = el('div', { className: 'member-list' });
  for (const b of hub.bans)
    list.append(el('div', { className: 'member-row' }, makeAvatar(b, undefined, 'small'),
      el('div', { className: 'grow ellipsis' }, el('div', { className: 'ellipsis', textContent: b.displayName }), el('div', { className: 'muted small', textContent: `@${b.username} · с ${formatDay(b.bannedAt)}` })),
      smallButton('Снять бан', '', () => hubAction(Api.del(`/hubs/${hub.id}/bans/${b.id}`), `Бан снят: ${b.displayName}`))));
  return [list];
}

for (const t of document.querySelectorAll('#hs-nav [data-tab]'))
  t.onclick = () => {
    settingsTab = t.dataset.tab;
    renderHubSettings();
  };
$('hs-close').onclick = closeHubSettings;
$('hs-leave').onclick = () => {
  const hub = hubById(settingsHubId);
  if (hub) (hub.ownerId === state.me.id ? deleteHub : leaveHub)(hub);
};
$('hub-icon-input').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !settingsHubId) return;
  try {
    await hubAction(Api.upload('PUT', `/hubs/${settingsHubId}/icon`, await makeAvatarBlob(file)), 'Картинка канала обновлена');
  } catch (err) {
    $('hs-error').textContent = err.message;
  }
};

// ---------- Пригласить друзей в канал ----------

let inviteHubId = null;

function openHubInvite(id) {
  if (!hubById(id)) return;
  inviteHubId = id;
  $('hi-search').value = '';
  $('hi-error').textContent = '';
  renderHubInvite();
  $('hub-invite').classList.remove('hidden');
  $('hi-search').focus();
}

function renderHubInvite() {
  const hub = hubById(inviteHubId);
  if (!hub) return $('hub-invite').classList.add('hidden');
  $('hi-title').textContent = `Пригласить друзей в «${hub.name}»`;
  const q = $('hi-search').value.trim().toLowerCase();
  const inHub = new Set(hub.members.map((m) => m.id));
  const invited = new Set(hub.invited);
  const banned = new Set(hub.bans.map((b) => b.id));
  const friends = [...state.contacts.values()]
    .filter((c) => !q || `${c.displayName} ${c.username}`.toLowerCase().includes(q))
    .sort((a, b) => inHub.has(a.id) - inHub.has(b.id) || a.displayName.localeCompare(b.displayName, 'ru'));
  const list = $('hi-list');
  list.replaceChildren();
  if (!state.contacts.size) list.append(el('p', { className: 'muted', textContent: 'Пригласить можно только друзей, а их пока нет. Добавьте их в разделе «Друзья».' }));
  else if (!friends.length) list.append(el('p', { className: 'muted', textContent: 'Никого не нашли' }));
  for (const f of friends) {
    const info = el('div', { className: 'grow ellipsis' }, el('div', { className: 'ellipsis', textContent: f.displayName }), el('div', { className: 'muted small', textContent: `@${f.username}` }));
    let action;
    if (inHub.has(f.id)) action = el('span', { className: 'muted small', textContent: 'Уже в канале' });
    else if (banned.has(f.id)) action = el('span', { className: 'small error-text', textContent: 'Забанен' });
    else if (invited.has(f.id)) action = el('span', { className: 'muted small', textContent: 'Позвали' });
    else
      action = smallButton('Пригласить', 'primary', async () => {
        $('hi-error').textContent = '';
        try {
          applyHub(await Api.post(`/hubs/${hub.id}/invites`, { userIds: [f.id] }));
          toast(`${f.displayName} получит приглашение в «${hub.name}»`);
        } catch (err) {
          $('hi-error').textContent = err.message;
        }
      });
    list.append(el('div', { className: 'member-row' }, makeAvatar(f, presenceOf(f), 'small'), info, action));
  }
}

$('hi-search').oninput = renderHubInvite;
$('hi-close').onclick = () => $('hub-invite').classList.add('hidden');

// ---------- Приглашение мне: вступить или отказаться ----------

let joinHubId = null;

/** Щелчок по приглашению (в столбце или в уведомлении); если уже в канале — просто открыть его */
function openHubJoin(hubId) {
  if (state.hubs.has(hubId)) return openHub(hubId);
  const invite = state.hubInvites.find((i) => i.hub.id === hubId);
  if (!invite) return;
  joinHubId = hubId;
  fillHubIcon($('hj-icon'), invite.hub);
  $('hj-name').textContent = invite.hub.name;
  const n = invite.hub.memberCount;
  $('hj-text').textContent = `${invite.from.displayName} зовёт вас в канал. Там уже ${n} ${plural(n, 'участник', 'участника', 'участников')}.`;
  $('hj-error').textContent = '';
  $('hub-join').classList.remove('hidden');
}

$('hj-accept').onclick = async () => {
  const id = joinHubId;
  try {
    const hub = await Api.post(`/hub-invites/${id}/accept`);
    applyHub(hub);
    await refreshRooms();
    $('hub-join').classList.add('hidden');
    openHub(id);
    toast(`Добро пожаловать в «${hub.name}»`);
  } catch (err) {
    $('hj-error').textContent = err.message;
  }
};

$('hj-decline').onclick = async () => {
  const id = joinHubId;
  try {
    await Api.del(`/hub-invites/${id}`);
  } catch {}
  state.hubInvites = state.hubInvites.filter((i) => i.hub.id !== id);
  $('hub-join').classList.add('hidden');
  renderRail();
};

// ---------- События с сервера ----------

function handleHubEvent(msg) {
  switch (msg.type) {
    case 'hub:updated':
      return applyHub(msg.hub);
    case 'hub:removed': {
      const hub = hubById(msg.hubId);
      forgetHub(msg.hubId);
      if (!hub || msg.reason === 'left') return;
      const text =
        msg.reason === 'banned' ? `Вас забанили в канале «${hub.name}»`
        : msg.reason === 'kicked' ? `Вас выгнали из канала «${hub.name}»`
        : hub.ownerId !== state.me.id ? `Канал «${hub.name}» распустили`
        : '';
      if (!text) return;
      toast(text);
      notify('Канал', text, { kind: 'hub-removed' });
      return;
    }
    case 'hub:invite': {
      const { invite } = msg;
      state.hubInvites = [invite, ...state.hubInvites.filter((i) => i.hub.id !== invite.hub.id)];
      renderRail();
      const text = `${invite.from.displayName} зовёт вас в канал «${invite.hub.name}»`;
      toast(text);
      notify('Приглашение в канал', text, { kind: 'hub-invite', open: { hub: invite.hub.id } });
    }
  }
}


