// РљР°РЅР°Р»С‹ вЂ” СЃРІРѕР№ В«СЃРµСЂРІРµСЂВ» РґР»СЏ СЃРІРѕРёС…: РєРѕРјРЅР°С‚С‹ РІРЅСѓС‚СЂРё, СѓС‡Р°СЃС‚РЅРёРєРё, РїСЂРёРіР»Р°С€РµРЅРёСЏ РґСЂСѓР·РµР№.
// Р—РґРµСЃСЊ: СЃС‚РѕР»Р±РµС† РєР°РЅР°Р»РѕРІ СЃР»РµРІР° (Р»РёС‡РЅС‹Р№ РїРѕСЂСЏРґРѕРє Рё РіСЂСѓРїРїС‹ вЂ” rail-layout.js), С€Р°РїРєР° РєР°РЅР°Р»Р° СЃ РјРµРЅСЋ,
// СЃРїРёСЃРѕРє СѓС‡Р°СЃС‚РЅРёРєРѕРІ СЃРїСЂР°РІР°, РѕРєРЅР° В«РЎРѕР·РґР°С‚СЊ РєР°РЅР°Р»В», РЅР°СЃС‚СЂРѕР№РєРё, РїСЂРёРіР»Р°С€РµРЅРёСЏ. РљРѕРјРЅР°С‚С‹ РєР°РЅР°Р»Р° вЂ” РІ rooms.js

const HUB_MODALS = ['hub-create', 'hub-settings', 'hub-invite', 'hub-join', 'folder-edit'];
const lastRoomOf = new Map(); // id РєР°РЅР°Р»Р° -> РїРѕСЃР»РµРґРЅСЏСЏ РѕС‚РєСЂС‹С‚Р°СЏ РІ РЅС‘Рј РєРѕРјРЅР°С‚Р°

const hubById = (id) => state.hubs.get(id);
const currentHub = () => (state.view === 'home' ? null : hubById(state.view) || null);
const roomsOfHub = (hubId) => [...state.rooms.values()].filter((r) => r.hubId === hubId);

/** РЎС‚Р°СЂС€РёРЅСЃС‚РІРѕ РІ РєР°РЅР°Р»Рµ, РєР°Рє РЅР° СЃРµСЂРІРµСЂРµ: СЃРѕР·РґР°С‚РµР»СЊ 3, СѓРїСЂР°РІР»СЏСЋС‰РёР№ 2, СѓС‡Р°СЃС‚РЅРёРє 1 */
function hubRank(hub, userId = state.me.id) {
  if (hub.ownerId === userId) return 3;
  const member = hub.members.find((m) => m.id === userId);
  if (!member) return 0;
  const role = hub.roles?.find((x) => x.id === member.roleId);
  return member.manager || (role?.perms ?? 0) & (PERMS.manage | PERMS.admin) ? 2 : 1;
}
const canManageHub = (hub) => Boolean(hub) && hubRank(hub) >= 2;

// В«РќР°С€ РґРІРѕСЂВ» -> В«РќР”В»
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

// ---------- Р”Р°РЅРЅС‹Рµ ----------

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

/** РЎРІРµР¶РёРµ РґР°РЅРЅС‹Рµ РєР°РЅР°Р»Р°: СЃС‚РѕР»Р±РµС†, С€Р°РїРєР°, РїСЂР°РІР° РІ РµРіРѕ РєРѕРјРЅР°С‚Р°С… Рё РѕС‚РєСЂС‹С‚С‹Рµ РѕРєРЅР° */
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

/** РљР°РЅР°Р»Р° Р±РѕР»СЊС€Рµ РЅРµС‚ (РІС‹С€Р»Рё, РІС‹РіРЅР°Р»Рё, СѓРґР°Р»РёР»Рё) */
function forgetHub(id) {
  state.hubs.delete(id);
  for (const room of roomsOfHub(id)) forgetRoom(room.id);
  lastRoomOf.delete(id);
  if (settingsHubId === id) closeHubSettings();
  if (inviteHubId === id) $('hub-invite').classList.add('hidden');
  if (state.view === id) selectContact(null);
  renderRail();
}

// ---------- Р§С‚Рѕ РѕС‚РєСЂС‹С‚Рѕ: РґРѕРј РёР»Рё РєР°РЅР°Р» ----------

/** РћС‚РєСЂС‹С‚СЊ РєР°РЅР°Р»: РµРіРѕ РїРѕСЃР»РµРґРЅСЋСЋ РєРѕРјРЅР°С‚Сѓ, РёРЅР°С‡Рµ РїРµСЂРІСѓСЋ С‚РµРєСЃС‚РѕРІСѓСЋ, РёРЅР°С‡Рµ Р»СЋР±СѓСЋ; РєРѕРјРЅР°С‚ РЅРµС‚ вЂ” В«РўСѓС‚ РїРѕРєР° РїСѓСЃС‚РѕВ» */
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

/** РћС‚РєСЂС‹С‚Р°СЏ РєРѕРјРЅР°С‚Р° РїСЂРѕРїР°Р»Р°: РІ РєР°РЅР°Р»Рµ вЂ” РґСЂСѓРіР°СЏ РµРіРѕ РєРѕРјРЅР°С‚Р°, РґРѕРјР° вЂ” СЂР°Р·РґРµР» В«Р”СЂСѓР·СЊСЏВ» */
const leaveSelectedRoom = () => (currentHub() ? openHub(state.view) : selectRoom(null));

/** Р‘РѕРєРѕРІР°СЏ РїР°РЅРµР»СЊ Рё С†РµРЅС‚СЂ РїРѕРґ С‚Рѕ, С‡С‚Рѕ РѕС‚РєСЂС‹С‚Рѕ: РґРѕРј (РґСЂСѓР·СЊСЏ Рё Р»РёС‡РЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ) РёР»Рё РєР°РЅР°Р» */
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
    ? 'РЎРѕР·РґР°Р№С‚Рµ РїРµСЂРІСѓСЋ РєРѕРјРЅР°С‚Сѓ: РіРѕР»РѕСЃРѕРІСѓСЋ вЂ” С‡С‚РѕР±С‹ СЂР°Р·РіРѕРІР°СЂРёРІР°С‚СЊ, С‚РµРєСЃС‚РѕРІСѓСЋ вЂ” С‡С‚РѕР±С‹ РїРµСЂРµРїРёСЃС‹РІР°С‚СЊСЃСЏ.'
    : 'РљРѕРјРЅР°С‚ РїРѕРєР° РЅРµС‚ вЂ” РёС… СЃРѕР·РґР°С‘С‚ С‚РѕС‚, РєС‚Рѕ СѓРїСЂР°РІР»СЏРµС‚ РєР°РЅР°Р»РѕРј.';
  const actions = $('hub-empty-actions');
  actions.replaceChildren();
  if (manager)
    actions.append(
      smallButton('РЎРѕР·РґР°С‚СЊ РєРѕРјРЅР°С‚Сѓ', 'primary', () => openRoomCreate('voice')),
      smallButton('РџСЂРёРіР»Р°СЃРёС‚СЊ РґСЂСѓР·РµР№', '', () => openHubInvite(hub.id))
    );
}

// ---------- РЎС‚РѕР»Р±РµС† РєР°РЅР°Р»РѕРІ ----------

const layoutKey = () => `rail:${state.me.id}`;

/** РЎРІРѕСЏ СЂР°СЃРєР»Р°РґРєР°, РїРѕС‡РёРЅРµРЅРЅР°СЏ РїРѕРґ РЅС‹РЅРµС€РЅРёР№ СЃРїРёСЃРѕРє РєР°РЅР°Р»РѕРІ */
const currentLayout = () => normalizeLayout(store.get(layoutKey(), null), [...state.hubs.keys()]);

function saveLayout(layout) {
  store.set(layoutKey(), layout);
  renderRail();
}

let dragKey = null; // С‡С‚Рѕ С‚Р°С‰РёРј: id РєР°РЅР°Р»Р° (С‡РёСЃР»Рѕ) РёР»Рё id РіСЂСѓРїРїС‹ (СЃС‚СЂРѕРєР°)
let railDirty = false;

