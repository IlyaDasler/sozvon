// Статусы профиля и уведомления.
// Статус выбирают сами: активен, неактивен, не беспокоить, невидимый. «Неактивен» включается и сам,
// если 10 минут не трогать мышь и клавиатуру. Друзья видят: активен, неактивен, не беспокоить или не в сети.
// Уведомления: центр уведомлений (колокольчик), всплывающие уведомления Windows и звук.
// В режиме «не беспокоить» на рабочий стол ничего не приходит и звонки не звенят — в центре всё остаётся.

const STATUS = {
  online: { label: 'Активен', sub: 'В сети', hint: 'Друзья видят, что вы в сети' },
  idle: { label: 'Неактивен', sub: 'Неактивен', hint: 'Отошли от компьютера' },
  dnd: { label: 'Не беспокоить', sub: 'Не беспокоить', hint: 'Без уведомлений на рабочем столе и звонков со звуком' },
  invisible: { label: 'Невидимка', sub: 'Не в сети', hint: 'Для друзей вы не в сети, но всё видите и можете писать' },
  offline: { label: 'Не в сети', sub: 'Не в сети' },
};

/** Как выглядит человек для других: online, idle, dnd или offline (версии сервера до 1.7.3 присылают только online) */
const presenceOf = (user) => window.SozvonPresence.forUser(user);
const isAvailable = (user) => presenceOf(user) !== 'offline';
const myStatus = () => window.SozvonPresence.forSelf(state.me?.status);
const doNotDisturb = () => myStatus() === 'dnd';

// ---------- Свой статус ----------

function renderStatusMenu() {
  const menu = $('status-menu');
  menu.replaceChildren();
  for (const id of ['online', 'idle', 'dnd', 'invisible']) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `status-item${myStatus() === id ? ' active' : ''}`;
    item.dataset.status = id;
    item.innerHTML = `<span class="status-dot s-${id}"></span>`;
    const text = document.createElement('span');
    text.className = 'status-text';
    const b = document.createElement('b');
    b.textContent = STATUS[id].label;
    const hint = document.createElement('span');
    hint.className = 'muted small';
    hint.textContent = STATUS[id].hint;
    text.append(b, hint);
    item.append(text);
    item.onclick = () => setMyStatus(id);
    menu.append(item);
  }
}

async function setMyStatus(status) {
  $('status-menu').classList.add('hidden');
  if (status === myStatus()) return;
  try {
    state.me = await Api.put('/me/status', { status });
    renderMe();
    toast(`Статус: ${STATUS[status].label.toLowerCase()}`);
  } catch (err) {
    toast(err.message);
  }
}

// Другое устройство поменяло статус
function onMyStatus(status) {
  if (!state.me) return;
  const safeStatus = window.SozvonPresence.forSelf(status);
  if (safeStatus !== status) return;
  state.me.status = safeStatus;
  renderMe();
}

$('me-status-btn').onclick = (e) => {
  e.stopPropagation();
  const menu = $('status-menu');
  if (menu.classList.contains('hidden')) renderStatusMenu();
  const willShow = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');
  if (!willShow) return;
  // Меню вне панели: fixed над карточкой профиля и в пределах окна
  if (menu.parentElement !== document.body) document.body.append(menu);
  const anchorEl = $('me-status-btn')?.closest('.me-panel') || $('me-status-btn');
  const rect = anchorEl.getBoundingClientRect();
  const w = 268;
  const left = Math.max(8, Math.min(rect.left, innerWidth - w - 8));
  menu.style.position = 'fixed';
  menu.style.left = `${left}px`;
  const anchorTop = rect.top > 0 ? rect.top : innerHeight - 60;
  menu.style.bottom = `${Math.max(8, innerHeight - anchorTop + 8)}px`;
};

// «Неактивен» сам: приложение сообщает серверу, что за компьютером давно никого нет
let systemIdle = false;
window.desktop?.onIdle?.((idle) => {
  systemIdle = idle;
  socket?.send({ type: 'status:auto', idle });
});
const sendAutoStatus = () => systemIdle && socket?.send({ type: 'status:auto', idle: true });

// ---------- Настройки уведомлений ----------

const notifySettings = () => ({ desktop: true, sound: true, preview: true, ...store.get('notify', {}) });

function renderNotifySettings() {
  const s = notifySettings();
  $('set-notify-desktop').checked = s.desktop;
  $('set-notify-sound').checked = s.sound;
  $('set-notify-preview').checked = s.preview;
}

for (const [id, key] of [
  ['set-notify-desktop', 'desktop'],
  ['set-notify-sound', 'sound'],
  ['set-notify-preview', 'preview'],
]) {
  $(id).onchange = () => store.set('notify', { ...notifySettings(), [key]: $(id).checked });
}

// ---------- Центр уведомлений ----------

