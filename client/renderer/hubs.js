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
  if (!member) return 0;
  const role = hub.roles?.find((x) => x.id === member.roleId);
  return member.manager || (role?.perms ?? 0) & (PERMS.manage | PERMS.admin) ? 2 : 1;
}
const canManageHub = (hub) => Boolean(hub) && hubRank(hub) >= 2;

// «Наш двор» -> «НД»
const hubInitials = (name) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

const hubIconState = new Map(); // url -> 'ok' | 'fail', чтобы не мигать инициалами при каждом рендере

const HUB_ICON_RE = /^\/api\/hubs\/\d+\/icon(?:\?\d+)?$/;

function fillHubIcon(tile, hub) {
  tile.style.setProperty('--hub-color', hub.iconColor);
  const hasImage = HUB_ICON_RE.test(hub.iconUrl || '') || AVATAR_URL_RE.test(hub.iconUrl || '');
  tile.classList.add('hub-tile');
  if (!hasImage) {
    tile.classList.remove('has-image');
    tile.style.backgroundImage = '';
    tile.textContent = hubInitials(hub.name);
    return;
  }
  // Битая или ещё не загруженная картинка не должна оставлять пустой чёрный квадрат:
  // показываем инициалы, а фото подставляем только после успешной загрузки.
  const url = `${Api.base}${hub.iconUrl}`;
  const known = hubIconState.get(url);
  if (known === 'ok') {
    tile.classList.add('has-image');
    tile.style.backgroundImage = `url("${url}")`;
    tile.textContent = '';
    return;
  }
  if (known === 'fail') {
    tile.classList.remove('has-image');
    tile.style.backgroundImage = '';
    tile.textContent = hubInitials(hub.name);
    return;
  }
  const probe = new Image();
  probe.onload = () => {
    hubIconState.set(url, 'ok');
    tile.classList.add('has-image');
    tile.style.backgroundImage = `url("${url}")`;
    tile.textContent = '';
  };
  probe.onerror = () => {
    hubIconState.set(url, 'fail');
    tile.classList.remove('has-image');
    tile.style.backgroundImage = '';
    tile.textContent = hubInitials(hub.name);
  };
  probe.src = url;
  tile.classList.remove('has-image');
  tile.style.backgroundImage = '';
  tile.textContent = hubInitials(hub.name);
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
/** Пружинный отклик плитки канала после перерисовки рейла */
function pulseRailTile(hubId) {
  if (document.documentElement.dataset.theme !== 'glass') return;
  const paint = () => {
    const tile = document.querySelector(`.rail-item[data-hub="${hubId}"] .rail-tile`);
    if (!tile) return;
    tile.classList.remove('rail-pop');
    void tile.offsetWidth;
    tile.classList.add('rail-pop');
    setTimeout(() => tile.classList.remove('rail-pop'), 360);
  };
  requestAnimationFrame(() => requestAnimationFrame(paint));
}
function openHub(id) {
  if (!hubById(id)) return;
  readNotifsOf({ hub: id });
  const rooms = roomsOfHub(id);
  const room = rooms.find((r) => r.id === lastRoomOf.get(id)) || rooms.find((r) => r.kind === 'text') || rooms[0];
  if (room) {
    pulseRailTile(id);
    return selectRoom(room.id);
  }
  state.view = id;
  state.selectedRoomId = null;
  state.selectedId = null;
  for (const box of ['chat', 'room-view', 'empty-state']) $(box).classList.add('hidden');
  renderContacts();
  renderRooms();
  renderHubChrome();
  renderVoice();
  pulseRailTile(id);
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
  $('hub-muted').classList.toggle('hidden', !hub || !hubMuted(hub.id));
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
  // Плашка активного канала живёт внутри списка и не должна исчезать при перерисовке.
  const indicator = list.querySelector(':scope > .glass-tab-indicator');
  list.replaceChildren();
  if (indicator) list.append(indicator);
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
  box.style.setProperty('--folder-color', folder.color || 'var(--accent-theme)');

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
  for (const room of roomsOfHub(hubId)) if (state.roomUnread.has(room.id)) markRead(`room:${room.id}`);
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

/** items: { label, icon, onclick, danger } или 'sep'; пустые (false) пропускаются */
function showMenu(x, y, items) {
  const menu = $('popup-menu');
  menu.replaceChildren();
  for (const item of items.filter(Boolean)) {
    if (item === 'sep') {
      if (menu.lastChild && !menu.lastChild.classList.contains('popup-sep')) menu.append(el('div', { className: 'popup-sep' }));
      continue;
    }
    if (item.range) {
      const wrap = document.createElement('div');
      wrap.className = 'popup-range';
      const head = document.createElement('div');
      head.className = 'popup-range-head';
      const label = document.createElement('span');
      label.textContent = item.label;
      const value = document.createElement('b');
      value.textContent = item.valueLabel?.(Number(item.value)) || '';
      // Крестик закрывает меню: выбор уровня не «прилипает» к экрану
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'popup-range-close';
      close.title = 'Закрыть';
      close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      close.onclick = (e) => {
        e.stopPropagation();
        hideMenu();
      };
      head.append(label, value, close);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(item.min ?? 0);
      input.max = String(item.max ?? 3);
      input.step = String(item.step ?? 1);
      input.value = String(item.value ?? 0);
      input.oninput = () => {
        value.textContent = item.valueLabel?.(Number(input.value)) || '';
        item.oninput?.(Number(input.value));
      };
      input.onclick = (e) => e.stopPropagation();
      wrap.append(head, input);
      menu.append(wrap);
      continue;
    }
    const button = el('button', {
      type: 'button',
      className: `popup-item${item.danger ? ' danger' : ''}`,
      onclick: () => {
        hideMenu();
        item.onclick();
      },
    });
    if (item.icon) {
      const icon = document.createElement('span');
      icon.className = 'popup-icon';
      icon.innerHTML = item.icon;
      button.append(icon);
    }
    const label = document.createElement('span');
    label.textContent = item.label;
    button.append(label);
    menu.append(button);
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

// Значки для пункта меню и отметки в шапке
const BELL_ON = '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const BELL_OFF =
  '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-9.3-5.2M6 9v-1a6 6 0 0 0-.9 3c0 7-3 9-3 9h14"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M3 3l18 18"/></svg>';
// Календарь с плюсом — событие канала
const EVENT_ICON =
  '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M12 14v5M9.5 16.5h5"/></svg>';

const hubMuteKey = (id) => `hub:mute:${id}`;
const hubMuted = (id) => Boolean(store.get(hubMuteKey(id), false));

/** Выключить или включить звук уведомлений канала (выбор хранится на этом устройстве) */
function toggleHubMute(hub) {
  const off = !hubMuted(hub.id);
  store.set(hubMuteKey(hub.id), off);
  toast(off ? `Звук уведомлений «${hub.name}» выключен` : `Звук уведомлений «${hub.name}» включён`);
  renderHubChrome();
}

function hubMenuItems(hub) {
  const manager = canManageHub(hub);
  const muted = hubMuted(hub.id);
  return [
    manager && { label: 'Пригласить друзей', onclick: () => openHubInvite(hub.id) },
    manager && { label: 'Создать комнату', onclick: () => openRoomCreate('voice', hub.id) },
    manager && { label: 'Создать событие', icon: EVENT_ICON, onclick: () => openEventCreate(hub) },
    { label: muted ? 'Включить уведомления' : 'Выключить уведомления', icon: muted ? BELL_OFF : BELL_ON, onclick: () => toggleHubMute(hub) },
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
    const groupTitle = `${g.title} — ${g.people.length}`;
    box.append(el('div', { className: 'members-group', textContent: groupTitle, title: groupTitle }));
    for (const m of g.people.sort(byName)) {
      const hubMember = hub.members.find((x) => x.id === m.id);
      const name = el('div', { className: 'member-nick ellipsis', textContent: m.nickname || m.displayName });
      if (g.role || m.nameColor) name.style.color = g.role?.color || m.nameColor;
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
const HUB_MEMBER_TABS = ['members', 'emojis']; // что видно участнику без управления каналом
let settingsTab = 'overview';
let hubMemberQuery = '';
const HUB_TABS = { overview: 'Обзор', events: 'События', roles: 'Роли и права', emojis: 'Смайлики', members: 'Участники', bans: 'Баны' };

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
  if (!manager && !HUB_MEMBER_TABS.includes(settingsTab)) settingsTab = 'members';
  $('hs-hub-name').textContent = hub.name;
  $('hs-title').textContent = HUB_TABS[settingsTab];
  $('hs-member-count').textContent = hub.members.length;
  $('hs-ban-count').textContent = hub.bans.length || '';
  for (const t of document.querySelectorAll('#hs-nav [data-tab]')) {
    t.classList.toggle('active', t.dataset.tab === settingsTab);
    t.classList.toggle('hidden', !manager && !HUB_MEMBER_TABS.includes(t.dataset.tab));
  }
  $('hs-leave').textContent = hub.ownerId === state.me.id ? 'Удалить канал' : 'Выйти из канала';

  const body = $('hs-body');
  const focused = document.activeElement?.dataset?.keep;
  const draft = focused && document.activeElement.value;
  body.replaceChildren(...{ overview: hubOverviewPane, events: hubEventsPane, roles: rolesPane, emojis: hubEmojisPane, members: hubMembersPane, bans: hubBansPane }[settingsTab](hub));
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
  const reactionsBox = el('input', { type: 'checkbox', id: 'hs-reactions-visible', checked: hub.reactionsVisible !== false });
  const form = el('form', { className: 'hs-overview' },
    el('div', { className: 'hs-icon-row' }, icon,
      el('div', { className: 'hs-icon-actions' },
        el('div', { className: 'row' },
          smallButton('Загрузить картинку', 'primary', () => $('hub-icon-input').click()),
          hub.iconUrl && smallButton('Убрать', '', () => hubAction(Api.del(`/hubs/${hub.id}/icon`), 'Картинка убрана'))),
        el('p', { className: 'muted small', textContent: 'Загрузите картинку, чтобы канал отличался не только названием.' }))),
    el('label', { className: 'field' }, el('span', { textContent: 'Название' }), name),
    el('div', { className: 'field' }, el('span', { textContent: 'Цвет' }), colors),
    el('label', { className: 'check' }, reactionsBox, el('span', { textContent: 'Показывать, кто поставил реакцию' })),
    el('div', { className: 'row' }, el('div', { className: 'spacer' }), el('button', { className: 'btn primary', textContent: 'Сохранить' })));
  form.onsubmit = (e) => {
    e.preventDefault();
    hubAction(Api.patch(`/hubs/${hub.id}`, { name: name.value.trim(), iconColor: color, reactionsVisible: reactionsBox.checked }), 'Сохранено');
  };
  const owner = hub.members.find((m) => m.id === hub.ownerId);
  const facts = el('div', { className: 'rs-facts' },
    el('div', {}, el('span', { className: 'muted small', textContent: 'Создатель' }), el('b', { textContent: owner?.displayName || '—' })),
    el('div', {}, el('span', { className: 'muted small', textContent: 'Участников' }), el('b', { textContent: hub.members.length })),
    el('div', {}, el('span', { className: 'muted small', textContent: 'Комнат' }), el('b', { textContent: roomsOfHub(hub.id).length })),
    el('div', {}, el('span', { className: 'muted small', textContent: 'Создан' }), el('b', { textContent: formatDay(hub.createdAt) })));
  return [form, facts];
}

let emojiDraftName = '';

/** Смайлики канала: добавляет любой участник, удаляет автор или управляющий */
function hubEmojisPane(hub) {
  const name = el('input', { id: 'hs-emoji-name', placeholder: 'Имя, например кот', maxLength: 24, value: emojiDraftName });
  name.dataset.keep = 'emoji-name';
  name.oninput = () => (emojiDraftName = name.value);
  const add = el('div', { className: 'rs-row' }, name, smallButton('Выбрать картинку', 'primary', () => {
    if (!name.value.trim()) return ($('hs-error').textContent = 'Сначала придумайте имя');
    $('hub-emoji-input').click();
  }));
  const hint = el('p', { className: 'muted small', textContent: `В сообщениях комнат этого канала: :имя:. Буквы, цифры и _, до 50 смайликов на канал. Сейчас: ${hub.emojis.length}.` });
  const list = el('div', { className: 'hs-emojis' });
  for (const e of hub.emojis) {
    const row = el('div', { className: 'hs-emoji' },
      el('img', { src: `${Api.base}${e.url}`, alt: e.name }),
      el('b', { className: 'grow ellipsis', textContent: `:${e.name}:` }),
      (e.createdBy === state.me.id || canManageHub(hub)) &&
        smallButton('Удалить', '', () => hubAction(Api.del(`/hubs/${hub.id}/emojis/${e.id}`), 'Смайлик удалён')));
    list.append(row);
  }
  return [add, hint, list];
}

/** Картинка смайлика: вписываем в квадрат 128×128, прозрачность сохраняем */
async function emojiBlob(file) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Не получилось открыть картинку');
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const scale = Math.min(128 / bitmap.width, 128 / bitmap.height);
  const [w, h] = [bitmap.width * scale, bitmap.height * scale];
  canvas.getContext('2d').drawImage(bitmap, (128 - w) / 2, (128 - h) / 2, w, h);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
}

async function addHubEmoji(file) {
  try {
    const blob = await emojiBlob(file);
    const name = encodeURIComponent(emojiDraftName.trim());
    await hubAction(Api.upload('PUT', `/hubs/${settingsHubId}/emojis/${name}`, blob), 'Смайлик добавлен');
    if (!$('hs-error').textContent) emojiDraftName = '';
    renderHubSettings();
  } catch (err) {
    $('hs-error').textContent = err.message;
  }
}

$('hub-emoji-input').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file && settingsHubId) addHubEmoji(file);
};

// ---------- События канала ----------

let eventHubId = null;

/** Все события канала: лежат в комнатах, куда их опубликовали */
function hubEvents(hub) {
  return roomsOfHub(hub.id)
    .flatMap((room) => (room.events || []).map((ev) => ({ ev, room })))
    .sort((a, b) => a.ev.startsAt - b.ev.startsAt);
}

function hubEventsPane(hub) {
  const box = el(
    'div',
    { className: 'hub-events' },
    el('p', {
      className: 'muted small',
      textContent:
        'Событие появится в выбранном чате: участники отметят готовность — «буду», «не смогу» или «готов в другое время».',
    })
  );
  const create = el('button', { className: 'btn primary', type: 'button', textContent: 'Создать событие' });
  create.onclick = () => openEventCreate(hub);
  box.append(el('div', { className: 'row' }, create));

  const list = hubEvents(hub);
  if (!list.length) {
    box.append(el('p', { className: 'muted small', textContent: 'Пока событий нет' }));
    return [box];
  }
  for (const { ev, room } of list) {
    const going = (ev.responses || []).filter((r) => r.status === 'yes').length;
    const row = el(
      'div',
      { className: 'hub-event' },
      el(
        'div',
        { className: 'hub-event-main' },
        el('b', { textContent: ev.title }),
        el('span', {
          className: 'muted small',
          textContent: `${formatDay(ev.startsAt)} · ${formatTime(ev.startsAt)} · #${room.name}`,
        })
      ),
      el('span', { className: 'muted small', textContent: `Будут: ${going}` })
    );
    const del = el('button', { className: 'btn small', type: 'button', textContent: 'Удалить' });
    del.onclick = async () => {
      // Сервер отдаёт обновлённую комнату, а не канал: применяем её и перерисовываем список.
      // Раньше ответ уходил в hubAction → applyHub(room) и список событий не обновлялся
      $('hs-error').textContent = '';
      try {
        applyRoomUpdate(await Api.del(`/events/${ev.id}`));
        renderHubSettings();
        toast('Событие удалено');
      } catch (err) {
        $('hs-error').textContent = err.message;
      }
    };
    row.append(del);
    box.append(row);
  }
  return [box];
}

// Выбранное в окне события: день, время и чат
let eventDraft = { date: null, time: '00:00', roomId: null, repeat: 'none', remind: 0 };
const pad2 = (n) => String(n).padStart(2, '0');

const EVENT_REPEATS = [
  ['none', 'Однократно'],
  ['daily', 'Каждый день'],
  ['weekdays', 'По будням'],
  ['weekly', 'Каждую неделю в этот день'],
];
const EVENT_REMIND = [
  [0, 'Без напоминания'],
  [5, 'За 5 минут'],
  [10, 'За 10 минут'],
  [15, 'За 15 минут'],
  [30, 'За 30 минут'],
  [60, 'За час'],
];

function syncEventPickers() {
  $('event-date').value = eventDraft.date ? eventDraft.date.toLocaleDateString('ru-RU') : '';
  $('event-time').value = eventDraft.time;
  const room = roomById(eventDraft.roomId);
  $('event-room').textContent = room ? `# ${room.name}` : 'Выберите чат';
  $('event-repeat').textContent = EVENT_REPEATS.find(([id]) => id === eventDraft.repeat)?.[1] || 'Однократно';
  $('event-remind').textContent = EVENT_REMIND.find(([id]) => id === eventDraft.remind)?.[1] || 'Без напоминания';
}

/** Дата, вписанная руками: 12.11.2026, 12.11 или 12.11.26 */
function parseDateText(text) {
  const m = String(text).trim().match(/^(\d{1,2})\s*[.\/,:\s-]\s*(\d{1,2})(?:\s*[.\/,:\s-]\s*(\d{2,4}))?$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  let year = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

/** Время, вписанное руками: 21:30, 21.30, 2130 или просто 21 → 21:00 */
function parseTimeText(text) {
  const raw = String(text).trim();
  const m = raw.match(/^(\d{1,2})\s*[:.,\s]\s*(\d{2})$/) || raw.match(/^(\d{1,2})(\d{2})$/);
  const single = raw.match(/^(\d{1,2})$/);
  const h = single ? Number(single[1]) : m ? Number(m[1]) : NaN;
  const min = single ? 0 : m ? Number(m[2]) : NaN;
  if (!Number.isInteger(h) || !Number.isInteger(min) || h > 23 || min > 59) return null;
  return `${pad2(h)}:${pad2(min)}`;
}

// Вписал руками — сразу подхватываем
$('event-date').onchange = () => {
  const date = parseDateText($('event-date').value);
  if (date) eventDraft.date = date;
  $('event-date').value = eventDraft.date ? eventDraft.date.toLocaleDateString('ru-RU') : '';
};
$('event-time').onchange = () => {
  const time = parseTimeText($('event-time').value);
  if (time) eventDraft.time = time;
  $('event-time').value = eventDraft.time;
};

// Календарь в стиле приложения
function buildEventCalendar() {
  const pop = $('event-date-pop');
  const start = eventDraft.date ? new Date(eventDraft.date) : new Date();
  let view = new Date(start.getFullYear(), start.getMonth(), 1);

  const draw = () => {
    const head = el('div', { className: 'cal-head' });
    const prev = el('button', { type: 'button', className: 'cal-nav', textContent: '‹' });
    const next = el('button', { type: 'button', className: 'cal-nav', textContent: '›' });
    const title = el('b', { textContent: view.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) });
    head.append(prev, title, next);

    const grid = el('div', { className: 'cal-grid' });
    for (const w of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) grid.append(el('span', { className: 'cal-dow', textContent: w }));
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const shift = (first.getDay() + 6) % 7;
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    for (let i = 0; i < shift; i++) grid.append(el('span', { className: 'cal-empty' }));
    for (let d = 1; d <= days; d++) {
      const date = new Date(view.getFullYear(), view.getMonth(), d);
      const cell = el('button', { type: 'button', className: 'cal-day', textContent: String(d) });
      if (eventDraft.date && date.toDateString() === eventDraft.date.toDateString()) cell.classList.add('selected');
      if (date.toDateString() === new Date().toDateString()) cell.classList.add('today');
      cell.onclick = () => {
        eventDraft.date = date;
        syncEventPickers();
        pop.classList.add('hidden');
      };
      grid.append(cell);
    }

    const foot = el('div', { className: 'cal-foot' });
    const today = el('button', { type: 'button', className: 'btn small', textContent: 'Сегодня' });
    today.onclick = () => {
      eventDraft.date = new Date();
      syncEventPickers();
      pop.classList.add('hidden');
    };
    foot.append(today);

    prev.onclick = () => {
      view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
      draw();
    };
    next.onclick = () => {
      view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
      draw();
    };
    pop.replaceChildren(head, grid, foot);
  };
  draw();
}

// Время: часы и минуты сеткой, подтверждение — «ОК»
/** Колёса-барабаны: часы и минуты прокручиваются и «прилипают» к выбранному значению */
function buildTimeDrum(container, time, onChange) {
  let [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h)) h = 0;
  if (!Number.isFinite(m)) m = 0;

  const wrap = el('div', { className: 'drum' });
  const columns = [];

  const makeColumn = (values, getValue, setValue) => {
    const col = el('div', { className: 'drum-col' });
    for (const v of values) {
      const b = el('button', { type: 'button', className: 'time-cell', textContent: pad2(v) });
      b.dataset.value = v;
      b.onclick = () => {
        setValue(v);
        centerColumn(col, v);
        onChange(h, m);
      };
      col.append(b);
    }
    columns.push({ col, getValue });
    return col;
  };

  const centerColumn = (col, value) => {
    const cells = [...col.children];
    cells.forEach((c) => c.classList.toggle('selected', Number(c.dataset.value) === value));
    const cell = cells.find((c) => Number(c.dataset.value) === value);
    if (cell) col.scrollTop = cell.offsetTop - col.clientHeight / 2 + cell.offsetHeight / 2;
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const mins = Array.from({ length: 12 }, (_, i) => i * 5);
  wrap.append(
    makeColumn(hours, () => h, (v) => (h = v)),
    makeColumn(mins, () => m, (v) => (m = v)),
    // Подсветка выбранной строки: аккуратная полоса по центру вместо крупных плашек
    el('div', { className: 'drum-band' })
  );
  container.replaceChildren(wrap);

  // Прокрутка тоже выбирает: значение, ближайшее к центру, становится выбранным
  for (const [index, { col, getValue }] of columns.entries()) {
    centerColumn(col, getValue());
    let lock = true;
    let timer = null;
    setTimeout(() => (lock = false), 320);
    col.addEventListener('scroll', () => {
      if (lock) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const center = col.scrollTop + col.clientHeight / 2;
        let best = col.children[0];
        for (const c of col.children) {
          if (Math.abs(c.offsetTop + c.offsetHeight / 2 - center) < Math.abs(best.offsetTop + best.offsetHeight / 2 - center)) best = c;
        }
        const value = Number(best.dataset.value);
        [...col.children].forEach((c) => c.classList.toggle('selected', c === best));
        if (index === 0) h = value;
        else m = value;
        onChange(h, m);
      }, 150);
    });
  }
}
function buildEventTimePicker() {
  const pop = $('event-time-pop');
  const body = el('div', { className: 'time-drum-body' });
  buildTimeDrum(body, eventDraft.time, (h, m) => {
    eventDraft.time = `${pad2(h)}:${pad2(m)}`;
    syncEventPickers();
  });

  const foot = el('div', { className: 'time-foot' });
  const ok = el('button', { type: 'button', className: 'btn small primary', textContent: 'ОК' });
  ok.onclick = () => pop.classList.add('hidden');
  foot.append(ok);
  pop.replaceChildren(body, foot);
}

// Список чатов канала
// Список вариантов: повтор и напоминание
function buildEventOptionPicker(popId, options, current, onPick) {
  const pop = $(popId);
  pop.replaceChildren(
    ...options.map(([value, label]) => {
      const b = el('button', {
        type: 'button',
        className: `picker-option${value === current ? ' selected' : ''}`,
        textContent: label,
      });
      b.onclick = () => {
        onPick(value);
        syncEventPickers();
        pop.classList.add('hidden');
      };
      return b;
    })
  );
}

// Список чатов канала
function buildEventRoomPicker(rooms) {
  const pop = $('event-room-pop');
  pop.replaceChildren(
    ...rooms.map((room) => {
      const b = el('button', {
        type: 'button',
        className: `picker-option${room.id === eventDraft.roomId ? ' selected' : ''}`,
        textContent: `# ${room.name}`,
      });
      b.onclick = () => {
        eventDraft.roomId = room.id;
        syncEventPickers();
        pop.classList.add('hidden');
      };
      return b;
    })
  );
}

let editingEventId = null;
function openEventCreate(hub, editEvent = null) {
  eventHubId = hub.id;
  $('event-error').textContent = '';
  editingEventId = editEvent?.id ?? null;

  // По умолчанию — сегодня, через час; при правке — как в событии
  const soon = new Date(Date.now() + 60 * 60_000);
  soon.setMinutes(0, 0, 0);
  const base = editEvent ? new Date(editEvent.startsAt) : soon;
  const rooms = roomsOfHub(hub.id);
  const current = rooms.find((r) => r.id === state.selectedRoomId) || rooms.find((r) => r.kind === 'text') || rooms[0];
  $('event-title').value = editEvent?.title ?? '';
  $('event-create-title').textContent = editEvent ? 'Изменить событие' : 'Новое событие';
  $('event-submit').textContent = editEvent ? 'Обновить событие' : 'Создать событие';
  eventDraft = {
    date: base,
    time: `${pad2(base.getHours())}:${pad2(base.getMinutes())}`,
    roomId: editEvent?.roomId ?? current?.id ?? null,
    repeat: editEvent?.repeat ?? 'none',
    remind: editEvent?.remind ?? 0,
  };
  syncEventPickers();
  for (const pop of document.querySelectorAll('#event-create .picker-pop')) pop.classList.add('hidden');
  const people = hub.members.filter((m) => m.id !== state.me.id);
  const box = $('event-invitees');
  const list = box.querySelector('.multi-list');
  const toggle = box.querySelector('.multi-toggle');
  list.replaceChildren(
    ...people.map((m) =>
      el(
        'label',
        { className: 'multi-option' },
        Object.assign(document.createElement('input'), { type: 'checkbox', value: m.id }),
        el('span', { textContent: m.nickname || m.displayName })
      )
    )
  );
  // При правке отмечаем тех, кто уже в событии: кого пригласили и кто присоединился сам
  if (editEvent) {
    const inEvent = new Set((editEvent.responses || []).map((r) => r.userId));
    for (const input of list.querySelectorAll('input')) input.checked = inEvent.has(Number(input.value));
  }
  const updateToggle = () => {
    const chosen = list.querySelectorAll('input:checked').length;
    toggle.textContent = chosen ? `Выбрано: ${chosen}` : 'Никто не выбран';
    toggle.classList.toggle('has-value', chosen > 0);
  };
  list.onchange = updateToggle;
  toggle.onclick = (e) => {
    e.stopPropagation();
    list.classList.toggle('hidden');
    toggle.classList.toggle('open', !list.classList.contains('hidden'));
  };
  list.classList.add('hidden');
  updateToggle();

  $('event-create').classList.remove('hidden');
  setTimeout(() => $('event-title').focus(), 0);
}

const closeEventCreate = () => {
  $('event-create').classList.add('hidden');
  eventHubId = null;
};

// Выпадающие списки в стиле приложения: открываем нужный, остальные прячем
function togglePicker(toggleId, popId, build) {
  const pop = $(popId);
  const opening = pop.classList.contains('hidden');
  for (const other of document.querySelectorAll('#event-create .picker-pop')) other.classList.add('hidden');
  if (!opening) return;
  build();
  pop.classList.remove('hidden', 'up');
  $(toggleId).classList.add('open');
  // Не влезает вниз — раскрываем вверх
  if (pop.getBoundingClientRect().bottom > innerHeight - 8) pop.classList.add('up');
}

$('event-date-open').onclick = (e) => {
  e.stopPropagation();
  togglePicker('event-date-open', 'event-date-pop', buildEventCalendar);
};
$('event-time-open').onclick = (e) => {
  e.stopPropagation();
  togglePicker('event-time-open', 'event-time-pop', buildEventTimePicker);
};
$('event-room').onclick = (e) => {
  e.stopPropagation();
  togglePicker('event-room', 'event-room-pop', () => buildEventRoomPicker(roomsOfHub(eventHubId)));
};
$('event-repeat').onclick = (e) => {
  e.stopPropagation();
  togglePicker('event-repeat', 'event-repeat-pop', () =>
    buildEventOptionPicker('event-repeat-pop', EVENT_REPEATS, eventDraft.repeat, (v) => (eventDraft.repeat = v))
  );
};
$('event-remind').onclick = (e) => {
  e.stopPropagation();
  togglePicker('event-remind', 'event-remind-pop', () =>
    buildEventOptionPicker('event-remind-pop', EVENT_REMIND, eventDraft.remind, (v) => (eventDraft.remind = v))
  );
};

$('event-cancel').onclick = closeEventCreate;
  $('event-x').onclick = closeEventCreate;
$('event-create').onclick = (e) => {
  if (e.target === $('event-create')) closeEventCreate();
};

$('event-form').onsubmit = async (e) => {
  e.preventDefault();
  const hub = hubById(eventHubId);
  if (!hub) return;
  const title = $('event-title').value.trim();
  if (!title) return ($('event-error').textContent = 'Название события обязательно');
  // Берём то, что вписано руками, иначе — выбранное в календаре
  const date = parseDateText($('event-date').value) || eventDraft.date;
  const time = parseTimeText($('event-time').value) || eventDraft.time;
  if (!date) return ($('event-error').textContent = 'День: например, 12.11.2026');
  if (!time) return ($('event-error').textContent = 'Время: например, 21:30');
  if (!eventDraft.roomId) return ($('event-error').textContent = 'Выберите чат для публикации');
  const [hours, minutes] = time.split(':').map(Number);
  const startsAt = new Date(date);
  startsAt.setHours(hours, minutes, 0, 0);
  if (!Number.isFinite(startsAt.getTime())) return ($('event-error').textContent = 'Не получилось разобрать дату');

  const roomId = eventDraft.roomId;
  const invitees = [...$('event-invitees').querySelectorAll('input:checked')].map((i) => Number(i.value));
  try {
    // Правка существующего события: меняем на месте, участники и ответы остаются
    if (editingEventId) {
      applyRoomUpdate(
        await Api.patch(`/events/${editingEventId}`, {
          title,
          startsAt: startsAt.getTime(),
          repeat: eventDraft.repeat,
          remind: eventDraft.remind,
          invitees,
        })
      );
      closeEventCreate();
      toast('Событие изменено');
      return;
    }
    const room = await Api.post(`/rooms/${roomId}/events`, {
      title,
      startsAt: startsAt.getTime(),
      invitees,
      repeat: eventDraft.repeat,
      remind: eventDraft.remind,
    });
    // Комната пришла уже с событием — обновляем её у себя, иначе карточка не найдёт событие
    applyRoomUpdate(room);
    // Публикуем событие сообщением в выбранный чат: внутри конверта только id
    const event =
      (room.createdEventId && (room.events || []).find((x) => x.id === room.createdEventId)) ||
      [...(room.events || [])].reverse().find((x) => x.createdBy === state.me.id && x.title === title);
    if (event) {
      const { body, plain } = await encryptOutgoing(roomConvOf(roomId), { text: `Событие: ${title}`, eventId: event.id });
      addRoomMessage({ ...(await Api.post(`/rooms/${roomId}/messages`, body)), plain });
    }
    closeEventCreate();
    renderHubSettings();
    toast('Событие создано');
    if (state.selectedRoomId !== roomId) selectRoom(roomId);
  } catch (err) {
    $('event-error').textContent = err.message;
  }
};

// ---------- Активные события в шапке комнаты ----------
const activeRoomEvents = (room) => (room?.events || []).filter((e) => e.active !== false && !e.completed);
let eventViewId = null;

function renderRoomEventsBadge() {
  const btn = $('room-events-btn');
  if (!btn) return;
  const room = roomById(state.selectedRoomId);
  const list = activeRoomEvents(room);
  btn.classList.toggle('hidden', !list.length);
  $('room-events-count').textContent = String(list.length);
  $('room-events-menu').classList.add('hidden');
  btn.onclick = (e) => {
    e.stopPropagation();
    const menu = $('room-events-menu');
    if (!menu.classList.contains('hidden')) return menu.classList.add('hidden');
    menu.replaceChildren(
      ...list.map((ev) => {
        const item = el(
          'button',
          { type: 'button', className: 'room-event-item' },
          el('b', { textContent: ev.title }),
          el('span', { className: 'muted small', textContent: `${formatDay(ev.startsAt)} · ${formatTime(ev.startsAt)}` })
        );
        item.onclick = () => {
          menu.classList.add('hidden');
          openEventView(ev.id);
        };
        return item;
      })
    );
    menu.classList.remove('hidden');
  };
}

function openEventView(eventId) {
  const room = roomById(state.selectedRoomId);
  const ev = (room?.events || []).find((x) => x.id === eventId);
  if (!ev) return;
  eventViewId = eventId;
  $('ev-title').textContent = ev.title;
  $('ev-when').textContent = `${formatDay(ev.startsAt)} · ${formatTime(ev.startsAt)}`;
  const repeat = { daily: 'Каждый день', weekdays: 'По будням', weekly: 'Каждую неделю' }[ev.repeat] || 'Однократно';
  $('ev-repeat').textContent = `${repeat}${ev.remind ? ` · напомним за ${ev.remind} мин` : ''}`;
  const answers = (ev.responses || []).filter((r) => r.status !== 'invited');
  const people = $('ev-people');
  people.replaceChildren(
    ...answers.map((r) => {
      const member = room.members.find((m) => m.id === r.userId);
      const name = member?.nickname || member?.displayName || userById(r.userId)?.displayName || '?';
      const label =
        { yes: 'буду', no: 'не смогу', maybe: `готов в ${r.readyAt ? formatTime(r.readyAt) : 'другое время'}` }[r.status] || '';
      return el('span', { className: `event-chip ${r.status}`, textContent: `${name} - ${label}` });
    })
  );
  if (!answers.length) people.replaceChildren(el('span', { className: 'muted small', textContent: 'Пока никто не ответил' }));
  const canFinish = ev.createdBy === state.me.id || canManageHub(hubById(room.hubId));
  $('ev-finish').classList.toggle('hidden', !canFinish || ev.completed);
  $('ev-error').textContent = '';
  $('event-view').classList.remove('hidden');
}

$('ev-edit').onclick = () => {
  const room = roomById(state.selectedRoomId);
  const ev = (room?.events || []).find((x) => x.id === eventViewId);
  if (!ev) return;
  $('event-view').classList.add('hidden');
  openEventCreate(hubById(room.hubId), ev);
};

$('ev-close').onclick = () => $('event-view').classList.add('hidden');
$('event-view').onclick = (e) => {
  if (e.target === $('event-view')) $('event-view').classList.add('hidden');
};
$('ev-finish').onclick = async () => {
  if (!eventViewId) return;
  try {
    const room = await Api.post(`/events/${eventViewId}/finish`, {});
    applyRoomUpdate(room);
    $('event-view').classList.add('hidden');
    toast('Событие завершено');
  } catch (err) {
    $('ev-error').textContent = err.message;
  }
};

// Список событий закрывается щелчком мимо
document.addEventListener('click', (e) => {
  if (e.target.closest('.room-events-wrap')) return;
  $('room-events-menu')?.classList.add('hidden');
});

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
    const role = hub.roles?.find((x) => x.id === m.roleId);
    if (role) tags.append(el('span', { className: 'tag', textContent: role.name }));
    const info = el('div', { className: 'grow member-info' },
      el('div', { className: 'ellipsis member-name', textContent: mine ? `${m.displayName} (вы)` : m.displayName }), tags);
    info.dataset.profile = m.id;
    const avatar = makeAvatar(m, presenceIn(m));
    avatar.dataset.profile = m.id;
    const actions = el('div', { className: 'member-actions' });
    // Роль на весь канал назначает тот, кто настраивает роли, и только тем, кто младше (себе — тоже можно)
    if (myRank >= 2 && m.id !== hub.ownerId && (mine || myRank > hubRank(hub, m.id))) {
      const select = el('select', { className: 'role-select', title: 'Роль в канале' }, new Option('Без роли', ''));
      for (const r of hub.roles || []) {
        const opt = new Option(r.name, r.id);
        opt.disabled = Boolean(r.perms & PERMS.admin) && hub.ownerId !== state.me.id;
        select.add(opt);
      }
      select.value = m.roleId ?? '';
      select.onchange = () => setHubRole(hub, m.id, select.value ? Number(select.value) : null);
      actions.append(select);
    }
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
    const blob = await makeAvatarBlob(file, { title: 'Картинка канала', round: false });
    if (blob) await hubAction(Api.upload('PUT', `/hubs/${settingsHubId}/icon`, blob), 'Картинка канала обновлена');
  } catch (err) {
    $('hs-error').textContent = err.message;
  }
};