const hubUnread = (hubId) => roomsOfHub(hubId).some((r) => state.roomUnread.get(r.id));
const hubInVoice = (hubId) => Boolean(state.room) && roomById(state.room.roomId)?.hubId === hubId;

function renderRail() {
  if (!state.me) return;
  // РџРѕРєР° С‚Р°С‰РёРј, РЅРµ РїРµСЂРµСЃС‚СЂР°РёРІР°РµРј вЂ” РёРЅР°С‡Рµ РїРµСЂРµС‚Р°СЃРєРёРІР°РЅРёРµ РѕР±РѕСЂРІС‘С‚СЃСЏ
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
  // Р‘РёС‚С‹Рµ РёР»Рё СѓСЃС‚Р°СЂРµРІС€РёРµ СЃРѕС…СЂР°РЅС‘РЅРЅС‹Рµ РґР°РЅРЅС‹Рµ С‡РёРЅРёРј СЃСЂР°Р·Сѓ
  if (JSON.stringify(layout) !== JSON.stringify(store.get(layoutKey(), null))) store.set(layoutKey(), layout);
  for (const item of layout.items) list.append(typeof item === 'number' ? hubItem(hubById(item)) : folderItem(item));
}

/** Р—РЅР°С‡РѕРє РёРґСѓС‰РµРіРѕ Р»РёС‡РЅРѕРіРѕ Р·РІРѕРЅРєР°: Р°РІР°С‚Р°СЂРєР° СЃРѕР±РµСЃРµРґРЅРёРєР° (РёР»Рё В«+NВ» РґР»СЏ РіСЂСѓРїРїС‹) Рё Р·РµР»С‘РЅР°СЏ РїСѓР»СЊСЃР°С†РёСЏ */
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
      { label: 'РћС‚РєСЂС‹С‚СЊ', onclick: () => openHub(hub.id) },
      hubUnread(hub.id) && { label: 'РћС‚РјРµС‚РёС‚СЊ РїСЂРѕС‡РёС‚Р°РЅРЅС‹Рј', onclick: () => markHubRead(hub.id) },
      'sep',
      ...hubMenuItems(hub),
    ]);
  };
  if (hubInVoice(hub.id)) item.insertAdjacentHTML('beforeend', `<span class="rail-voice" title="Р’С‹ РІ РіРѕР»РѕСЃРµ">${ICONS.volume}</span>`);
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
    // РЎРІС‘СЂРЅСѓС‚Р°СЏ РіСЂСѓРїРїР° вЂ” РјРѕР·Р°РёРєР° РёР· РїРµСЂРІС‹С… С‡РµС‚С‹СЂС‘С… РєР°РЅР°Р»РѕРІ
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
      { label: 'РќР°Р·РІР°РЅРёРµ Рё С†РІРµС‚вЂ¦', onclick: () => openFolderEdit(folder) },
      { label: folder.collapsed ? 'Р Р°Р·РІРµСЂРЅСѓС‚СЊ' : 'РЎРІРµСЂРЅСѓС‚СЊ', onclick: () => tile.click() },
      folder.hubs.some(hubUnread) && { label: 'РћС‚РјРµС‚РёС‚СЊ РїСЂРѕС‡РёС‚Р°РЅРЅС‹Рј', onclick: () => folder.hubs.forEach(markHubRead) },
      'sep',
      { label: 'Р Р°Р·РіСЂСѓРїРїРёСЂРѕРІР°С‚СЊ', onclick: () => saveLayout(ungroup(currentLayout(), folder.folder)) },
    ]);
  };
  box.append(head);
  if (!folder.collapsed) for (const hub of hubs) box.append(hubItem(hub));
  return box;
}

// РџСЂРёРіР»Р°С€РµРЅРёРµ вЂ” РєР°РЅР°Р» СЃ РїСѓРЅРєС‚РёСЂРЅРѕР№ СЂР°РјРєРѕР№ РІ РЅР°С‡Р°Р»Рµ СЃС‚РѕР»Р±С†Р°: С‰РµР»С‡РѕРє РѕС‚РєСЂС‹РІР°РµС‚ В«Р’СЃС‚СѓРїРёС‚СЊ / РћС‚РєР°Р·Р°С‚СЊСЃСЏВ»
function inviteItem(invite) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'rail-tile';
  tile.dataset.tip = `РџСЂРёРіР»Р°С€РµРЅРёРµ: ${invite.hub.name}`;
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

// ---------- РџРµСЂРµС‚Р°СЃРєРёРІР°РЅРёРµ: РїРѕСЂСЏРґРѕРє Рё РіСЂСѓРїРїС‹ ----------

const keyOf = (item) => (item.dataset.hub ? Number(item.dataset.hub) : item.dataset.folder);
const newFolderId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** РљСѓРґР° Р±СЂРѕСЃСЏС‚: РІ РІРµСЂС…РЅСЋСЋ С‚СЂРµС‚СЊ вЂ” РїРµСЂРµРґ СЌР»РµРјРµРЅС‚РѕРј, РЅР° СЃРµСЂРµРґРёРЅСѓ РєР°РЅР°Р»Р° вЂ” РІ РіСЂСѓРїРїСѓ СЃ РЅРёРј, РЅР° РіСЂСѓРїРїСѓ вЂ” РІРЅСѓС‚СЂСЊ.
 *  Р“СЂСѓРїРїСѓ РјРѕР¶РЅРѕ С‚РѕР»СЊРєРѕ РїРµСЂРµСЃС‚Р°РІРёС‚СЊ. РњРёРјРѕ СЌР»РµРјРµРЅС‚РѕРІ вЂ” РІ РєРѕРЅРµС† */
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

// ---------- РџРѕРґСЃРєР°Р·РєР° СЃ РЅР°Р·РІР°РЅРёРµРј Сѓ СЃС‚РѕР»Р±С†Р° ----------

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

// ---------- Р“СЂСѓРїРїР°: РЅР°Р·РІР°РЅРёРµ Рё С†РІРµС‚ ----------

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

// ---------- Р’СЃРїР»С‹РІР°СЋС‰РµРµ РјРµРЅСЋ ----------