const NOTIF_LIMIT = 50;
const NOTIF_ICONS = {
  message: '💬',
  room: '#',
  missed: '📞',
  friend: '👋',
  'room-invite': '➕',
  'room-removed': '⛔',
  'hub-invite': '🏠',
  'hub-removed': '⛔',
  event: '📅',
  moderation: '⚑',
};

const notifKey = () => `notifications:${state.me?.id}`;
const loadNotifs = () => store.get(notifKey(), []);
const saveNotifs = (list) => store.set(notifKey(), list.slice(0, NOTIF_LIMIT));

// Личные сообщения не дублируем в колокольчике: их показывает бейдж
// у иконки приложения в рейле.
const bellNotifs = () => loadNotifs().filter((n) => n.kind !== 'message');

function renderNotifBadge() {
  const unread = bellNotifs().filter((n) => !n.read).length;
  $('notif-badge').textContent = unread > 99 ? '99+' : unread;
  $('notif-badge').classList.toggle('hidden', !unread);
}

function renderNotifPanel() {
  const list = $('notif-list');
  list.replaceChildren();
  const items = bellNotifs();
  $('notif-empty').classList.toggle('hidden', items.length > 0);
  for (const n of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `notif-item${n.read ? '' : ' unread'}${n.kind === 'event' ? ' event' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'notif-icon';
    icon.textContent = NOTIF_ICONS[n.kind] || '•';
    const body = document.createElement('span');
    body.className = 'notif-body';
    const title = document.createElement('b');
    title.className = 'ellipsis';
    title.textContent = n.title;
    const text = document.createElement('span');
    text.className = 'muted small notif-text';
    text.textContent = n.body;
    const time = document.createElement('time');
    time.className = 'muted small';
    time.textContent = formatNotifTime(n.at);
    body.append(title, text);
    row.append(icon, body, time);
    row.onclick = () => {
      markNotifsRead((item) => item.id === n.id);
      if (n.serverNoticeId != null) void markModerationNotifsRead([n.serverNoticeId]);
      closeNotifPanel();
      openNotifTarget(n.open, n);
    };
    list.append(row);
  }
}

function formatNotifTime(at) {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

function openNotifTarget(open, notification = null) {
  window.desktop?.focus();
  if (open?.reportDecision) {
    toast(notification?.body || notification?.title || 'Жалоба рассмотрена', 6500);
  } else if (open?.moderationReport != null) {
    openSettings();
    showSettingsTab('admin');
    window.openModerationReport?.(Number(open.moderationReport));
  } else if (open?.contact && state.contacts.has(open.contact)) selectContact(open.contact);
  else if (open?.room && state.rooms.has(open.room)) {
    selectRoom(open.room);
    // Уведомление треда ведёт не только в комнату, но и в сам тред.
    if (open.thread && typeof window.openThread === 'function') {
      window.openThread({ id: open.thread, threadRoot: open.thread }, { kind: 'room', roomId: open.room });
    }
  } else if (open?.friends) showFriendsTab(open.friends);
  else if (open?.hub) openHubJoin(open.hub);
}

function placeNotifPanel() {
  const panel = $('notif-panel');
  const btn = $('notif-btn');
  if (!panel || !btn) return;
  const r = btn.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - 32);
  // Панель — чуть левее колокольчика (язычок при этом остаётся под кнопкой)
  const left = Math.max(8, Math.min(r.left - 32, window.innerWidth - width - 8));
  const top = Math.max(48, r.bottom + 8);
  panel.style.position = 'fixed';
  panel.style.right = 'auto';
  panel.style.width = `${width}px`;
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.maxHeight = `${Math.max(180, Math.round(window.innerHeight - top - 16))}px`;
  // «Язычок» — ровно под центром колокольчика
  const tail = Math.min(width - 30, Math.max(8, Math.round(r.left + r.width / 2 - left - 6)));
  panel.style.setProperty('--notif-tail', `${tail}px`);
}

function openNotifPanel() {
  renderNotifPanel();
  $('notif-panel').classList.remove('hidden');
  placeNotifPanel();
  // Открыли — значит, всё прочитано
  const serverIDs = loadNotifs().filter((item) => !item.read && item.serverNoticeId != null).map((item) => item.serverNoticeId);
  saveNotifs(loadNotifs().map((n) => ({ ...n, read: true })));
  void markModerationNotifsRead(serverIDs);
  renderNotifBadge();
}

/** Открыли место, куда ведёт уведомление, — оно прочитано: target { contact }, { room }, { hub } или { friends } */
function readNotifsOf(target) {
  const [key, value] = Object.entries(target)[0];
  markNotifsRead((n) => value != null && n.open?.[key] === value);
}

/** Вернулись в окно: прочитано то, что сейчас открыто, и уведомления без места («вас убрали из канала») */
function readSeenNotifs() {
  if (state.selectedId) readNotifsOf({ contact: state.selectedId });
  if (state.selectedRoomId) readNotifsOf({ room: state.selectedRoomId });
  markNotifsRead((n) => !n.open || Object.values(n.open).every((v) => v == null));
}

function markNotifsRead(of) {
  const list = loadNotifs();
  if (!list.some((n) => !n.read && of(n))) return;
  saveNotifs(list.map((n) => (of(n) ? { ...n, read: true } : n)));
  renderNotifBadge();
}

function closeNotifPanel() {
  $('notif-panel').classList.add('hidden');
}

$('notif-btn').onclick = (e) => {
  e.stopPropagation();
  if ($('notif-panel').classList.contains('hidden')) openNotifPanel();
  else closeNotifPanel();
};
$('notif-clear').onclick = () => {
  void markModerationNotifsRead(loadNotifs().filter((item) => item.serverNoticeId != null).map((item) => item.serverNoticeId));
  saveNotifs([]);
  renderNotifPanel();
  renderNotifBadge();
};

// Щелчок мимо — закрываем меню статуса и центр уведомлений
document.addEventListener('click', (e) => {
  if (!e.target.closest('#status-menu, #me-status-btn')) $('status-menu').classList.add('hidden');
  if (!e.target.closest('#notif-panel, #notif-btn')) closeNotifPanel();
});

// ---------- Уведомить ----------

/**
 * Событие для человека: попадает в центр уведомлений; если окно не в фокусе — ещё и на рабочий стол со звуком.
 * kind: message, room, missed, friend, room-invite, room-removed, hub-invite, hub-removed;
 * open: { contact }, { room } или { hub } — куда перейти по щелчку
 */
function notify(title, body, { kind = 'message', open = null, hub = null, serverNoticeId = null, silent = false } = {}) {
  const list = loadNotifs();
  if (serverNoticeId != null && list.some((item) => item.serverNoticeId === Number(serverNoticeId))) return;
  const item = { id: serverNoticeId == null ? `${Date.now()}-${Math.random().toString(36).slice(2, 6)}` : `moderation-${serverNoticeId}`, kind, title, body, open, at: Date.now(), read: false };
  if (serverNoticeId != null) item.serverNoticeId = Number(serverNoticeId);
  list.unshift(item);
  saveNotifs(list);
  renderNotifBadge();
  if (!$('notif-panel').classList.contains('hidden')) renderNotifPanel();

  if (silent) return;
  const s = notifySettings();
  if (doNotDisturb()) return; // не беспокоить: только в центре уведомлений
  // В канале уведомления можно выключить: ни звука, ни мигания иконки, ни окна — только запись в центре
  const muted = hub != null && Boolean(store.get(`hub:mute:${hub}`, false));
  if (muted) return;
  if (s.sound) tone.blip('notify');
  if (document.hasFocus()) return;
  window.desktop?.attention();
  if (!s.desktop || !('Notification' in window)) return;
  const show = () => {
    const n = new Notification(title, { body: s.preview || (kind !== 'message' && kind !== 'room') ? body : 'Новое сообщение', silent: true });
    n.onclick = () => {
      if (serverNoticeId != null) void markModerationNotifsRead([serverNoticeId]);
      openNotifTarget(open, { kind, title, body, open });
    };
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') Notification.requestPermission().then((p) => p === 'granted' && show());
}

function receiveModerationNotification(raw, { silent = false } = {}) {
  if (!raw || !Number.isFinite(Number(raw.id))) return;
  const open = raw.kind === 'report_new'
    ? { moderationReport: Number(raw.reportId) }
    : raw.kind === 'report_decision' ? { reportDecision: true } : {};
  notify(String(raw.title || 'Уведомление модерации'), String(raw.body || ''), { kind: 'moderation', open, serverNoticeId: Number(raw.id), silent });
}

async function loadModerationNotifications() {
  if (!state.me || !window.Api?.token) return;
  try {
    const result = await Api.request('GET', '/moderation-notifications');
    for (const item of [...(result.notifications || [])].reverse()) {
      receiveModerationNotification(item, { silent: true });
      if (item.readAt) saveNotifs(loadNotifs().map((row) => row.serverNoticeId === Number(item.id) ? { ...row, read: true } : row));
    }
    renderNotifBadge();
  } catch (error) {
    if (error?.status !== 404 && error?.status !== 401) console.warn('moderation notifications unavailable', error?.message || error);
  }
}

async function markModerationNotifsRead(ids) {
  const unique = [...new Set(ids.map(Number).filter(Number.isFinite))];
  if (!unique.length || !window.Api?.token) return;
  try { await Api.request('POST', '/moderation-notifications/read', { ids: unique }); } catch { /* сохраняем локальное состояние прочтения */ }
}

window.receiveModerationNotification = receiveModerationNotification;
window.loadModerationNotifications = loadModerationNotifications;

// panel-moved-to-body: сайдбар обрезает вложенные окна (contain + overflow),
// поэтому панель уведомлений переносим в body и ставим её fixed рядом с колокольчиком
(() => {
  const move = () => {
    const panel = document.getElementById('notif-panel');
    if (panel && panel.parentElement !== document.body) document.body.append(panel);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', move);
  else move();
})();
