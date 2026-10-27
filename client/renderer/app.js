// Интерфейс: вход, список друзей, чат и звонки

const $ = (id) => document.getElementById(id);
const isWeb = location.protocol.startsWith('http');

const DEFAULT_SERVER = 'https://135-106-226-12.sslip.io';
// Тот же сервер по старому адресу без HTTPS: вход переносим на новый адрес, токен остаётся действительным
const SAME_SERVER_OLD = 'http://135.106.226.12:3000';
// Прежние серверы (локальный и домашний): сохранённый вход сбрасываем
const LEGACY_SERVERS = ['http://localhost:3000', 'http://95.173.207.169:3000', 'http://92.241.13.52:3000'];

const COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f'];

const ICONS = {
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>',
  micOff: '<svg viewBox="0 0 24 24"><path d="M2 2l20 20M9 9v1a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7M19 10a7 7 0 0 1-1.1 3.8M5 10a7 7 0 0 0 11.2 5.6M12 17v5"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24"><path d="M2 2l20 20M3 18v-6a9 9 0 0 1 14.5-7.1M20.4 8.6A9 9 0 0 1 21 12v6"/><path d="M3 19a2 2 0 0 0 2 2h1v-6H3z"/></svg>',
};

const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const state = {
  me: null,
  contacts: new Map(),
  selectedId: null,
  history: new Map(), // id друга -> сообщения
  unread: new Map(),
  call: null, // { call: VoiceCall, peerId }
  incoming: null, // { callId, from }
  muted: store.get('muted', false),
  deafened: store.get('deafened', false),
  settings: store.get('audio', { micId: '', speakerId: '', noiseSuppression: true }),
  registerMode: false,
  providers: [], // способы входа, включённые на сервере: [{ id, name }]
};

const PROVIDER_STYLE = {
  google: { label: 'G', bg: '#ffffff', fg: '#4285f4' },
  yandex: { label: 'Я', bg: '#fc3f1d', fg: '#ffffff' },
  vk: { label: 'VK', bg: '#0077ff', fg: '#ffffff' },
};

let socket = null;
let callTimer = null;
const tone = new Tone();

// ---------- Мелкие помощники ----------

function makeAvatar(user, online, className = '') {
  const el = document.createElement('div');
  el.className = `avatar ${className}`;
  fillAvatar(el, user, online);
  return el;
}

const AVATAR_URL_RE = /^\/api\/avatars\/[a-f0-9]{32}\.webp$/;

function fillAvatar(el, user, online) {
  // Именно backgroundColor: сокращённое background в инлайн-стиле сбросило бы background-size: cover у фото
  el.style.backgroundColor = user.avatarColor;
  const hasImage = AVATAR_URL_RE.test(user.avatarUrl || '');
  el.classList.toggle('has-image', hasImage);
  el.style.backgroundImage = hasImage ? `url("${Api.base}${user.avatarUrl}")` : '';
  el.textContent = hasImage ? '' : (user.displayName || user.username || '?').trim().charAt(0).toUpperCase();
  if (online !== undefined) {
    const dot = document.createElement('span');
    dot.className = `status${online ? ' online' : ''}`;
    el.append(dot);
  }
}

let toastTimer;
function toast(text, ms = 4000) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

function notify(title, body) {
  if (document.hasFocus()) return;
  window.desktop?.attention();
  if (!('Notification' in window)) return;
  const show = () => {
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.desktop?.focus();
      window.focus();
    };
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') Notification.requestPermission().then((p) => p === 'granted' && show());
}

function showScreen(name) {
  $('auth').classList.toggle('hidden', name !== 'auth');
  $('main').classList.toggle('hidden', name !== 'main');
}

const formatTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const formatDay = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

function micErrorText(err) {
  if (err.name === 'NotAllowedError')
    return 'Нет доступа к микрофону. Разрешите его в Windows: Параметры → Конфиденциальность → Микрофон.';
  if (err.name === 'NotFoundError') return 'Микрофон не найден. Подключите его и попробуйте снова.';
  return err.message || 'Не удалось начать звонок';
}

// ---------- Вход и регистрация ----------

function setAuthMode(register) {
  state.registerMode = register;
  $('display-field').classList.toggle('hidden', !register);
  $('invite-field').classList.toggle('hidden', !register);
  $('auth-submit').textContent = register ? 'Создать аккаунт' : 'Войти';
  $('auth-subtitle').textContent = register
    ? 'Создайте аккаунт — это займёт полминуты'
    : 'Войдите, чтобы созвониться с друзьями';
  $('auth-switch-text').textContent = register ? 'Уже есть аккаунт?' : 'Нет аккаунта?';
  $('auth-toggle').textContent = register ? 'Войти' : 'Зарегистрироваться';
  $('auth-password').autocomplete = register ? 'new-password' : 'current-password';
  $('auth-error').textContent = '';
  renderOAuthButtons();
}

// ---------- Вход через Google / Яндекс / VK ----------

// Ошибки из главного процесса Electron приходят с длинным техническим префиксом
const cleanError = (err) => err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (size) => base64url(crypto.getRandomValues(new Uint8Array(size)));