/** items: { label, icon, onclick, danger } РёР»Рё 'sep'; РїСѓСЃС‚С‹Рµ (false) РїСЂРѕРїСѓСЃРєР°СЋС‚СЃСЏ */
function showMenu(x, y, items) {
  const menu = $('popup-menu');
  menu.replaceChildren();
  for (const item of items.filter(Boolean)) {
    if (item === 'sep') {
      if (menu.lastChild && !menu.lastChild.classList.contains('popup-sep')) menu.append(el('div', { className: 'popup-sep' }));
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

// ---------- РњРµРЅСЋ РєР°РЅР°Р»Р° ----------

// Р—РЅР°С‡РєРё РґР»СЏ РїСѓРЅРєС‚Р° РјРµРЅСЋ Рё РѕС‚РјРµС‚РєРё РІ С€Р°РїРєРµ
const BELL_ON = '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const BELL_OFF =
  '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-9.3-5.2M6 9v-1a6 6 0 0 0-.9 3c0 7-3 9-3 9h14"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M3 3l18 18"/></svg>';
// РљР°Р»РµРЅРґР°СЂСЊ СЃ РїР»СЋСЃРѕРј вЂ” СЃРѕР±С‹С‚РёРµ РєР°РЅР°Р»Р°
const EVENT_ICON =
  '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M12 14v5M9.5 16.5h5"/></svg>';

const hubMuteKey = (id) => `hub:mute:${id}`;
const hubMuted = (id) => Boolean(store.get(hubMuteKey(id), false));

/** Р’С‹РєР»СЋС‡РёС‚СЊ РёР»Рё РІРєР»СЋС‡РёС‚СЊ Р·РІСѓРє СѓРІРµРґРѕРјР»РµРЅРёР№ РєР°РЅР°Р»Р° (РІС‹Р±РѕСЂ С…СЂР°РЅРёС‚СЃСЏ РЅР° СЌС‚РѕРј СѓСЃС‚СЂРѕР№СЃС‚РІРµ) */
function toggleHubMute(hub) {
  const off = !hubMuted(hub.id);
  store.set(hubMuteKey(hub.id), off);
  toast(off ? `Р—РІСѓРє СѓРІРµРґРѕРјР»РµРЅРёР№ В«${hub.name}В» РІС‹РєР»СЋС‡РµРЅ` : `Р—РІСѓРє СѓРІРµРґРѕРјР»РµРЅРёР№ В«${hub.name}В» РІРєР»СЋС‡С‘РЅ`);
  renderHubChrome();
}

function hubMenuItems(hub) {
  const manager = canManageHub(hub);
  const muted = hubMuted(hub.id);
  return [
    manager && { label: 'РџСЂРёРіР»Р°СЃРёС‚СЊ РґСЂСѓР·РµР№', onclick: () => openHubInvite(hub.id) },
    manager && { label: 'РЎРѕР·РґР°С‚СЊ РєРѕРјРЅР°С‚Сѓ', onclick: () => openRoomCreate('voice', hub.id) },
    manager && { label: 'РЎРѕР·РґР°С‚СЊ СЃРѕР±С‹С‚РёРµ', icon: EVENT_ICON, onclick: () => openEventCreate(hub) },
    manager && { label: 'РЎРѕР·РґР°С‚СЊ РіСЂСѓРїРїСѓ РєРѕРјРЅР°С‚', onclick: () => createRoomGroup(hub) },
    { label: muted ? 'Р’РєР»СЋС‡РёС‚СЊ СѓРІРµРґРѕРјР»РµРЅРёСЏ' : 'Р’С‹РєР»СЋС‡РёС‚СЊ СѓРІРµРґРѕРјР»РµРЅРёСЏ', icon: muted ? BELL_OFF : BELL_ON, onclick: () => toggleHubMute(hub) },
    { label: manager ? 'РќР°СЃС‚СЂРѕР№РєРё РєР°РЅР°Р»Р°' : 'РЈС‡Р°СЃС‚РЅРёРєРё РєР°РЅР°Р»Р°', onclick: () => openHubSettings(hub.id, manager ? 'overview' : 'members') },
    'sep',
    hub.ownerId === state.me.id
      ? { label: 'РЈРґР°Р»РёС‚СЊ РєР°РЅР°Р»', danger: true, onclick: () => deleteHub(hub) }
      : { label: 'Р’С‹Р№С‚Рё РёР· РєР°РЅР°Р»Р°', danger: true, onclick: () => leaveHub(hub) },
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
  if (!(await ask(`РљР°РЅР°Р» В«${hub.name}В» СѓРґР°Р»РёС‚СЃСЏ РІРјРµСЃС‚Рµ СЃРѕ РІСЃРµРјРё РєРѕРјРЅР°С‚Р°РјРё Рё РїРµСЂРµРїРёСЃРєРѕР№. Р­С‚Рѕ РЅРµР»СЊР·СЏ РѕС‚РјРµРЅРёС‚СЊ.`, { title: 'РЈРґР°Р»РёС‚СЊ РєР°РЅР°Р»?', ok: 'РЈРґР°Р»РёС‚СЊ', danger: true }))) return;
  try {
    await Api.del(`/hubs/${hub.id}`);
    forgetHub(hub.id);
    toast(`РљР°РЅР°Р» В«${hub.name}В» СѓРґР°Р»С‘РЅ`);
  } catch (err) {
    toast(err.message);
  }
}

async function leaveHub(hub) {
  if (!(await ask(`Р’РµСЂРЅСѓС‚СЊСЃСЏ РІ В«${hub.name}В» РјРѕР¶РЅРѕ Р±СѓРґРµС‚ С‚РѕР»СЊРєРѕ РїРѕ РЅРѕРІРѕРјСѓ РїСЂРёРіР»Р°С€РµРЅРёСЋ.`, { title: 'Р’С‹Р№С‚Рё РёР· РєР°РЅР°Р»Р°?', ok: 'Р’С‹Р№С‚Рё', danger: true }))) return;
  try {
    await Api.del(`/hubs/${hub.id}/members/${state.me.id}`);
    forgetHub(hub.id);
  } catch (err) {
    toast(err.message);
  }
}

// ---------- РЈС‡Р°СЃС‚РЅРёРєРё СЃРїСЂР°РІР° ----------

const membersHidden = () => store.get('membersHidden', false);
// РЎРµР±СЏ РїРѕРєР°Р·С‹РІР°РµРј РїРѕ СЃРІРѕРµРјСѓ СЃС‚Р°С‚СѓСЃСѓ: РЅРµРІРёРґРёРјС‹Р№ РґР»СЏ СЃРµР±СЏ вЂ” В«РЅРµ РІ СЃРµС‚РёВ», РєР°Рє РµРіРѕ РІРёРґСЏС‚ РґСЂСѓРіРёРµ
const presenceIn = (m) => (m.id === state.me.id ? (myStatus() === 'invisible' ? 'offline' : myStatus()) : presenceOf(m));

function renderMembers() {
  const hub = currentHub();
  const show = Boolean(hub) && !membersHidden();
  $('members-panel').classList.toggle('hidden', !show);
  for (const b of document.querySelectorAll('.members-toggle')) {
    b.classList.toggle('on', show);
    b.title = show ? 'РЎРєСЂС‹С‚СЊ СѓС‡Р°СЃС‚РЅРёРєРѕРІ' : 'РџРѕРєР°Р·Р°С‚СЊ СѓС‡Р°СЃС‚РЅРёРєРѕРІ';
  }
  if (!show) return;

  // РћС‚РєСЂС‹С‚Р° РєРѕРјРЅР°С‚Р° вЂ” РµС‘ СѓС‡Р°СЃС‚РЅРёРєРё РїРѕ РµС‘ СЂРѕР»СЏРј; РёРЅР°С‡Рµ вЂ” РІРµСЃСЊ РєР°РЅР°Р»
  const room = roomById(state.selectedRoomId);
  const people = room ? room.members : hub.members;
  const inVoice = new Set((room?.voice || []).map((p) => p.userId));
  const byName = (a, b) => a.displayName.localeCompare(b.displayName, 'ru');
  const groups = (room?.roles || []).map((r) => ({ role: r, title: r.name, people: [] }));
  const online = { title: 'Р’ СЃРµС‚Рё', people: [] };
  const offline = { title: 'РќРµ РІ СЃРµС‚Рё', people: [], offline: true };
  for (const m of people) {
    if (presenceIn(m) === 'offline') offline.people.push(m);
    else (groups.find((g) => g.role.id === roleOf(room, m.id)?.id) || online).people.push(m);
  }

  const box = $('members-list');
  box.replaceChildren();
  box.append(
    el('div', { className: 'members-head' },
      el('b', { textContent: 'РЈС‡Р°СЃС‚РЅРёРєРё' }),
      el('span', { className: 'muted small ellipsis', textContent: room ? `В· ${room.name}` : `В· РІРµСЃСЊ РєР°РЅР°Р»` }))
  );
  for (const g of [...groups, online, offline]) {
    if (!g.people.length) continue;
    const groupTitle = `${g.title} вЂ” ${g.people.length}`;
    box.append(el('div', { className: 'members-group', textContent: groupTitle, title: groupTitle }));
    for (const m of g.people.sort(byName)) {
      const hubMember = hub.members.find((x) => x.id === m.id);
      const name = el('div', { className: 'member-nick ellipsis', textContent: m.nickname || m.displayName });
      if (g.role || m.nameColor) name.style.color = g.role?.color || m.nameColor;
      const sub = inVoice.has(m.id) ? 'Р’ РіРѕР»РѕСЃРµ'
        : m.id === hub.ownerId ? 'РЎРѕР·РґР°С‚РµР»СЊ РєР°РЅР°Р»Р°'
        : hubMember?.manager ? 'РЈРїСЂР°РІР»СЏРµС‚ РєР°РЅР°Р»РѕРј'
        : presenceIn(m) === 'idle' || presenceIn(m) === 'dnd' ? STATUS[presenceIn(m)].label : '';
      const row = el('div', { className: `member-item${g.offline ? ' offline' : ''}` },
        makeAvatar(m, presenceIn(m), 'small'),
        el('div', { className: 'member-text' }, name, sub && el('div', { className: 'muted small ellipsis', textContent: sub })));
      if (m.id === hub.ownerId)
        row.insertAdjacentHTML('beforeend', '<svg class="crown" viewBox="0 0 24 24"><title>РЎРѕР·РґР°С‚РµР»СЊ РєР°РЅР°Р»Р°</title><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>');
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

// ---------- РЎРѕР·РґР°С‚СЊ РєР°РЅР°Р» ----------

let newHubColor = COLORS[0];

function openHubCreate() {
  newHubColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  $('hub-name').value = '';
  $('hub-name').placeholder = `РљР°РЅР°Р» ${state.me.displayName}`.slice(0, 40);
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
    // РљРѕРјРЅР°С‚С‹ РЅРѕРІРѕРіРѕ РєР°РЅР°Р»Р° РїСЂРёС…РѕРґСЏС‚ РѕС‚РґРµР»СЊРЅРѕ вЂ” РґРѕР¶РґС‘РјСЃСЏ РёС…, С‡С‚РѕР±С‹ СЃСЂР°Р·Сѓ РѕС‚РєСЂС‹С‚СЊ
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

// ---------- РќР°СЃС‚СЂРѕР№РєРё РєР°РЅР°Р»Р° ----------

let settingsHubId = null;
const HUB_MEMBER_TABS = ['members', 'emojis']; // С‡С‚Рѕ РІРёРґРЅРѕ СѓС‡Р°СЃС‚РЅРёРєСѓ Р±РµР· СѓРїСЂР°РІР»РµРЅРёСЏ РєР°РЅР°Р»РѕРј
let settingsTab = 'overview';
let hubMemberQuery = '';
const HUB_TABS = { overview: 'РћР±Р·РѕСЂ', events: 'РЎРѕР±С‹С‚РёСЏ', roles: 'Р РѕР»Рё Рё РїСЂР°РІР°', emojis: 'РЎРјР°Р№Р»РёРєРё', members: 'РЈС‡Р°СЃС‚РЅРёРєРё', bans: 'Р‘Р°РЅС‹' };

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
  $('hs-leave').textContent = hub.ownerId === state.me.id ? 'РЈРґР°Р»РёС‚СЊ РєР°РЅР°Р»' : 'Р’С‹Р№С‚Рё РёР· РєР°РЅР°Р»Р°';

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
          smallButton('Р—Р°РіСЂСѓР·РёС‚СЊ РєР°СЂС‚РёРЅРєСѓ', 'primary', () => $('hub-icon-input').click()),
          hub.iconUrl && smallButton('РЈР±СЂР°С‚СЊ', '', () => hubAction(Api.del(`/hubs/${hub.id}/icon`), 'РљР°СЂС‚РёРЅРєР° СѓР±СЂР°РЅР°'))),
        el('p', { className: 'muted small', textContent: 'Р—Р°РіСЂСѓР·РёС‚Рµ РєР°СЂС‚РёРЅРєСѓ, С‡С‚РѕР±С‹ РєР°РЅР°Р» РѕС‚Р»РёС‡Р°Р»СЃСЏ РЅРµ С‚РѕР»СЊРєРѕ РЅР°Р·РІР°РЅРёРµРј.' }))),
    el('label', { className: 'field' }, el('span', { textContent: 'РќР°Р·РІР°РЅРёРµ' }), name),
    el('div', { className: 'field' }, el('span', { textContent: 'Р¦РІРµС‚' }), colors),
    el('label', { className: 'check' }, reactionsBox, el('span', { textContent: 'РџРѕРєР°Р·С‹РІР°С‚СЊ, РєС‚Рѕ РїРѕСЃС‚Р°РІРёР» СЂРµР°РєС†РёСЋ' })),
    el('div', { className: 'row' }, el('div', { className: 'spacer' }), el('button', { className: 'btn primary', textContent: 'РЎРѕС…СЂР°РЅРёС‚СЊ' })));
  form.onsubmit = (e) => {
    e.preventDefault();
    hubAction(Api.patch(`/hubs/${hub.id}`, { name: name.value.trim(), iconColor: color, reactionsVisible: reactionsBox.checked }), 'РЎРѕС…СЂР°РЅРµРЅРѕ');
  };
  const owner = hub.members.find((m) => m.id === hub.ownerId);
  const facts = el('div', { className: 'rs-facts' },
    el('div', {}, el('span', { className: 'muted small', textContent: 'РЎРѕР·РґР°С‚РµР»СЊ' }), el('b', { textContent: owner?.displayName || 'вЂ”' })),
    el('div', {}, el('span', { className: 'muted small', textContent: 'РЈС‡Р°СЃС‚РЅРёРєРѕРІ' }), el('b', { textContent: hub.members.length })),
    el('div', {}, el('span', { className: 'muted small', textContent: 'РљРѕРјРЅР°С‚' }), el('b', { textContent: roomsOfHub(hub.id).length })),
    el('div', {}, el('span', { className: 'muted small', textContent: 'РЎРѕР·РґР°РЅ' }), el('b', { textContent: formatDay(hub.createdAt) })));
  return [form, facts];
}

let emojiDraftName = '';

/** РЎРјР°Р№Р»РёРєРё РєР°РЅР°Р»Р°: РґРѕР±Р°РІР»СЏРµС‚ Р»СЋР±РѕР№ СѓС‡Р°СЃС‚РЅРёРє, СѓРґР°Р»СЏРµС‚ Р°РІС‚РѕСЂ РёР»Рё СѓРїСЂР°РІР»СЏСЋС‰РёР№ */
function hubEmojisPane(hub) {
  const name = el('input', { id: 'hs-emoji-name', placeholder: 'РРјСЏ, РЅР°РїСЂРёРјРµСЂ РєРѕС‚', maxLength: 24, value: emojiDraftName });
  name.dataset.keep = 'emoji-name';
  name.oninput = () => (emojiDraftName = name.value);
  const add = el('div', { className: 'rs-row' }, name, smallButton('Р’С‹Р±СЂР°С‚СЊ РєР°СЂС‚РёРЅРєСѓ', 'primary', () => {
    if (!name.value.trim()) return ($('hs-error').textContent = 'РЎРЅР°С‡Р°Р»Р° РїСЂРёРґСѓРјР°Р№С‚Рµ РёРјСЏ');
    $('hub-emoji-input').click();
  }));
  const hint = el('p', { className: 'muted small', textContent: `Р’ СЃРѕРѕР±С‰РµРЅРёСЏС… РєРѕРјРЅР°С‚ СЌС‚РѕРіРѕ РєР°РЅР°Р»Р°: :РёРјСЏ:. Р‘СѓРєРІС‹, С†РёС„СЂС‹ Рё _, РґРѕ 50 СЃРјР°Р№Р»РёРєРѕРІ РЅР° РєР°РЅР°Р». РЎРµР№С‡Р°СЃ: ${hub.emojis.length}.` });
  const list = el('div', { className: 'hs-emojis' });
  for (const e of hub.emojis) {
    const row = el('div', { className: 'hs-emoji' },
      el('img', { src: `${Api.base}${e.url}`, alt: e.name }),
      el('b', { className: 'grow ellipsis', textContent: `:${e.name}:` }),
      (e.createdBy === state.me.id || canManageHub(hub)) &&
        smallButton('РЈРґР°Р»РёС‚СЊ', '', () => hubAction(Api.del(`/hubs/${hub.id}/emojis/${e.id}`), 'РЎРјР°Р№Р»РёРє СѓРґР°Р»С‘РЅ')));
    list.append(row);
  }
  return [add, hint, list];
}

/** РљР°СЂС‚РёРЅРєР° СЃРјР°Р№Р»РёРєР°: РІРїРёСЃС‹РІР°РµРј РІ РєРІР°РґСЂР°С‚ 128Г—128, РїСЂРѕР·СЂР°С‡РЅРѕСЃС‚СЊ СЃРѕС…СЂР°РЅСЏРµРј */
async function emojiBlob(file) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('РќРµ РїРѕР»СѓС‡РёР»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РєР°СЂС‚РёРЅРєСѓ');
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
    await hubAction(Api.upload('PUT', `/hubs/${settingsHubId}/emojis/${name}`, blob), 'РЎРјР°Р№Р»РёРє РґРѕР±Р°РІР»РµРЅ');
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

// ---------- РЎРѕР±С‹С‚РёСЏ РєР°РЅР°Р»Р° ----------

let eventHubId = null;

/** Р’СЃРµ СЃРѕР±С‹С‚РёСЏ РєР°РЅР°Р»Р°: Р»РµР¶Р°С‚ РІ РєРѕРјРЅР°С‚Р°С…, РєСѓРґР° РёС… РѕРїСѓР±Р»РёРєРѕРІР°Р»Рё */
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
        'РЎРѕР±С‹С‚РёРµ РїРѕСЏРІРёС‚СЃСЏ РІ РІС‹Р±СЂР°РЅРЅРѕРј С‡Р°С‚Рµ: СѓС‡Р°СЃС‚РЅРёРєРё РѕС‚РјРµС‚СЏС‚ РіРѕС‚РѕРІРЅРѕСЃС‚СЊ вЂ” В«Р±СѓРґСѓВ», В«РЅРµ СЃРјРѕРіСѓВ» РёР»Рё В«РіРѕС‚РѕРІ РІ РґСЂСѓРіРѕРµ РІСЂРµРјСЏВ».',
    })
  );
  const create = el('button', { className: 'btn primary', type: 'button', textContent: 'РЎРѕР·РґР°С‚СЊ СЃРѕР±С‹С‚РёРµ' });
  create.onclick = () => openEventCreate(hub);
  box.append(el('div', { className: 'row' }, create));

  const list = hubEvents(hub);
  if (!list.length) {
    box.append(el('p', { className: 'muted small', textContent: 'РџРѕРєР° СЃРѕР±С‹С‚РёР№ РЅРµС‚' }));
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
          textContent: `${formatDay(ev.startsAt)} В· ${formatTime(ev.startsAt)} В· #${room.name}`,
        })
      ),
      el('span', { className: 'muted small', textContent: `Р‘СѓРґСѓС‚: ${going}` })
    );
    const del = el('button', { className: 'btn small', type: 'button', textContent: 'РЈРґР°Р»РёС‚СЊ' });
    del.onclick = () => hubAction(Api.del(`/events/${ev.id}`), 'РЎРѕР±С‹С‚РёРµ СѓРґР°Р»РµРЅРѕ');
    row.append(del);
    box.append(row);
  }
  return [box];
}