// ---------- Имя участника в канале ----------

let nickTarget = null; // { hubId, userId }

/** Своё имя человека в текущем канале (или null, если его там не переименовывали) */
function channelNickOf(userId) {
  const room = state.selectedRoomId && roomById(state.selectedRoomId);
  const member = room?.members?.find((m) => m.id === userId) || currentHub()?.members?.find((m) => m.id === userId);
  return member?.nickname || null;
}

function openNicknameDialog(hub, user) {
  const member = hub.members.find((m) => m.id === user.id);
  nickTarget = { hubId: hub.id, userId: user.id };
  $('nick-real').textContent = user.displayName || user.username;
  $('nick-hub').textContent = hub.name;
  $('nick-input').value = member?.nickname || user.displayName || user.username || '';
  $('nick-error').textContent = '';
  $('nick-modal').classList.remove('hidden');
  setTimeout(() => {
    $('nick-input').focus();
    $('nick-input').select();
  }, 0);
}

const closeNicknameDialog = () => {
  $('nick-modal').classList.add('hidden');
  nickTarget = null;
};

$('nick-form').onsubmit = async (e) => {
  e.preventDefault();
  if (!nickTarget) return;
  const name = $('nick-input').value.trim();
  if (!name) {
    $('nick-error').textContent = 'Имя не может быть пустым';
    return;
  }
  try {
    applyHub(await Api.put(`/hubs/${nickTarget.hubId}/members/${nickTarget.userId}/nickname`, { name }));
    closeNicknameDialog();
    toast('Имя в канале изменено');
    renderMembers();
  } catch (err) {
    $('nick-error').textContent = err.message;
  }
};