function providerBadge(id) {
  const style = PROVIDER_STYLE[id] || { label: '?', bg: '#555', fg: '#fff' };
  const el = document.createElement('span');
  el.className = 'provider-badge';
  el.textContent = style.label;
  el.style.background = style.bg;
  el.style.color = style.fg;
  return el;
}

let providersRequest = 0;

async function loadProviders(base) {
  // Учитываем только ответ на последний запрос: более ранний мог прийти позже и затереть список
  const request = ++providersRequest;
  let providers = [];
  // Вход через сервисы работает только в приложении: браузерной версии некуда принять ответ
  if (window.desktop?.oauth && base) {
    try {
      const res = await fetch(`${base}/api/oauth/providers`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) providers = await res.json();
    } catch {}
  }
  if (request !== providersRequest) return;
  state.providers = providers;
  renderOAuthButtons();
}

function renderOAuthButtons() {
  const box = $('oauth-buttons');
  box.replaceChildren();
  for (const p of state.providers) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn oauth-btn';
    const text = document.createElement('span');
    text.textContent = `${state.registerMode ? 'Регистрация' : 'Войти'} через ${p.name}`;
    button.append(providerBadge(p.id), text);
    button.onclick = () => oauthLogin(p.id);
    box.append(button);
  }
  $('oauth-block').classList.toggle('hidden', !state.providers.length);
}

// PKCE: сервис входа вернёт код только тому, кто знает исходную случайную строку
async function runOAuth(provider, mode, extra = {}) {
  const verifier = randomToken(48);
  const stateToken = randomToken(16);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(hash));

  const { url } = await Api.get(`/oauth/${provider}/url?state=${stateToken}&challenge=${challenge}`);
  const params = await window.desktop.oauth(url);
  if (params.error) throw new Error('Вход отменён');
  if (params.state !== stateToken || !params.code) throw new Error('Ответ сервиса не прошёл проверку, попробуйте ещё раз');

  return Api.post(`/oauth/${provider}`, {
    code: params.code,
    codeVerifier: verifier,
    deviceId: params.device_id,
    state: stateToken,
    mode,
    ...extra,
  });
}