// Р’С‹Р±СЂР°РЅРЅРѕРµ РІ РѕРєРЅРµ СЃРѕР±С‹С‚РёСЏ: РґРµРЅСЊ, РІСЂРµРјСЏ Рё С‡Р°С‚
let eventDraft = { date: null, time: '00:00', roomId: null, repeat: 'none', remind: 0 };
const pad2 = (n) => String(n).padStart(2, '0');

const EVENT_REPEATS = [
  ['none', 'РћРґРЅРѕРєСЂР°С‚РЅРѕ'],
  ['daily', 'РљР°Р¶РґС‹Р№ РґРµРЅСЊ'],
  ['weekdays', 'РџРѕ Р±СѓРґРЅСЏРј'],
  ['weekly', 'РљР°Р¶РґСѓСЋ РЅРµРґРµР»СЋ РІ СЌС‚РѕС‚ РґРµРЅСЊ'],
];
const EVENT_REMIND = [
  [0, 'Р‘РµР· РЅР°РїРѕРјРёРЅР°РЅРёСЏ'],
  [5, 'Р—Р° 5 РјРёРЅСѓС‚'],
  [10, 'Р—Р° 10 РјРёРЅСѓС‚'],
  [15, 'Р—Р° 15 РјРёРЅСѓС‚'],
  [30, 'Р—Р° 30 РјРёРЅСѓС‚'],
  [60, 'Р—Р° С‡Р°СЃ'],
];

