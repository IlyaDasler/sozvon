// Статусы профиля и уведомления.
// Статус выбирают сами: активен, неактивен, не беспокоить, невидимый. «Неактивен» включается и сам,
// если 10 минут не трогать мышь и клавиатуру. Друзья видят: активен, неактивен, не беспокоить или не в сети.
// Уведомления: центр уведомлений (колокольчик), всплывающие уведомления Windows и звук.
// В режиме «не беспокоить» на рабочий стол ничего не приходит и звонки не звенят — в центре всё остаётся.

const STATUS = {
  online: { label: 'Активен', sub: 'В сети', hint: 'Друзья видят, что вы в сети' },
  idle: { label: 'Неактивен', sub: 'Неактивен', hint: 'Отошли от компьютера' },
  dnd: { label: 'Не беспокоить', sub: 'Не беспокоить', hint: 'Без уведомлений на рабочем столе и звонков со звуком' },
  invisible: { label: 'Невидимый', sub: 'Не в сети', hint: 'Для друзей вы не в сети, но всё видите и можете писать' },
  offline: { label: 'Не в сети', sub: 'Не в сети' },
};

/** Как выглядит человек для других: online, idle, dnd или offline (версии сервера до 1.7.3 присылают только online) */
const presenceOf = (user) => user?.status || (user?.online ? 'online' : 'offline');
const isAvailable = (user) => presenceOf(user) !== 'offline';
const myStatus = () => state.me?.status || 'online';
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
  state.me.status = status;
  renderMe();
}

$('me-status-btn').onclick = (e) => {
  e.stopPropagation();
  const menu = $('status-menu');
  if (menu.classList.contains('hidden')) renderStatusMenu();
  menu.classList.toggle('hidden');
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
};

const notifKey = () => `notifications:${state.me?.id}`;
const loadNotifs = () => store.get(notifKey(), []);
const saveNotifs = (list) => store.set(notifKey(), list.slice(0, NOTIF_LIMIT));

function renderNotifBadge() {
  const unread = loadNotifs().filter((n) => !n.read).length;
  $('notif-badge').textContent = unread > 99 ? '99+' : unread;
  $('notif-badge').classList.toggle('hidden', !unread);
}

function renderNotifPanel() {
  const list = $('notif-list');
  list.replaceChildren();
  const items = loadNotifs();
  $('notif-empty').classList.toggle('hidden', items.length > 0);
  for (const n of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `notif-item${n.read ? '' : ' unread'}`;
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
      closeNotifPanel();
      openNotifTarget(n.open);
    };
    list.append(row);
  }
}

function formatNotifTime(at) {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

function openNotifTarget(open) {
  window.desktop?.focus();
  if (open?.contact && state.contacts.has(open.contact)) selectContact(open.contact);
  else if (open?.room && state.rooms.has(open.room)) selectRoom(open.room);
}

function openNotifPanel() {
  renderNotifPanel();
  $('notif-panel').classList.remove('hidden');
  // Открыли — значит, всё прочитано
  saveNotifs(loadNotifs().map((n) => ({ ...n, read: true })));
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
 * kind: message, room, missed, friend, room-invite, room-removed; open: { contact } или { room } — куда перейти по щелчку
 */
function notify(title, body, { kind = 'message', open = null } = {}) {
  const list = loadNotifs();
  list.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind, title, body, open, at: Date.now(), read: false });
  saveNotifs(list);
  renderNotifBadge();
  if (!$('notif-panel').classList.contains('hidden')) renderNotifPanel();

  const s = notifySettings();
  if (doNotDisturb()) return; // не беспокоить: только в центре уведомлений
  if (s.sound) tone.blip('notify');
  if (document.hasFocus()) return;
  window.desktop?.attention();
  if (!s.desktop || !('Notification' in window)) return;
  const show = () => {
    const n = new Notification(title, { body: s.preview || (kind !== 'message' && kind !== 'room') ? body : 'Новое сообщение', silent: true });
    n.onclick = () => openNotifTarget(open);
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') Notification.requestPermission().then((p) => p === 'granted' && show());
}