async function oauthLogin(provider) {
  const base = isWeb ? location.origin : normalizeServer($('server-url').value);
  if (!base) return ($('auth-error').textContent = 'Укажите адрес сервера');
  const buttons = $('auth-form').querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  $('auth-error').textContent = '';
  Api.base = base;
  Api.token = '';
  try {
    const { token, user, created } = await runOAuth(provider, 'login', { inviteCode: $('auth-invite').value.trim() });
    Api.token = token;
    store.set('session', { base, token });
    store.set('server', base);
    enterMain(user);
    if (created) toast(`Профиль создан! Ваш логин для друзей: ${user.username}`, 8000);
  } catch (err) {
    $('auth-error').textContent = cleanError(err);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function normalizeServer(url) {
  url = url.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

$('auth-toggle').onclick = (e) => {
  e.preventDefault();
  setAuthMode(!state.registerMode);
};

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const base = isWeb ? location.origin : normalizeServer($('server-url').value);
  const username = $('auth-username').value.trim();
  const password = $('auth-password').value;
  if (!base) return ($('auth-error').textContent = 'Укажите адрес сервера');
  if (!username || !password) return ($('auth-error').textContent = 'Введите логин и пароль');

  const button = $('auth-submit');
  button.disabled = true;
  $('auth-error').textContent = '';
  Api.base = base;
  Api.token = '';
  try {
    const body = { username, password };
    if (state.registerMode) {
      body.displayName = $('auth-display').value.trim();
      body.inviteCode = $('auth-invite').value.trim();
    }
    const { token, user } = await Api.post(state.registerMode ? '/register' : '/login', body);
    Api.token = token;
    store.set('session', { base, token });
    store.set('server', base);
    $('auth-password').value = '';
    enterMain(user);
  } catch (err) {
    $('auth-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
};

function enterMain(user) {
  state.me = user;
  renderMe();
  if (!state.providers.length) loadProviders(Api.base);
  applyAudioState();
  showScreen('main');
  selectContact(null);

  socket = new ServerSocket({
    onMessage: handleEvent,
    onStatus(ok) {
      $('conn-dot').classList.toggle('ok', ok);
      $('conn-dot').title = ok ? 'Подключено к серверу' : 'Нет связи с сервером, переподключаемся…';
      if (ok) refreshContacts();
    },
    onUnauthorized: () => logout('Сессия истекла, войдите заново'),
  });
  socket.connect();
}

async function refreshContacts() {
  try {
    const list = await Api.get('/contacts');
    state.contacts = new Map(list.map((c) => [c.id, c]));
    renderContacts();
    if (state.selectedId && !state.contacts.has(state.selectedId)) selectContact(null);
    else if (state.selectedId) renderChatHeader();
  } catch (err) {
    toast(err.message);
  }
}

function logout(message) {
  hangup();
  if (state.incoming) declineIncoming();
  socket?.close();
  socket = null;
  store.set('session', null);
  Object.assign(state, { me: null, selectedId: null, contacts: new Map(), history: new Map(), unread: new Map() });
  closeSettings();
  setAuthMode(false);
  showScreen('auth');
  if (message) $('auth-error').textContent = message;
}

// ---------- Друзья ----------

function renderMe() {
  const me = state.me;
  const av = $('me-avatar');
  av.replaceChildren();
  fillAvatar(av, me);
  $('me-name').textContent = me.displayName;
  $('me-username').textContent = `@${me.username}`;
  $('empty-username').textContent = me.username;
}

function renderContacts() {
  const list = $('contact-list');
  list.replaceChildren();
  const sorted = [...state.contacts.values()].sort(
    (a, b) => b.online - a.online || a.displayName.localeCompare(b.displayName, 'ru')
  );
  $('contact-count').textContent = sorted.length;

  if (!sorted.length) {
    const li = document.createElement('li');
    li.className = 'muted small pad';
    li.textContent = 'Пока никого. Попросите друга зарегистрироваться и добавьте его по логину.';
    list.append(li);
  }

  for (const c of sorted) {
    const li = document.createElement('li');
    li.className = `contact${c.id === state.selectedId ? ' active' : ''}${c.online ? '' : ' offline'}`;
    li.append(makeAvatar(c, c.online));

    const name = document.createElement('div');
    name.className = 'name';
    const title = document.createElement('div');
    title.className = 'ellipsis';
    title.textContent = c.displayName;
    const sub = document.createElement('div');
    sub.className = 'muted ellipsis';
    if (state.call?.peerId === c.id) {
      sub.textContent = 'В звонке';
      sub.classList.add('in-call-tag');
    } else {
      sub.textContent = c.online ? 'В сети' : 'Не в сети';
    }
    name.append(title, sub);
    li.append(name);

    const unread = state.unread.get(c.id);
    if (unread) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = unread > 99 ? '99+' : unread;
      li.append(badge);
    }

    li.onclick = () => selectContact(c.id);
    list.append(li);
  }
}

$('add-contact').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('add-contact-input');
  const username = input.value.trim();
  $('add-contact-error').textContent = '';
  if (!username) return;
  try {
    const user = await Api.post('/contacts', { username });
    state.contacts.set(user.id, user);
    input.value = '';
    selectContact(user.id);
    toast(`${user.displayName} теперь у вас в друзьях`);
  } catch (err) {
    $('add-contact-error').textContent = err.message;
  }
};

$('remove-contact-btn').onclick = async () => {
  const c = state.contacts.get(state.selectedId);
  if (!c || !confirm(`Удалить ${c.displayName} из друзей?`)) return;
  try {
    await Api.del(`/contacts/${c.id}`);
    if (state.call?.peerId === c.id) hangup();
    state.contacts.delete(c.id);
    state.history.delete(c.id);
    selectContact(null);
  } catch (err) {
    toast(err.message);
  }
};

async function selectContact(id) {
  state.selectedId = id;
  state.unread.delete(id);
  renderContacts();

  const contact = state.contacts.get(id);
  $('empty-state').classList.toggle('hidden', Boolean(contact));
  $('chat').classList.toggle('hidden', !contact);
  if (!contact) return;

  renderChatHeader();
  renderCallPanel();
  renderMessages();
  $('message-input').focus();

  if (!state.history.has(id)) {
    try {
      const loaded = await Api.get(`/messages/${id}`);
      // Пока грузили историю, могли прийти новые сообщения — объединяем без дублей
      const known = state.history.get(id) || [];
      const merged = new Map([...loaded, ...known].map((m) => [m.id, m]));
      state.history.set(id, [...merged.values()].sort((a, b) => a.id - b.id));
      if (state.selectedId === id) renderMessages();
    } catch (err) {
      toast(err.message);
    }
  }
}

function renderChatHeader() {
  const c = state.contacts.get(state.selectedId);
  if (!c) return;
  const av = $('peer-avatar');
  av.replaceChildren();
  fillAvatar(av, c, c.online);
  $('peer-name').textContent = c.displayName;
  $('peer-status').textContent = `@${c.username} · ${c.online ? 'в сети' : 'не в сети'}`;
  const busy = Boolean(state.call || state.incoming);
  $('call-btn').classList.toggle('hidden', state.call?.peerId === c.id);
  $('call-btn').disabled = !c.online || busy;
  $('call-btn').title = !c.online ? 'Друг не в сети' : busy ? 'Вы уже в звонке' : 'Голосовой звонок';
}

// ---------- Сообщения ----------

function renderMessages() {
  const box = $('messages');
  const list = state.history.get(state.selectedId) || [];
  box.replaceChildren();

  if (!list.length) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = state.history.has(state.selectedId)
      ? 'Здесь пока пусто. Напишите что-нибудь или позвоните!'
      : 'Загрузка…';
    box.append(hint);
    return;
  }

  let prev = null;
  for (const m of list) {
    const day = formatDay(m.createdAt);
    const newDay = !prev || formatDay(prev.createdAt) !== day;
    if (newDay) {
      const sep = document.createElement('div');
      sep.className = 'day';
      sep.textContent = day;
      box.append(sep);
    }
    const author = m.fromId === state.me.id ? state.me : state.contacts.get(m.fromId) || { displayName: '?', avatarColor: '#555' };
    const continued = !newDay && prev.fromId === m.fromId && m.createdAt - prev.createdAt < 5 * 60_000;

    const row = document.createElement('div');
    row.className = `msg${continued ? ' cont' : ''}`;
    row.append(makeAvatar(author));
    const body = document.createElement('div');
    body.className = 'msg-body';
    if (!continued) {
      const head = document.createElement('div');
      head.className = 'msg-head';
      const name = document.createElement('b');
      name.textContent = author.displayName;
      name.style.color = author.avatarColor;
      const time = document.createElement('time');
      time.textContent = formatTime(m.createdAt);
      head.append(name, time);
      body.append(head);
    }
    const text = document.createElement('div');
    text.className = 'msg-text';
    text.textContent = m.text;
    text.title = formatTime(m.createdAt);
    body.append(text);
    row.append(body);
    box.append(row);
    prev = m;
  }
  box.scrollTop = box.scrollHeight;
}

function addMessage(m) {
  const peerId = m.fromId === state.me.id ? m.toId : m.fromId;
  const list = state.history.get(peerId);
  if (list && !list.some((x) => x.id === m.id)) list.push(m);

  if (m.fromId === state.me.id) {
    if (peerId === state.selectedId) renderMessages();
    return;
  }

  const visible = peerId === state.selectedId && document.hasFocus();
  if (peerId === state.selectedId) renderMessages();
  if (!visible) {
    if (peerId !== state.selectedId) state.unread.set(peerId, (state.unread.get(peerId) || 0) + 1);
    renderContacts();
    notify(state.contacts.get(peerId)?.displayName || 'Новое сообщение', m.text);
  }
}

$('message-form').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('message-input');
  const text = input.value.trim();
  const to = state.selectedId;
  if (!text || !to) return;
  input.value = '';
  try {
    addMessage(await Api.post(`/messages/${to}`, { text }));
  } catch (err) {
    input.value = text;
    toast(err.message);
  }
};