function syncEventPickers() {
  $('event-date').value = eventDraft.date ? eventDraft.date.toLocaleDateString('ru-RU') : '';
  $('event-time').value = eventDraft.time;
  const room = roomById(eventDraft.roomId);
  $('event-room').textContent = room ? `# ${room.name}` : 'Р’С‹Р±РµСЂРёС‚Рµ С‡Р°С‚';
  $('event-repeat').textContent = EVENT_REPEATS.find(([id]) => id === eventDraft.repeat)?.[1] || 'РћРґРЅРѕРєСЂР°С‚РЅРѕ';
  $('event-remind').textContent = EVENT_REMIND.find(([id]) => id === eventDraft.remind)?.[1] || 'Р‘РµР· РЅР°РїРѕРјРёРЅР°РЅРёСЏ';
}

/** Р”Р°С‚Р°, РІРїРёСЃР°РЅРЅР°СЏ СЂСѓРєР°РјРё: 12.11.2026, 12.11 РёР»Рё 12.11.26 */
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

/** Р’СЂРµРјСЏ, РІРїРёСЃР°РЅРЅРѕРµ СЂСѓРєР°РјРё: 21:30, 21.30, 2130 РёР»Рё РїСЂРѕСЃС‚Рѕ 21 в†’ 21:00 */
function parseTimeText(text) {
  const raw = String(text).trim();
  const m = raw.match(/^(\d{1,2})\s*[:.,\s]\s*(\d{2})$/) || raw.match(/^(\d{1,2})(\d{2})$/);
  const single = raw.match(/^(\d{1,2})$/);
  const h = single ? Number(single[1]) : m ? Number(m[1]) : NaN;
  const min = single ? 0 : m ? Number(m[2]) : NaN;
  if (!Number.isInteger(h) || !Number.isInteger(min) || h > 23 || min > 59) return null;
  return `${pad2(h)}:${pad2(min)}`;
}

// Р’РїРёСЃР°Р» СЂСѓРєР°РјРё вЂ” СЃСЂР°Р·Сѓ РїРѕРґС…РІР°С‚С‹РІР°РµРј
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

// РљР°Р»РµРЅРґР°СЂСЊ РІ СЃС‚РёР»Рµ РїСЂРёР»РѕР¶РµРЅРёСЏ
function buildEventCalendar() {
  const pop = $('event-date-pop');
  const start = eventDraft.date ? new Date(eventDraft.date) : new Date();
  let view = new Date(start.getFullYear(), start.getMonth(), 1);

  const draw = () => {
    const head = el('div', { className: 'cal-head' });
    const prev = el('button', { type: 'button', className: 'cal-nav', textContent: 'вЂ№' });
    const next = el('button', { type: 'button', className: 'cal-nav', textContent: 'вЂє' });
    const title = el('b', { textContent: view.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) });
    head.append(prev, title, next);

    const grid = el('div', { className: 'cal-grid' });
    for (const w of ['РџРЅ', 'Р’С‚', 'РЎСЂ', 'Р§С‚', 'РџС‚', 'РЎР±', 'Р’СЃ']) grid.append(el('span', { className: 'cal-dow', textContent: w }));
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
    const today = el('button', { type: 'button', className: 'btn small', textContent: 'РЎРµРіРѕРґРЅСЏ' });
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

// Р’СЂРµРјСЏ: С‡Р°СЃС‹ Рё РјРёРЅСѓС‚С‹ СЃРµС‚РєРѕР№, РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ вЂ” В«РћРљВ»
/** РљРѕР»С‘СЃР°-Р±Р°СЂР°Р±Р°РЅС‹: С‡Р°СЃС‹ Рё РјРёРЅСѓС‚С‹ РїСЂРѕРєСЂСѓС‡РёРІР°СЋС‚СЃСЏ Рё В«РїСЂРёР»РёРїР°СЋС‚В» Рє РІС‹Р±СЂР°РЅРЅРѕРјСѓ Р·РЅР°С‡РµРЅРёСЋ */
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
    makeColumn(mins, () => m, (v) => (m = v))
  );
  container.replaceChildren(wrap);

  for (const { col, getValue } of columns) {
    centerColumn(col, getValue());
    let timer = null;
    col.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Р‘Р»РёР¶Р°Р№С€РµРµ Рє С†РµРЅС‚СЂСѓ Р·РЅР°С‡РµРЅРёРµ вЂ” РІС‹Р±СЂР°РЅРЅРѕРµ
        const center = col.scrollTop + col.clientHeight / 2;
        let best = col.children[0];
        for (const c of col.children) {
          if (Math.abs(c.offsetTop + c.offsetHeight / 2 - center) < Math.abs(best.offsetTop + best.offsetHeight / 2 - center)) best = c;
        }
        const value = Number(best.dataset.value);
        [...col.children].forEach((c) => c.classList.toggle('selected', c === best));
        if (col === columns[0]?.col) h = value;
        else m = value;
        onChange(h, m);
      }, 120);
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
  const ok = el('button', { type: 'button', className: 'btn small primary', textContent: 'РћРљ' });
  ok.onclick = () => pop.classList.add('hidden');
  foot.append(ok);
  pop.replaceChildren(body, foot);
}