$('nick-reset').onclick = async () => {
  if (!nickTarget) return;
  try {
    applyHub(await Api.del(`/hubs/${nickTarget.hubId}/members/${nickTarget.userId}/nickname`));
    closeNicknameDialog();
    toast('Вернули настоящее имя');
    renderMembers();
  } catch (err) {
    $('nick-error').textContent = err.message;
  }
};

$('nick-cancel').onclick = closeNicknameDialog;
$('nick-modal').onclick = (e) => {
  if (e.target === $('nick-modal')) closeNicknameDialog();
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
  $('hi-x').onclick = () => $('hub-invite').classList.add('hidden');

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



// Выпадающие списки (участники, календарь, время, чат) закрываются щелчком мимо
document.addEventListener('click', (e) => {
  // Кнопку могли перерисовать прямо во время клика — это не «щелчок мимо»
  if (!e.target.isConnected) return;
  if (!e.target.closest('.multi-select')) {
    for (const list of document.querySelectorAll('.multi-select .multi-list')) list.classList.add('hidden');
    for (const toggle of document.querySelectorAll('.multi-toggle')) toggle.classList.remove('open');
  }
  if (!e.target.closest('.picker')) {
    for (const pop of document.querySelectorAll('.picker-pop')) pop.classList.add('hidden');
    for (const toggle of document.querySelectorAll('.picker-toggle')) toggle.classList.remove('open');
  }
});