// ---------- События с сервера ----------

const END_REASONS = {
  declined: 'Собеседник отклонил звонок',
  timeout: 'Собеседник не ответил',
  hangup: 'Звонок завершён',
  disconnected: 'Собеседник отключился',
};

const UNAVAILABLE_REASONS = {
  offline: 'Друг не в сети',
  busy: 'Друг сейчас разговаривает',
  'not-contact': 'Этот человек не в списке друзей',
};

function handleEvent(msg) {
  switch (msg.type) {
    case 'presence': {
      const c = state.contacts.get(msg.userId);
      if (!c) return;
      c.online = msg.online;
      renderContacts();
      if (msg.userId === state.selectedId) renderChatHeader();
      return;
    }
    case 'contact:added':
      state.contacts.set(msg.user.id, msg.user);
      renderContacts();
      toast(`${msg.user.displayName} добавил(а) вас в друзья`);
      return;
    case 'contact:removed':
      state.contacts.delete(msg.userId);
      state.history.delete(msg.userId);
      if (state.selectedId === msg.userId) selectContact(null);
      else renderContacts();
      return;
    case 'user:updated': {
      const c = state.contacts.get(msg.user.id);
      if (!c) return;
      Object.assign(c, msg.user);
      renderContacts();
      if (msg.user.id === state.selectedId) {
        renderChatHeader();
        renderMessages();
        renderCallPanel();
      }
      return;
    }
    case 'message':
      return addMessage(msg.message);
    case 'call:incoming':
      return onIncoming(msg);
    case 'call:ringing':
      if (state.call && !state.call.call.callId) state.call.call.callId = msg.callId;
      // Звонок отменили раньше, чем сервер успел его создать
      else socket.send({ type: 'call:hangup', callId: msg.callId });
      return;
    case 'call:accepted':
      if (state.call?.call.callId !== msg.callId) return;
      tone.stop();
      state.call.call.startOffer().catch((err) => {
        console.error(err);
        hangup('Не удалось установить соединение');
      });
      return;
    case 'call:unavailable':
      if (state.call && !state.call.call.callId) finishCall(UNAVAILABLE_REASONS[msg.reason] || 'Не удалось позвонить');
      return;
    case 'call:ended':
      return onCallEnded(msg);
    case 'signal':
      if (state.call?.call.callId === msg.callId) state.call.call.enqueueSignal(msg.data);
      return;
  }
}

// ---------- Звонки ----------

function newCall(peer) {
  const call = new VoiceCall({
    peer,
    socket,
    audioEl: $('remote-audio'),
    onState: onCallState,
    onSpeaking(who, speaking) {
      const el = $(who === 'me' ? 'call-me-avatar' : 'call-peer-avatar');
      el.classList.toggle('speaking', speaking);
    },
  });
  call.muted = state.muted || state.deafened;
  state.call = { call, peerId: peer.id };
  $('peer-volume').value = store.get(`volume:${peer.id}`, 100);
  $('remote-audio').volume = $('peer-volume').value / 100;
  clearInterval(callTimer);
  callTimer = setInterval(updateCallStatus, 1000);
  return call;
}