// РЎРїРёСЃРѕРє С‡Р°С‚РѕРІ РєР°РЅР°Р»Р°
// РЎРїРёСЃРѕРє РІР°СЂРёР°РЅС‚РѕРІ: РїРѕРІС‚РѕСЂ Рё РЅР°РїРѕРјРёРЅР°РЅРёРµ
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

// РЎРїРёСЃРѕРє С‡Р°С‚РѕРІ РєР°РЅР°Р»Р°
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

function openEventCreate(hub) {
  eventHubId = hub.id;
  $('event-title').value = '';
  $('event-error').textContent = '';

  // РџРѕ СѓРјРѕР»С‡Р°РЅРёСЋ вЂ” СЃРµРіРѕРґРЅСЏ, С‡РµСЂРµР· С‡Р°СЃ
  const soon = new Date(Date.now() + 60 * 60_000);
  soon.setMinutes(0, 0, 0);
  const rooms = roomsOfHub(hub.id);
  const current = rooms.find((r) => r.id === state.selectedRoomId) || rooms.find((r) => r.kind === 'text') || rooms[0];
  eventDraft = { date: soon, time: `${pad2(soon.getHours())}:00`, roomId: current?.id ?? null, repeat: 'none', remind: 0 };
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
  const updateToggle = () => {
    const chosen = list.querySelectorAll('input:checked').length;
    toggle.textContent = chosen ? `Р’С‹Р±СЂР°РЅРѕ: ${chosen}` : 'РќРёРєС‚Рѕ РЅРµ РІС‹Р±СЂР°РЅ';
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

// Р’С‹РїР°РґР°СЋС‰РёРµ СЃРїРёСЃРєРё РІ СЃС‚РёР»Рµ РїСЂРёР»РѕР¶РµРЅРёСЏ: РѕС‚РєСЂС‹РІР°РµРј РЅСѓР¶РЅС‹Р№, РѕСЃС‚Р°Р»СЊРЅС‹Рµ РїСЂСЏС‡РµРј
function togglePicker(toggleId, popId, build) {
  const pop = $(popId);
  const opening = pop.classList.contains('hidden');
  for (const other of document.querySelectorAll('#event-create .picker-pop')) other.classList.add('hidden');
  if (!opening) return;
  build();
  pop.classList.remove('hidden', 'up');
  $(toggleId).classList.add('open');
  // РќРµ РІР»РµР·Р°РµС‚ РІРЅРёР· вЂ” СЂР°СЃРєСЂС‹РІР°РµРј РІРІРµСЂС…
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
$('event-create').onclick = (e) => {
  if (e.target === $('event-create')) closeEventCreate();
};

$('event-form').onsubmit = async (e) => {
  e.preventDefault();
  const hub = hubById(eventHubId);
  if (!hub) return;
  const title = $('event-title').value.trim();
  if (!title) return ($('event-error').textContent = 'РќР°Р·РІР°РЅРёРµ СЃРѕР±С‹С‚РёСЏ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ');
  // Р‘РµСЂС‘Рј С‚Рѕ, С‡С‚Рѕ РІРїРёСЃР°РЅРѕ СЂСѓРєР°РјРё, РёРЅР°С‡Рµ вЂ” РІС‹Р±СЂР°РЅРЅРѕРµ РІ РєР°Р»РµРЅРґР°СЂРµ
  const date = parseDateText($('event-date').value) || eventDraft.date;
  const time = parseTimeText($('event-time').value) || eventDraft.time;
  if (!date) return ($('event-error').textContent = 'Р”РµРЅСЊ: РЅР°РїСЂРёРјРµСЂ, 12.11.2026');
  if (!time) return ($('event-error').textContent = 'Р’СЂРµРјСЏ: РЅР°РїСЂРёРјРµСЂ, 21:30');
  if (!eventDraft.roomId) return ($('event-error').textContent = 'Р’С‹Р±РµСЂРёС‚Рµ С‡Р°С‚ РґР»СЏ РїСѓР±Р»РёРєР°С†РёРё');
  const [hours, minutes] = time.split(':').map(Number);
  const startsAt = new Date(date);
  startsAt.setHours(hours, minutes, 0, 0);
  if (!Number.isFinite(startsAt.getTime())) return ($('event-error').textContent = 'РќРµ РїРѕР»СѓС‡РёР»РѕСЃСЊ СЂР°Р·РѕР±СЂР°С‚СЊ РґР°С‚Сѓ');

  const roomId = eventDraft.roomId;
  const invitees = [...$('event-invitees').querySelectorAll('input:checked')].map((i) => Number(i.value));
  try {
    const room = await Api.post(`/rooms/${roomId}/events`, {
      title,
      startsAt: startsAt.getTime(),
      invitees,
      repeat: eventDraft.repeat,
      remind: eventDraft.remind,
    });
    // РљРѕРјРЅР°С‚Р° РїСЂРёС€Р»Р° СѓР¶Рµ СЃ СЃРѕР±С‹С‚РёРµРј вЂ” РѕР±РЅРѕРІР»СЏРµРј РµС‘ Сѓ СЃРµР±СЏ, РёРЅР°С‡Рµ РєР°СЂС‚РѕС‡РєР° РЅРµ РЅР°Р№РґС‘С‚ СЃРѕР±С‹С‚РёРµ
    applyRoomUpdate(room);
    // РџСѓР±Р»РёРєСѓРµРј СЃРѕР±С‹С‚РёРµ СЃРѕРѕР±С‰РµРЅРёРµРј РІ РІС‹Р±СЂР°РЅРЅС‹Р№ С‡Р°С‚: РІРЅСѓС‚СЂРё РєРѕРЅРІРµСЂС‚Р° С‚РѕР»СЊРєРѕ id
    const event = [...(room.events || [])].reverse().find((x) => x.createdBy === state.me.id && x.title === title);
    if (event) {
      const { body, plain } = await encryptOutgoing(roomConvOf(roomId), { text: `РЎРѕР±С‹С‚РёРµ: ${title}`, eventId: event.id });
      addRoomMessage({ ...(await Api.post(`/rooms/${roomId}/messages`, body)), plain });
    }
    closeEventCreate();
    renderHubSettings();
    toast('РЎРѕР±С‹С‚РёРµ СЃРѕР·РґР°РЅРѕ');
    if (state.selectedRoomId !== roomId) selectRoom(roomId);
  } catch (err) {
    $('event-error').textContent = err.message;
  }
};

function hubMembersPane(hub) {
  const out = [];
  const search = el('input', { className: 'friend-search', placeholder: 'РџРѕРёСЃРє СѓС‡Р°СЃС‚РЅРёРєРѕРІ', value: hubMemberQuery });
  search.dataset.keep = 'hub-member-search';
  search.oninput = () => {
    hubMemberQuery = search.value;
    renderHubSettings();
  };
  const top = el('div', { className: 'rs-row' }, search);
  if (canManageHub(hub)) top.append(smallButton('РџСЂРёРіР»Р°СЃРёС‚СЊ РґСЂСѓР·РµР№', 'primary', () => openHubInvite(hub.id)));
  out.push(top);

  const q = hubMemberQuery.trim().toLowerCase();
  const members = hub.members.filter((m) => !q || `${m.displayName} ${m.username}`.toLowerCase().includes(q));
  out.push(el('div', { className: 'list-title', textContent: `РЈС‡Р°СЃС‚РЅРёРєРё вЂ” ${members.length}` }));
  const list = el('div', { className: 'member-list', id: 'hs-members' });
  const myRank = hubRank(hub);
  for (const m of members) {
    const mine = m.id === state.me.id;
    const tags = el('div', { className: 'member-tags' }, el('span', { className: 'muted small', textContent: `@${m.username}` }));
    if (m.id === hub.ownerId) tags.append(el('span', { className: 'tag owner', textContent: 'РЎРѕР·РґР°С‚РµР»СЊ' }));
    else if (m.manager) tags.append(el('span', { className: 'tag', textContent: 'РЈРїСЂР°РІР»СЏРµС‚' }));
    const role = hub.roles?.find((x) => x.id === m.roleId);
    if (role) tags.append(el('span', { className: 'tag', textContent: role.name }));
    const info = el('div', { className: 'grow member-info' },
      el('div', { className: 'ellipsis member-name', textContent: mine ? `${m.displayName} (РІС‹)` : m.displayName }), tags);
    info.dataset.profile = m.id;
    const avatar = makeAvatar(m, presenceIn(m));
    avatar.dataset.profile = m.id;
    const actions = el('div', { className: 'member-actions' });
    // Р РѕР»СЊ РЅР° РІРµСЃСЊ РєР°РЅР°Р» РЅР°Р·РЅР°С‡Р°РµС‚ С‚РѕС‚, РєС‚Рѕ РЅР°СЃС‚СЂР°РёРІР°РµС‚ СЂРѕР»Рё, Рё С‚РѕР»СЊРєРѕ С‚РµРј, РєС‚Рѕ РјР»Р°РґС€Рµ (СЃРµР±Рµ вЂ” С‚РѕР¶Рµ РјРѕР¶РЅРѕ)
    if (myRank >= 2 && m.id !== hub.ownerId && (mine || myRank > hubRank(hub, m.id))) {
      const select = el('select', { className: 'role-select', title: 'Р РѕР»СЊ РІ РєР°РЅР°Р»Рµ' }, new Option('Р‘РµР· СЂРѕР»Рё', ''));
      for (const r of hub.roles || []) {
        const opt = new Option(r.name, r.id);
        opt.disabled = Boolean(r.perms & PERMS.admin) && hub.ownerId !== state.me.id;
        select.add(opt);
      }
      select.value = m.roleId ?? '';
      select.onchange = () => setHubRole(hub, m.id, select.value ? Number(select.value) : null);
      actions.append(select);
    }
    // РџСЂР°РІРѕ СѓРїСЂР°РІР»СЏС‚СЊ СЂР°Р·РґР°С‘С‚ СЃРѕР·РґР°С‚РµР»СЊ; РІС‹РіРЅР°С‚СЊ Рё Р·Р°Р±Р°РЅРёС‚СЊ вЂ” С‚РѕР»СЊРєРѕ С‚РµС…, РєС‚Рѕ РјР»Р°РґС€Рµ
    if (hub.ownerId === state.me.id && !mine) {
      const sw = el('input', { type: 'checkbox', className: 'switch', checked: Boolean(m.manager), title: 'РњРѕР¶РµС‚ СѓРїСЂР°РІР»СЏС‚СЊ РєР°РЅР°Р»РѕРј' });
      sw.onchange = () => hubAction(Api.put(`/hubs/${hub.id}/members/${m.id}/manager`, { manager: sw.checked }));
      actions.append(el('label', { className: 'manager-switch' }, el('span', { className: 'small', textContent: 'РЈРїСЂР°РІР»СЏРµС‚' }), sw));
    }
    if (!mine && myRank >= 2 && myRank > hubRank(hub, m.id)) {
      actions.append(
        smallButton('Р’С‹РіРЅР°С‚СЊ', 'warn-outline', async () => {
          if (await ask(`РџСЂРёРіР»Р°СЃРёС‚СЊ ${m.displayName} СЃРЅРѕРІР° РјРѕР¶РЅРѕ Р±СѓРґРµС‚ РІ Р»СЋР±РѕР№ РјРѕРјРµРЅС‚.`, { title: 'Р’С‹РіРЅР°С‚СЊ РёР· РєР°РЅР°Р»Р°?', ok: 'Р’С‹РіРЅР°С‚СЊ', danger: true }))
            hubAction(Api.del(`/hubs/${hub.id}/members/${m.id}`), `${m.displayName} Р±РѕР»СЊС€Рµ РЅРµ РІ РєР°РЅР°Р»Рµ`);
        }),
        smallButton('Р—Р°Р±Р°РЅРёС‚СЊ', 'danger', async () => {
          if (await ask(`${m.displayName} РїСЂРѕРїР°РґС‘С‚ РёР· РєР°РЅР°Р»Р° Рё РІСЃРµС… РµРіРѕ РєРѕРјРЅР°С‚, РїРѕР·РІР°С‚СЊ РµРіРѕ Р±СѓРґРµС‚ РЅРµР»СЊР·СЏ, РїРѕРєР° РЅРµ СЃРЅРёРјРµС‚Рµ Р±Р°РЅ.`, { title: 'Р—Р°Р±Р°РЅРёС‚СЊ?', ok: 'Р—Р°Р±Р°РЅРёС‚СЊ', danger: true }))
            hubAction(Api.post(`/hubs/${hub.id}/bans`, { userId: m.id }), `${m.displayName} Р·Р°Р±Р°РЅРµРЅ`);
        })
      );
    }
    list.append(el('div', { className: 'member-row' }, avatar, info, actions));
  }
  out.push(list);
  return out;
}

function hubBansPane(hub) {
  if (!hub.bans.length) return [el('p', { className: 'muted', textContent: 'Р‘Р°РЅРѕРІ РЅРµС‚. Р—Р°Р±Р°РЅРµРЅРЅС‹Р№ РїСЂРѕРїР°РґР°РµС‚ РёР· РєР°РЅР°Р»Р° Рё РІСЃРµС… РµРіРѕ РєРѕРјРЅР°С‚, Рё РїРѕР·РІР°С‚СЊ РµРіРѕ РЅРµР»СЊР·СЏ, РїРѕРєР° Р±Р°РЅ РЅРµ СЃРЅРёРјСѓС‚.' })];
  const list = el('div', { className: 'member-list' });
  for (const b of hub.bans)
    list.append(el('div', { className: 'member-row' }, makeAvatar(b, undefined, 'small'),
      el('div', { className: 'grow ellipsis' }, el('div', { className: 'ellipsis', textContent: b.displayName }), el('div', { className: 'muted small', textContent: `@${b.username} В· СЃ ${formatDay(b.bannedAt)}` })),
      smallButton('РЎРЅСЏС‚СЊ Р±Р°РЅ', '', () => hubAction(Api.del(`/hubs/${hub.id}/bans/${b.id}`), `Р‘Р°РЅ СЃРЅСЏС‚: ${b.displayName}`))));
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
    const blob = await makeAvatarBlob(file, { title: 'РљР°СЂС‚РёРЅРєР° РєР°РЅР°Р»Р°', round: false });
    if (blob) await hubAction(Api.upload('PUT', `/hubs/${settingsHubId}/icon`, blob), 'РљР°СЂС‚РёРЅРєР° РєР°РЅР°Р»Р° РѕР±РЅРѕРІР»РµРЅР°');
  } catch (err) {
    $('hs-error').textContent = err.message;
  }
};

// ---------- РРјСЏ СѓС‡Р°СЃС‚РЅРёРєР° РІ РєР°РЅР°Р»Рµ ----------

let nickTarget = null; // { hubId, userId }

/** РЎРІРѕС‘ РёРјСЏ С‡РµР»РѕРІРµРєР° РІ С‚РµРєСѓС‰РµРј РєР°РЅР°Р»Рµ (РёР»Рё null, РµСЃР»Рё РµРіРѕ С‚Р°Рј РЅРµ РїРµСЂРµРёРјРµРЅРѕРІС‹РІР°Р»Рё) */
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
    $('nick-error').textContent = 'РРјСЏ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј';
    return;
  }
  try {
    applyHub(await Api.put(`/hubs/${nickTarget.hubId}/members/${nickTarget.userId}/nickname`, { name }));
    closeNicknameDialog();
    toast('РРјСЏ РІ РєР°РЅР°Р»Рµ РёР·РјРµРЅРµРЅРѕ');
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
    toast('Р’РµСЂРЅСѓР»Рё РЅР°СЃС‚РѕСЏС‰РµРµ РёРјСЏ');
    renderMembers();
  } catch (err) {
    $('nick-error').textContent = err.message;
  }
};