async function startCall() {
  const peer = state.contacts.get(state.selectedId);
  if (!peer || state.call || state.incoming) return;
  if (!peer.online) return toast('Друг не в сети');

  const call = newCall(peer);
  call.setState('calling');
  try {
    await call.openMic(state.settings);
    await call.createPeer();
  } catch (err) {
    return finishCall(micErrorText(err));
  }
  if (state.call?.call !== call) return; // отменили, пока ждали микрофон
  if (!socket.send({ type: 'call:invite', to: peer.id })) return finishCall('Нет связи с сервером');
  tone.loop('ringback');
}

function onIncoming({ callId, from }) {
  if (state.call || state.incoming) return socket.send({ type: 'call:decline', callId });
  state.incoming = { callId, from };
  const peer = state.contacts.get(from.id) || from;
  const av = $('incoming-avatar');
  av.replaceChildren();
  fillAvatar(av, peer);
  $('incoming-name').textContent = peer.displayName;
  $('incoming').classList.remove('hidden');
  renderChatHeader();
  tone.loop('ring');
  window.desktop?.focus();
  notify(`${peer.displayName} звонит`, 'Входящий голосовой звонок');
}

function hideIncoming() {
  state.incoming = null;
  $('incoming').classList.add('hidden');
  tone.stop();
  renderChatHeader();
}

async function acceptIncoming() {
  const inc = state.incoming;
  if (!inc) return;
  hideIncoming();
  const peer = state.contacts.get(inc.from.id) || inc.from;
  const call = newCall(peer);
  call.callId = inc.callId;
  call.setState('connecting');
  selectContact(peer.id);
  try {
    await call.openMic(state.settings);
    await call.createPeer();
  } catch (err) {
    socket.send({ type: 'call:decline', callId: inc.callId });
    return finishCall(micErrorText(err));
  }
  if (state.call?.call !== call) return;
  socket.send({ type: 'call:accept', callId: inc.callId });
}

function declineIncoming() {
  if (!state.incoming) return;
  socket?.send({ type: 'call:decline', callId: state.incoming.callId });
  hideIncoming();
}

function onCallEnded({ callId, reason }) {
  if (state.incoming?.callId === callId) {
    const name = state.incoming.from.displayName;
    hideIncoming();
    if (reason !== 'answered-elsewhere') toast(`Пропущенный звонок от ${name}`);
    return;
  }
  if (state.call?.call.callId === callId) finishCall(END_REASONS[reason] || 'Звонок завершён');
}

function hangup(message) {
  const c = state.call;
  if (!c) return;
  if (c.call.callId) socket?.send({ type: 'call:hangup', callId: c.call.callId });
  finishCall(message);
}

function finishCall(message) {
  const c = state.call;
  if (!c) return;
  state.call = null;
  clearInterval(callTimer);
  c.call.close();
  tone.stop();
  tone.blip('end');
  $('call-me-avatar').classList.remove('speaking');
  $('call-peer-avatar').classList.remove('speaking');
  renderCallPanel();
  renderChatHeader();
  renderContacts();
  if (message) toast(message);
}

function onCallState(callState) {
  if (callState === 'failed')
    return hangup('Не удалось соединиться. Скорее всего, нужен TURN-сервер — см. README.');
  renderChatHeader();
  renderCallPanel();
  renderContacts();
}

function renderCallPanel() {
  const c = state.call;
  const show = Boolean(c) && c.peerId === state.selectedId;
  $('call-panel').classList.toggle('hidden', !show);
  if (!show) return;
  const peer = state.contacts.get(c.peerId) || c.call.peer;
  $('call-me-avatar').replaceChildren();
  fillAvatar($('call-me-avatar'), state.me);
  $('call-peer-avatar').replaceChildren();
  fillAvatar($('call-peer-avatar'), peer);
  $('call-peer-name').textContent = peer.displayName;
  updateCallStatus();
}

function updateCallStatus() {
  const call = state.call?.call;
  if (!call) return;
  const text = {
    calling: 'Вызов…',
    connecting: 'Соединение…',
    reconnecting: 'Связь прервалась, переподключаемся…',
    connected: call.connectedAt ? formatDuration(Date.now() - call.connectedAt) : '',
  }[call.state];
  $('call-status').textContent = text ?? '';
}

// ---------- Микрофон и звук ----------

function applyAudioState() {
  state.call?.call.setMuted(state.muted || state.deafened);
  $('remote-audio').muted = state.deafened;
  const micOff = state.muted || state.deafened;
  for (const id of ['mic-btn', 'call-mute']) {
    $(id).innerHTML = micOff ? ICONS.micOff : ICONS.mic;
    $(id).classList.toggle('off', micOff);
  }
  for (const id of ['deafen-btn', 'call-deafen']) {
    $(id).innerHTML = state.deafened ? ICONS.soundOff : ICONS.sound;
    $(id).classList.toggle('off', state.deafened);
  }
  store.set('muted', state.muted);
  store.set('deafened', state.deafened);
}

function toggleMute() {
  if (state.deafened) {
    state.deafened = false;
    state.muted = false;
  } else {
    state.muted = !state.muted;
  }
  tone.blip(state.muted ? 'mute' : 'unmute');
  applyAudioState();
}

function toggleDeafen() {
  state.deafened = !state.deafened;
  tone.blip(state.deafened ? 'mute' : 'unmute');
  applyAudioState();
}

async function applySpeaker() {
  const audio = $('remote-audio');
  if (!audio.setSinkId) return;
  try {
    await audio.setSinkId(state.settings.speakerId || '');
  } catch (err) {
    console.warn('Не удалось выбрать устройство вывода', err);
  }
}

// ---------- Настройки ----------

let pickedColor = null;

async function fillDeviceSelect(select, kind, selected) {
  let devices = await navigator.mediaDevices.enumerateDevices();
  // Без разрешения на микрофон названия устройств пустые — запрашиваем его один раз
  if (devices.some((d) => d.kind === kind && !d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {}
  }
  select.replaceChildren(new Option('По умолчанию', ''));
  for (const d of devices) {
    if (d.kind !== kind || d.deviceId === 'default' || d.deviceId === 'communications') continue;
    select.append(new Option(d.label || 'Устройство', d.deviceId));
  }
  select.value = [...select.options].some((o) => o.value === selected) ? selected : '';
}

function renderColorPicker() {
  const box = $('color-picker');
  box.replaceChildren();
  for (const color of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `color${color === pickedColor ? ' selected' : ''}`;
    b.style.background = color;
    b.onclick = () => {
      pickedColor = color;
      renderColorPicker();
    };
    box.append(b);
  }
}

function renderIdentities() {
  const list = $('identity-list');
  list.replaceChildren();
  $('identities-section').classList.toggle('hidden', !state.providers.length);

  for (const p of state.providers) {
    const linked = state.me.identities.find((i) => i.provider === p.id);
    const row = document.createElement('div');
    row.className = 'identity-row';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.textContent = p.name;
    const sub = document.createElement('div');
    sub.className = 'muted small ellipsis';
    sub.textContent = linked ? linked.email || 'привязан' : 'не привязан';
    info.append(name, sub);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = linked ? 'btn danger-outline' : 'btn';
    button.textContent = linked ? 'Отвязать' : 'Привязать';
    button.onclick = async () => {
      button.disabled = true;
      $('settings-error').textContent = '';
      try {
        state.me = linked ? await Api.del(`/me/identities/${p.id}`) : await runOAuth(p.id, 'link');
        renderIdentities();
        renderPasswordSection();
      } catch (err) {
        $('settings-error').textContent = cleanError(err);
        button.disabled = false;
      }
    };
    row.append(providerBadge(p.id), info, button);
    list.append(row);
  }
}

// ---------- Аватарка ----------

const AVATAR_SIZE = 256;

// Обрезаем по центру до квадрата, уменьшаем до 256×256 и сжимаем в WebP
async function makeAvatarBlob(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Не получилось открыть картинку. Попробуйте JPG или PNG');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5]) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality));
    if (blob && blob.size < 280 * 1024) return blob;
  }
  throw new Error('Картинка получилась слишком большой');
}

function applyMe(me) {
  state.me = me;
  renderMe();
  renderAvatarEditor();
  renderMessages();
  renderCallPanel();
}

function renderAvatarEditor() {
  const el = $('set-avatar');
  el.replaceChildren();
  fillAvatar(el, state.me);
  $('avatar-remove-btn').classList.toggle('hidden', !state.me.avatarUrl);
}

async function uploadAvatar(file) {
  $('settings-error').textContent = '';
  $('avatar-upload-btn').disabled = true;
  try {
    applyMe(await Api.upload('PUT', '/me/avatar', await makeAvatarBlob(file)));
    toast('Фото профиля обновлено');
  } catch (err) {
    $('settings-error').textContent = err.message;
  } finally {
    $('avatar-upload-btn').disabled = false;
  }
}

$('avatar-upload-btn').onclick = () => $('avatar-input').click();
$('avatar-input').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) uploadAvatar(file);
};
$('avatar-remove-btn').onclick = async () => {
  try {
    applyMe(await Api.del('/me/avatar'));
  } catch (err) {
    $('settings-error').textContent = err.message;
  }
};

function renderPasswordSection() {
  $('password-title').textContent = state.me.hasPassword ? 'Сменить пароль' : 'Задать пароль';
  $('cur-pass-field').classList.toggle('hidden', !state.me.hasPassword);
}

async function openSettings() {
  renderIdentities();
  renderPasswordSection();
  renderAvatarEditor();
  $('set-display').value = state.me.displayName;
  pickedColor = state.me.avatarColor;
  renderColorPicker();
  $('set-ns').checked = state.settings.noiseSuppression;
  $('set-cur-pass').value = '';
  $('set-new-pass').value = '';
  $('settings-error').textContent = '';
  $('set-speaker').closest('.field').classList.toggle('hidden', !HTMLMediaElement.prototype.setSinkId);
  $('settings').classList.remove('hidden');
  try {
    await fillDeviceSelect($('set-mic'), 'audioinput', state.settings.micId);
    await fillDeviceSelect($('set-speaker'), 'audiooutput', state.settings.speakerId);
  } catch (err) {
    console.warn(err);
  }
}

function closeSettings() {
  $('settings').classList.add('hidden');
}