$('nick-cancel').onclick = closeNicknameDialog;
$('nick-modal').onclick = (e) => {
  if (e.target === $('nick-modal')) closeNicknameDialog();
};

// ---------- РџСЂРёРіР»Р°СЃРёС‚СЊ РґСЂСѓР·РµР№ РІ РєР°РЅР°Р» ----------

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
  $('hi-title').textContent = `РџСЂРёРіР»Р°СЃРёС‚СЊ РґСЂСѓР·РµР№ РІ В«${hub.name}В»`;
  const q = $('hi-search').value.trim().toLowerCase();
  const inHub = new Set(hub.members.map((m) => m.id));
  const invited = new Set(hub.invited);
  const banned = new Set(hub.bans.map((b) => b.id));
  const friends = [...state.contacts.values()]
    .filter((c) => !q || `${c.displayName} ${c.username}`.toLowerCase().includes(q))
    .sort((a, b) => inHub.has(a.id) - inHub.has(b.id) || a.displayName.localeCompare(b.displayName, 'ru'));
  const list = $('hi-list');
  list.replaceChildren();
  if (!state.contacts.size) list.append(el('p', { className: 'muted', textContent: 'РџСЂРёРіР»Р°СЃРёС‚СЊ РјРѕР¶РЅРѕ С‚РѕР»СЊРєРѕ РґСЂСѓР·РµР№, Р° РёС… РїРѕРєР° РЅРµС‚. Р”РѕР±Р°РІСЊС‚Рµ РёС… РІ СЂР°Р·РґРµР»Рµ В«Р”СЂСѓР·СЊСЏВ».' }));
  else if (!friends.length) list.append(el('p', { className: 'muted', textContent: 'РќРёРєРѕРіРѕ РЅРµ РЅР°С€Р»Рё' }));
  for (const f of friends) {
    const info = el('div', { className: 'grow ellipsis' }, el('div', { className: 'ellipsis', textContent: f.displayName }), el('div', { className: 'muted small', textContent: `@${f.username}` }));
    let action;
    if (inHub.has(f.id)) action = el('span', { className: 'muted small', textContent: 'РЈР¶Рµ РІ РєР°РЅР°Р»Рµ' });
    else if (banned.has(f.id)) action = el('span', { className: 'small error-text', textContent: 'Р—Р°Р±Р°РЅРµРЅ' });
    else if (invited.has(f.id)) action = el('span', { className: 'muted small', textContent: 'РџРѕР·РІР°Р»Рё' });
    else
      action = smallButton('РџСЂРёРіР»Р°СЃРёС‚СЊ', 'primary', async () => {
        $('hi-error').textContent = '';
        try {
          applyHub(await Api.post(`/hubs/${hub.id}/invites`, { userIds: [f.id] }));
          toast(`${f.displayName} РїРѕР»СѓС‡РёС‚ РїСЂРёРіР»Р°С€РµРЅРёРµ РІ В«${hub.name}В»`);
        } catch (err) {
          $('hi-error').textContent = err.message;
        }
      });
    list.append(el('div', { className: 'member-row' }, makeAvatar(f, presenceOf(f), 'small'), info, action));
  }
}