$('settings-form').onsubmit = async (e) => {
  e.preventDefault();
  $('settings-error').textContent = '';

  const body = {};
  const displayName = $('set-display').value.trim();
  if (displayName !== state.me.displayName) body.displayName = displayName;
  if (pickedColor !== state.me.avatarColor) body.avatarColor = pickedColor;
  if ($('set-new-pass').value) {
    body.currentPassword = $('set-cur-pass').value;
    body.newPassword = $('set-new-pass').value;
  }

  try {
    if (Object.keys(body).length) {
      state.me = await Api.patch('/me', body);
      renderMe();
      renderMessages();
      renderCallPanel();
      if (body.newPassword) toast('Пароль сохранён');
    }
  } catch (err) {
    $('settings-error').textContent = err.message;
    return;
  }

  const prev = state.settings;
  state.settings = {
    micId: $('set-mic').value,
    speakerId: $('set-speaker').value,
    noiseSuppression: $('set-ns').checked,
  };
  store.set('audio', state.settings);
  applySpeaker();
  const micChanged = prev.micId !== state.settings.micId || prev.noiseSuppression !== state.settings.noiseSuppression;
  if (micChanged && state.call) state.call.call.switchMic(state.settings).catch((err) => toast(micErrorText(err)));
  closeSettings();
};

// ---------- Обновления ----------

// Новая версия → окно со списком изменений и кнопками «Обновить», «Позже», «Пропустить эту версию»

let updateStatus = { state: 'idle' };
let updateRequested = false; // нажали «Обновить»: после загрузки сразу ставим
let manualCheck = false; // проверка из настроек показывает окно даже для пропущенной версии
let modalShownFor = null; // версия, для которой окно уже показывали в этом запуске

const UPDATE_TEXT = {
  checking: () => 'Проверяем обновления…',
  available: (s) => `Доступна версия ${s.version}`,
  downloading: (s) => `Скачивается версия ${s.version} (${s.percent ?? 0}%)`,
  ready: (s) => `Версия ${s.version} скачана и готова к установке`,
  latest: () => 'У вас последняя версия',
  error: () => 'Не удалось проверить обновления',
  unsupported: () => 'Обновления работают только в установленной версии',
};

const isSkipped = (version) => store.get('skippedUpdate', null) === version;
const updateModalOpen = () => !$('update-modal').classList.contains('hidden');

// Описание релиза приходит в HTML — превращаем в простой текст, ничего из него не выполняя
function notesToText(html) {
  const fallback = 'Исправления и улучшения.';
  if (!html) return fallback;
  const prepared = html.replace(/<li[^>]*>/gi, '• ').replace(/<\/(li|p|h[1-6]|ul|ol)>|<br\s*\/?>/gi, '\n');
  const text = new DOMParser().parseFromString(prepared, 'text/html').body.textContent || '';
  return text.replace(/\n{3,}/g, '\n\n').trim() || fallback;
}

function openUpdateModal() {
  const s = updateStatus;
  modalShownFor = s.version;
  $('update-title').textContent = `Доступно обновление ${s.version}`;
  $('update-current').textContent = `Сейчас у вас версия ${s.current}`;
  $('update-notes').textContent = notesToText(s.notes);
  $('update-error').textContent = '';
  $('update-modal').classList.remove('hidden');
  renderUpdate();
}

function closeUpdateModal() {
  $('update-modal').classList.add('hidden');
  renderUpdate();
}

function renderUpdate() {
  const s = updateStatus;
  const busy = s.state === 'downloading' || (s.state === 'ready' && updateRequested);

  // Окно обновления: во время загрузки вместо кнопок — прогресс
  $('update-progress').classList.toggle('hidden', !busy);
  $('update-actions').classList.toggle('hidden', busy);
  $('update-progress-fill').style.width = `${s.state === 'ready' ? 100 : (s.percent ?? 0)}%`;
  $('update-progress-text').textContent = s.state === 'ready' ? 'Перезапускаем…' : `Скачиваем… ${s.percent ?? 0}%`;

  // Полоса внизу слева — если окно закрыли кнопкой «Позже»
  const pending =
    !updateModalOpen() &&
    ((s.state === 'available' && !isSkipped(s.version)) || s.state === 'downloading' || s.state === 'ready');
  $('update-bar').classList.toggle('hidden', !pending);
  document.body.classList.toggle('has-update', pending);
  $('update-text').textContent =
    s.state === 'downloading' ? `Обновление: ${s.percent ?? 0}%` : s.state === 'ready' ? 'Обновление готово' : 'Доступно обновление';
  $('update-btn').classList.toggle('hidden', s.state === 'downloading');
  $('update-btn').textContent = s.state === 'ready' ? 'Обновить' : 'Подробнее';
  $('update-bar').title = `Версия ${s.version ?? ''}`;

  // Версия и кнопки «Проверить обновления»: экран входа, шапка боковой панели, настройки
  $('app-version').textContent = s.current || '';
  $('auth-version').textContent = s.current ? `Версия ${s.current}` : '';
  $('auth-version-row').classList.toggle('hidden', !s.current);
  $('sidebar-update-check').classList.toggle('spinning', s.state === 'checking' && manualCheck);
  $('update-status').textContent = UPDATE_TEXT[s.state]?.(s) ?? '';
  $('update-status').title = s.state === 'error' ? s.message || '' : '';
  $('update-check-btn').textContent =
    s.state === 'ready' ? 'Перезапустить и обновить' : s.state === 'available' ? 'Обновить…' : 'Проверить обновления';
  $('update-check-btn').disabled = s.state === 'checking' || s.state === 'downloading';
}

function installUpdate() {
  hangup();
  window.desktop.update.install();
}

function startUpdate() {
  if (state.call && !confirm('Сейчас идёт звонок. После загрузки приложение перезапустится и звонок завершится. Продолжить?'))
    return;
  updateRequested = true;
  $('update-error').textContent = '';
  if (updateStatus.state === 'ready') return installUpdate();
  window.desktop.update.download();
  renderUpdate();
}

function onUpdateStatus(s) {
  updateStatus = { ...updateStatus, ...s };
  const { state: st, version } = updateStatus;
  if (st === 'available' && (manualCheck || (modalShownFor !== version && !isSkipped(version)))) openUpdateModal();
  if (manualCheck && st === 'latest') toast(`У вас последняя версия — ${updateStatus.current}`);
  if (manualCheck && st === 'error') toast('Не удалось проверить обновления. Проверьте интернет');
  if (manualCheck && st === 'unsupported') toast('Обновления работают только в установленной версии');
  if (['available', 'latest', 'error', 'unsupported'].includes(st)) manualCheck = false;
  if (st === 'ready' && updateRequested) installUpdate();
  if (st === 'error' && updateRequested) {
    updateRequested = false;
    $('update-error').textContent = 'Не удалось скачать обновление. Проверьте интернет и попробуйте ещё раз.';
  }
  renderUpdate();
}

if (window.desktop?.update) {
  $('about-section').classList.remove('hidden');
  window.desktop.update.onStatus(onUpdateStatus);
  window.desktop.update.status().then(onUpdateStatus).catch(() => {});

  $('update-now').onclick = startUpdate;
  $('update-later').onclick = closeUpdateModal;
  $('update-skip').onclick = () => {
    store.set('skippedUpdate', updateStatus.version);
    closeUpdateModal();
  };
  $('update-btn').onclick = () => (updateStatus.state === 'ready' ? startUpdate() : openUpdateModal());

  // Ручная проверка: если новая версия уже известна — сразу показываем окно
  const checkUpdatesManually = () => {
    if (updateStatus.state === 'ready') return startUpdate();
    if (updateStatus.state === 'available') return openUpdateModal();
    if (updateStatus.state === 'checking' || updateStatus.state === 'downloading') return;
    manualCheck = true;
    window.desktop.update.check();
    renderUpdate();
  };
  $('update-check-btn').onclick = checkUpdatesManually;
  $('sidebar-update-check').classList.remove('hidden');
  $('sidebar-update-check').onclick = checkUpdatesManually;
  $('auth-update-check').onclick = (e) => {
    e.preventDefault();
    checkUpdatesManually();
  };
}

// ---------- Кнопки ----------

$('call-btn').onclick = startCall;
$('hangup-btn').onclick = () => hangup();
$('accept-btn').onclick = acceptIncoming;
$('decline-btn').onclick = declineIncoming;
$('mic-btn').onclick = toggleMute;
$('call-mute').onclick = toggleMute;
$('deafen-btn').onclick = toggleDeafen;
$('call-deafen').onclick = toggleDeafen;
$('settings-btn').onclick = openSettings;
$('settings-cancel').onclick = closeSettings;
$('logout-btn').onclick = () => logout();

$('peer-volume').oninput = (e) => {
  $('remote-audio').volume = e.target.value / 100;
  if (state.call) store.set(`volume:${state.call.peerId}`, Number(e.target.value));
};

window.desktop?.onHotkey((name) => (name === 'toggle-mute' ? toggleMute() : toggleDeafen()));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('settings').classList.contains('hidden')) closeSettings();
});

window.addEventListener('focus', () => {
  if (state.selectedId && state.unread.has(state.selectedId)) {
    state.unread.delete(state.selectedId);
    renderContacts();
  }
});

window.addEventListener('beforeunload', () => hangup());

// ---------- Запуск ----------

async function boot() {
  setAuthMode(false);
  applySpeaker();
  // Пользователь адрес не вводит: всегда общий сервер
  $('server-url').value = DEFAULT_SERVER;
  $('server-url').onchange = () => loadProviders(normalizeServer($('server-url').value));
  loadProviders(isWeb ? location.origin : normalizeServer($('server-url').value));

  let session = store.get('session', null);
  if (session && !isWeb && session.base === SAME_SERVER_OLD) {
    session = { ...session, base: DEFAULT_SERVER };
    store.set('session', session);
  }
  if (session && !isWeb && LEGACY_SERVERS.includes(session.base)) {
    store.set('session', null);
    session = null;
  }
  if (session && (!isWeb || session.base === location.origin)) {
    Api.base = session.base;
    Api.token = session.token;
    try {
      return enterMain(await Api.get('/me'));
    } catch (err) {
      if (err.status === 401) store.set('session', null);
      $('auth-error').textContent = err.status === 401 ? 'Сессия истекла, войдите заново' : err.message;
    }
  }
  showScreen('auth');
}

boot();