$('hi-search').oninput = renderHubInvite;
$('hi-close').onclick = () => $('hub-invite').classList.add('hidden');

// ---------- РџСЂРёРіР»Р°С€РµРЅРёРµ РјРЅРµ: РІСЃС‚СѓРїРёС‚СЊ РёР»Рё РѕС‚РєР°Р·Р°С‚СЊСЃСЏ ----------

let joinHubId = null;

/** Р©РµР»С‡РѕРє РїРѕ РїСЂРёРіР»Р°С€РµРЅРёСЋ (РІ СЃС‚РѕР»Р±С†Рµ РёР»Рё РІ СѓРІРµРґРѕРјР»РµРЅРёРё); РµСЃР»Рё СѓР¶Рµ РІ РєР°РЅР°Р»Рµ вЂ” РїСЂРѕСЃС‚Рѕ РѕС‚РєСЂС‹С‚СЊ РµРіРѕ */
function openHubJoin(hubId) {
  if (state.hubs.has(hubId)) return openHub(hubId);
  const invite = state.hubInvites.find((i) => i.hub.id === hubId);
  if (!invite) return;
  joinHubId = hubId;
  fillHubIcon($('hj-icon'), invite.hub);
  $('hj-name').textContent = invite.hub.name;
  const n = invite.hub.memberCount;
  $('hj-text').textContent = `${invite.from.displayName} Р·РѕРІС‘С‚ РІР°СЃ РІ РєР°РЅР°Р». РўР°Рј СѓР¶Рµ ${n} ${plural(n, 'СѓС‡Р°СЃС‚РЅРёРє', 'СѓС‡Р°СЃС‚РЅРёРєР°', 'СѓС‡Р°СЃС‚РЅРёРєРѕРІ')}.`;
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
    toast(`Р”РѕР±СЂРѕ РїРѕР¶Р°Р»РѕРІР°С‚СЊ РІ В«${hub.name}В»`);
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

// ---------- РЎРѕР±С‹С‚РёСЏ СЃ СЃРµСЂРІРµСЂР° ----------

function handleHubEvent(msg) {
  switch (msg.type) {
    case 'hub:updated':
      return applyHub(msg.hub);
    case 'hub:removed': {
      const hub = hubById(msg.hubId);
      forgetHub(msg.hubId);
      if (!hub || msg.reason === 'left') return;
      const text =
        msg.reason === 'banned' ? `Р’Р°СЃ Р·Р°Р±Р°РЅРёР»Рё РІ РєР°РЅР°Р»Рµ В«${hub.name}В»`
        : msg.reason === 'kicked' ? `Р’Р°СЃ РІС‹РіРЅР°Р»Рё РёР· РєР°РЅР°Р»Р° В«${hub.name}В»`
        : hub.ownerId !== state.me.id ? `РљР°РЅР°Р» В«${hub.name}В» СЂР°СЃРїСѓСЃС‚РёР»Рё`
        : '';
      if (!text) return;
      toast(text);
      notify('РљР°РЅР°Р»', text, { kind: 'hub-removed' });
      return;
    }
    case 'hub:invite': {
      const { invite } = msg;
      state.hubInvites = [invite, ...state.hubInvites.filter((i) => i.hub.id !== invite.hub.id)];
      renderRail();
      const text = `${invite.from.displayName} Р·РѕРІС‘С‚ РІР°СЃ РІ РєР°РЅР°Р» В«${invite.hub.name}В»`;
      toast(text);
      notify('РџСЂРёРіР»Р°С€РµРЅРёРµ РІ РєР°РЅР°Р»', text, { kind: 'hub-invite', open: { hub: invite.hub.id } });
    }
  }
}



// Р’С‹РїР°РґР°СЋС‰РёРµ СЃРїРёСЃРєРё (СѓС‡Р°СЃС‚РЅРёРєРё, РєР°Р»РµРЅРґР°СЂСЊ, РІСЂРµРјСЏ, С‡Р°С‚) Р·Р°РєСЂС‹РІР°СЋС‚СЃСЏ С‰РµР»С‡РєРѕРј РјРёРјРѕ
document.addEventListener('click', (e) => {
  // РљРЅРѕРїРєСѓ РјРѕРіР»Рё РїРµСЂРµСЂРёСЃРѕРІР°С‚СЊ РїСЂСЏРјРѕ РІРѕ РІСЂРµРјСЏ РєР»РёРєР° вЂ” СЌС‚Рѕ РЅРµ В«С‰РµР»С‡РѕРє РјРёРјРѕВ»
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
