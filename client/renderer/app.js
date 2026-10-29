// Интерфейс: вход, список друзей, чат и звонки. Каналы — в hubs.js, комнаты — в rooms.js, панель разговора — в voice-ui.js

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
  cam: '<svg viewBox="0 0 24 24"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
  camOff: '<svg viewBox="0 0 24 24"><path d="M2 2l20 20M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.7 0H14a2 2 0 0 1 2 2v3.3l1 1L23 7v10"/></svg>',
  screen: '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M12 13V7M9 10l3-3 3 3"/></svg>',
  screenStop: '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M9.5 7.5l5 5M14.5 7.5l-5 5"/></svg>',
  hash: '<svg viewBox="0 0 24 24"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
  volume: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7"/></svg>',
  noise: '<svg viewBox="0 0 24 24"><path d="M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M22 12h0"/></svg>',
  noiseOff: '<svg viewBox="0 0 24 24"><path d="M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M3 3l18 18"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
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
  call: null, // звонок один на один: { session: MediaSession, peerId, peer, callId, phase, connectedAt }
  incoming: null, // { callId, from }
  hubs: new Map(), // id канала -> { id, name, ownerId, iconColor, iconUrl, members, invited, bans }
  hubsLoaded: false, // пока каналы не пришли, раскладку столбца не трогаем
  hubInvites: [], // приглашения в каналы: [{ hub, from, createdAt }]
  view: 'home', // что открыто слева: 'home' — друзья и личные сообщения, иначе id канала
  rooms: new Map(), // id комнаты -> { id, name, kind, hubId, ownerId, members, voice }
  selectedRoomId: null,
  roomHistory: new Map(),
  roomUnread: new Map(),
  room: null, // голосовой канал комнаты: { session, roomId, joined, connectedAt }
  muted: store.get('muted', false),
  deafened: store.get('deafened', false),
  settings: { micId: '', speakerId: '', camId: '', noiseSuppression: true, ...store.get('audio', {}) },
  registerMode: false,
  providers: [], // способы входа, включённые на сервере: [{ id, name }]
  inviteRequired: true, // требует ли сервер код приглашения при регистрации
  pendingSignup: null, // { ticket } — аккаунт сервиса подтверждён, ждём код приглашения
};

const PROVIDER_STYLE = {
  yandex: { label: 'Я', bg: '#fc3f1d', fg: '#ffffff' },
  email: { label: '@', bg: '#3e9cff', fg: '#ffffff' },
};

let socket = null;
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
    const status = typeof online === 'string' ? online : online ? 'online' : 'offline';
    const dot = document.createElement('span');
    dot.className = `status s-${status}${status === 'online' ? ' online' : ''}`;
    dot.title = STATUS[status]?.label || '';
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

// 1 участник, 2 участника, 5 участников
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Человек по id: я, друг, участник одной из комнат или собеседник в звонке
function userById(id) {
  if (state.me?.id === id) return state.me;
  if (state.contacts.has(id)) return state.contacts.get(id);
  for (const group of [...state.rooms.values(), ...state.hubs.values()]) {
    const m = group.members.find((u) => u.id === id);
    if (m) return m;
  }
  if (state.call?.peerId === id) return state.call.peer;
  if (state.call?.people.has(id)) return state.call.people.get(id);
  // Заявки и заблокированные — чтобы и у них открывалась карточка профиля
  return [...state.requests.incoming, ...state.requests.outgoing, ...state.blocked].find((u) => u.id === id) || null;
}

// Статус «в сети» и профиль обновляем везде, где этот человек виден
function updateUser(id, patch) {
  const c = state.contacts.get(id);
  if (c) Object.assign(c, patch);
  for (const group of [...state.rooms.values(), ...state.hubs.values()]) {
    const m = group.members.find((u) => u.id === id);
    if (m) Object.assign(m, patch);
  }
  if (state.call?.peerId === id) Object.assign(state.call.peer, patch);
  renderContacts();
  renderRooms();
  renderMembers();
  if (id === state.selectedId) {
    renderChatHeader();
    renderMessages();
  }
  if (state.selectedRoomId) {
    renderRoomView();
    renderRoomMessages();
  }
  renderVoice();
}

// ---------- Вход и регистрация ----------

// Режимы экрана: 'login' — вход по почте или логину, 'register' — регистрация по почте,
// 'reset' — новый пароль по коду из письма. true / false — то же, что 'register' / 'login'
function setAuthMode(mode) {
  if (typeof mode === 'boolean') mode = mode ? 'register' : 'login';
  state.authMode = mode;
  state.registerMode = mode === 'register';
  state.pendingSignup = null;
  $('auth-code').value = '';
  $('code-hint').textContent = '';
  $('auth-error').textContent = '';
  $('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  renderAuthFields();
}

// Какие поля видны — зависит от режима и от сервера (нужен ли код приглашения, отправляет ли он письма)
function renderAuthFields() {
  if (state.pendingSignup) return;
  const mode = state.authMode || 'login';
  const register = mode === 'register';
  const reset = mode === 'reset';
  $('username-field').classList.toggle('hidden', mode !== 'login');
  $('email-field').classList.toggle('hidden', mode === 'login');
  $('display-field').classList.toggle('hidden', !register);
  $('code-field').classList.toggle('hidden', !reset && !register);
  $('password-field').classList.remove('hidden');
  $('invite-field').classList.toggle('hidden', !register || !state.inviteRequired);
  $('forgot-row').classList.toggle('hidden', mode !== 'login');
  $('auth-forgot').hidden = !state.emailCodes;
  $('password-label').textContent = reset ? 'Новый пароль' : 'Пароль';
  $('auth-title').textContent = register ? 'Создайте аккаунт' : reset ? 'Сброс пароля' : 'Войдите в Созвон';
  $('auth-eyebrow').textContent = register ? 'Первый раз здесь' : reset ? 'Восстановление доступа' : 'С возвращением';
  $('auth-submit').textContent = register ? 'Создать аккаунт' : reset ? 'Сменить пароль' : 'Войти';
  $('auth-subtitle').textContent = register
    ? 'Создайте аккаунт по своей почте — это займёт полминуты'
    : reset
      ? 'Пришлём код на почту, с которой вы регистрировались'
      : 'Войдите, чтобы созвониться с друзьями';
  $('auth-switch-text').textContent = register ? 'Уже есть аккаунт?' : reset ? 'Вспомнили пароль?' : 'Нет аккаунта?';
  $('auth-toggle').textContent = mode === 'login' ? 'Зарегистрироваться' : 'Войти';
  renderOAuthButtons();
}

// Код на почту: для регистрации (если сервер подтверждает почту) и для смены пароля. Повторно — через минуту
let codeTimer = null;

async function sendEmailCode() {
  const base = isWeb ? location.origin : normalizeServer($('server-url').value);
  const email = $('auth-email').value.trim();
  if (!email) {
    $('auth-error').textContent = 'Введите почту';
    $('auth-email').focus();
    return false;
  }
  const button = $('auth-send-code');
  button.disabled = true;
  $('auth-error').textContent = '';
  Api.base = base;
  Api.token = '';
  try {
    if (state.authMode === 'reset') await Api.post('/password/code', { email });
    else await Api.post('/register/code', { email, inviteCode: $('auth-invite').value.trim() });
  } catch (err) {
    $('auth-error').textContent = err.message;
    button.disabled = false;
    return false;
  }
  $('code-hint').textContent = `Код отправлен на ${email}. Если письма нет, проверьте папку «Спам».`;
  $('auth-code').focus();
  let left = 60;
  clearInterval(codeTimer);
  const tick = () => {
    button.textContent = left > 0 ? `Ещё раз через ${left} с` : 'Отправить ещё раз';
    button.disabled = left > 0;
    if (left-- <= 0) clearInterval(codeTimer);
  };
  tick();
  codeTimer = setInterval(tick, 1000);
  return true;
}

$('auth-send-code').onclick = sendEmailCode;
$('auth-forgot').onclick = (e) => {
  e.preventDefault();
  const login = $('auth-username').value.trim();
  setAuthMode('reset');
  if (login.includes('@')) $('auth-email').value = login;
  $('auth-email').focus();
};

// Аккаунт сервиса подтверждён, профиля ещё нет — просим только код приглашения, повторно входить не нужно
function showPendingSignup(ticket, provider) {
  const name = state.providers.find((p) => p.id === provider)?.name || 'сервиса';
  state.inviteRequired = true;
  setAuthMode(true);
  state.pendingSignup = { ticket };
  for (const id of ['username-field', 'email-field', 'code-field', 'password-field', 'display-field', 'oauth-block', 'forgot-row'])
    $(id).classList.add('hidden');
  $('auth-subtitle').textContent = `Аккаунт ${name} подтверждён. Осталось ввести код приглашения — его даёт владелец сервера`;
  $('auth-submit').textContent = 'Создать профиль';
  $('auth-switch-text').textContent = 'Передумали?';
  $('auth-toggle').textContent = 'Назад ко входу';
  $('auth-invite').focus();
}

function finishLogin(base, { token, user, created }) {
  // «Запомнить меня»: без галочки вход действует до закрытия приложения
  const remember = $('auth-remember')?.checked !== false;
  Api.token = token;
  store.set('session', { base, token, remember });
  if (remember) sessionStorage.removeItem('sozvon.tab');
  else sessionStorage.setItem('sozvon.tab', '1');
  store.set('server', base);
  $('auth-password').value = '';
  enterMain(user);
  if (created) toast(`Профиль создан! Ваш логин для друзей: ${user.username}`, 8000);
}

// ---------- Вход через Яндекс ----------

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
  let inviteRequired = true;
  let emailCodes = false;
  // Вход через сервисы работает только в приложении: браузерной версии некуда принять ответ
  if (window.desktop?.oauth && base) {
    try {
      const res = await fetch(`${base}/api/oauth/providers`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) providers = await res.json();
    } catch {}
  }
  // Требует ли сервер код приглашения: если нет, поле кода не показываем
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const health = await res.json();
      inviteRequired = health.inviteRequired !== false;
      emailCodes = health.emailCodes === true;
    }
  } catch {}
  if (request !== providersRequest) return;
  state.providers = providers;
  state.inviteRequired = inviteRequired;
  state.emailCodes = emailCodes;
  renderAuthFields();
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
  $('oauth-block').classList.toggle('hidden', !state.providers.length || state.authMode === 'reset' || Boolean(state.pendingSignup));
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
    finishLogin(base, await runOAuth(provider, 'login', { inviteCode: $('auth-invite').value.trim() }));
  } catch (err) {
    if (err.data?.needInvite) showPendingSignup(err.data.ticket, provider);
    else $('auth-error').textContent = cleanError(err);
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
  setAuthMode(state.authMode === 'login' || !state.authMode ? 'register' : 'login');
};

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const base = isWeb ? location.origin : normalizeServer($('server-url').value);
  const mode = state.authMode || 'login';
  const username = $('auth-username').value.trim();
  const email = $('auth-email').value.trim();
  const code = $('auth-code').value.trim();
  const password = $('auth-password').value;
  const inviteCode = $('auth-invite').value.trim();
  if (!base) return ($('auth-error').textContent = 'Укажите адрес сервера');
  if (state.pendingSignup && !inviteCode) return ($('auth-error').textContent = 'Введите код приглашения');
  if (!state.pendingSignup) {
    if (mode === 'login' && (!username || !password)) return ($('auth-error').textContent = 'Введите почту (или логин) и пароль');
    if (mode !== 'login' && (!email || !password))
      return ($('auth-error').textContent = mode === 'reset' ? 'Введите почту и новый пароль' : 'Введите почту и пароль');
    // Кода ещё нет — сначала отправляем его на почту
    if (!code && mode !== 'login') return sendEmailCode();
  }

  const button = $('auth-submit');
  button.disabled = true;
  $('auth-error').textContent = '';
  Api.base = base;
  Api.token = '';
  try {
    if (state.pendingSignup) {
      finishLogin(base, await Api.post('/signup/complete', { ticket: state.pendingSignup.ticket, inviteCode }));
      return;
    }
    if (mode === 'reset') {
      finishLogin(base, await Api.post('/password/reset', { email, code, password }));
      toast('Пароль изменён');
      return;
    }
    if (mode === 'register') {
      finishLogin(base, await Api.post('/register', { email, password, displayName: $('auth-display').value.trim(), inviteCode, code }));
      return;
    }
    finishLogin(base, await Api.post('/login', { username, password }));
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
  setupE2EE();

  socket = new ServerSocket({
    onMessage: handleEvent,
    onStatus(ok) {
      $('conn-dot').classList.toggle('ok', ok);
      $('conn-dot').title = ok ? 'Подключено к серверу' : 'Нет связи с сервером, переподключаемся…';
      if (ok) {
        refreshContacts();
        refreshHubs();
        refreshRooms();
        sendAutoStatus();
      } else if (state.call) {
        finishCall('Связь с сервером прервалась, звонок завершён');
      }
      onVoiceSocketStatus(ok);
    },
    onUnauthorized: () => logout('Сессия истекла, войдите заново'),
  });
  socket.connect();
}

async function refreshContacts() {
  try {
    const list = await Api.get('/contacts');
    state.contacts = new Map(list.map((c) => [c.id, c]));
    noteKeys(list);
    renderContacts();
    refreshFriendRequests();
    if (state.selectedId && !state.contacts.has(state.selectedId)) selectContact(null);
    else if (state.selectedId) renderChatHeader();
  } catch (err) {
    toast(err.message);
  }
}

function logout(message) {
  hangup();
  leaveRoomVoice();
  if (state.incoming) declineIncoming();
  socket?.close();
  socket = null;
  store.set('session', null);
  resetE2EE();
  Object.assign(state, {
    me: null,
    selectedId: null,
    contacts: new Map(),
    history: new Map(),
    unread: new Map(),
    hubs: new Map(),
    hubsLoaded: false,
    hubInvites: [],
    view: 'home',
    rooms: new Map(),
    selectedRoomId: null,
    roomHistory: new Map(),
    roomUnread: new Map(),
    requests: { incoming: [], outgoing: [] },
    blocked: [],
  });
  for (const id of ['room-create', 'room-manage', 'room-invite', 'room-kick', 'screen-picker', ...HUB_MODALS]) $(id).classList.add('hidden');
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
  fillAvatar(av, me, myStatus());
  $('me-status-btn').title = `Статус: ${STATUS[myStatus()].label}. Нажмите, чтобы сменить`;
  renderNotifBadge();
  $('me-name').textContent = me.displayName;
  $('me-info').dataset.profile = me.id;
  // Под именем — логин, а если статус не «Активен» — сам статус, чтобы было видно, что он включён
  $('me-username').textContent = myStatus() === 'online' ? `@${me.username}` : STATUS[myStatus()].label;
  $('empty-username').textContent = me.username;
}

function renderContacts() {
  const list = $('contact-list');
  list.replaceChildren();
  const sorted = [...state.contacts.values()].sort(
    (a, b) => isAvailable(b) - isAvailable(a) || a.displayName.localeCompare(b.displayName, 'ru')
  );
  $('contact-count').textContent = sorted.length;

  if (!sorted.length) {
    const li = document.createElement('li');
    li.className = 'muted small pad';
    li.textContent = 'Пока никого. Добавьте друга по логину в разделе «Друзья» выше.';
    list.append(li);
  }
  renderFriends();

  for (const c of sorted) {
    const li = document.createElement('li');
    li.className = `contact${c.id === state.selectedId ? ' active' : ''}${isAvailable(c) ? '' : ' offline'}`;
    li.dataset.contact = c.id;
    li.append(makeAvatar(c, presenceOf(c)));

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
      sub.textContent = STATUS[presenceOf(c)].sub;
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

$('remove-contact-btn').onclick = async () => {
  const c = state.contacts.get(state.selectedId);
  if (!c || !(await ask(`Удалить ${c.displayName} из друзей?`, { title: 'Удалить из друзей?', ok: 'Удалить', danger: true }))) return;
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
  state.view = 'home';
  state.selectedId = id;
  state.selectedRoomId = null;
  state.unread.delete(id);
  renderContacts();
  renderRooms();

  const contact = state.contacts.get(id);
  $('empty-state').classList.toggle('hidden', Boolean(contact));
  $('chat').classList.toggle('hidden', !contact);
  $('room-view').classList.add('hidden');
  renderHubChrome();
  renderVoice();
  if (!contact) return;

  renderChatHeader();
  renderMessages();
  dmComposer.focus();

  if (!state.history.has(id)) {
    try {
      const loaded = await Api.get(`/messages/${id}`);
      await decryptMessages(loaded, dmConvOf(id));
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
  av.dataset.profile = c.id;
  $('peer-name').dataset.profile = c.id;
  fillAvatar(av, c, presenceOf(c));
  $('peer-name').textContent = c.displayName;
  $('peer-status').textContent = `@${c.username} · ${STATUS[presenceOf(c)].sub.toLowerCase()}`;
  const busy = Boolean(state.call || state.incoming);
  $('call-btn').classList.toggle('hidden', state.call?.peerId === c.id);
  $('call-btn').disabled = !isAvailable(c) || busy;
  $('call-btn').title = !isAvailable(c) ? 'Друг не в сети' : busy ? 'Вы уже в звонке' : 'Звонок — камеру и экран можно включить во время разговора';
}

// ---------- Сообщения ----------

function renderMessages() {
  const peerId = state.selectedId;
  renderMessageList(
    $('messages'),
    state.history.get(peerId) || [],
    state.history.has(peerId),
    'Здесь пока пусто. Напишите что-нибудь или позвоните!',
    // В личной переписке удалить можно только своё
    {
      chat: { kind: 'dm', peerId },
      canDelete: (m) => m.fromId === state.me.id,
      remove: (m) => Api.del(`/messages/${peerId}/${m.id}`),
    }
  );
  refreshPinned({ kind: 'dm', peerId });
}

/** Сообщение удалили (здесь или на другом устройстве) — убираем из истории и с экрана */
function dropMessage(history, key, id) {
  const list = history.get(key);
  const i = list ? list.findIndex((m) => m.id === id) : -1;
  if (i >= 0) list.splice(i, 1);
  return i >= 0;
}

// ---------- Реакции, правка и закреп ----------

const QUICK_REACTIONS = [
  '👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '👀',
  '😍', '🤔', '😅', '😡', '🥳', '😴', '🤝', '👏',
  '💪', '🙏', '✅', '❌', '⭐', '💯', '🚀', '☕',
  '🍻', '🎮', '🎧', '🐱', '🐶', '🌟', '💡', '🥲',
  '😎', '🤯', '🥶', '🤗', '😇', '🙃', '😜', '🤪',
  '🥰', '😱', '🤤', '🤑', '🧠', '🫡', '🍕', '🎂',
];

/** Адрес действия над сообщением: личный чат или комната */
function chatPath(chat, m, tail = '') {
  return chat.kind === 'dm'
    ? `/messages/${chat.peerId}/${m.id}${tail}`
    : `/rooms/${chat.roomId}/messages/${m.id}${tail}`;
}

function refreshChat(chat) {
  if (chat.kind === 'dm' && state.selectedId === chat.peerId) renderMessages();
  else if (chat.kind === 'room' && state.selectedRoomId === chat.roomId) renderRoomMessages();
}

async function toggleReaction(m, chat, emoji) {
  try {
    m.reactions = await Api.post(chatPath(chat, m, '/reactions'), { emoji });
    refreshChat(chat);
  } catch (err) {
    toast(err.message);
  }
}

let reactionPop = null;

function closeReactionPicker() {
  if (reactionPop) {
    reactionPop.remove();
    reactionPop = null;
  }
}

function openReactions(m, chat, anchor) {
  closeReactionPicker();
  const pop = document.createElement('div');
  pop.className = 'reaction-pop';
  for (const emoji of QUICK_REACTIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = emoji;
    b.onclick = (e) => {
      e.stopPropagation();
      closeReactionPicker();
      toggleReaction(m, chat, emoji);
    };
    pop.append(b);
  }
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8))}px`;
  reactionPop = pop;
}

document.addEventListener('click', () => closeReactionPicker());

/** Пересылка: расшифрованный текст шифруем заново ключом целевой переписки — сервер не участвует */
async function forwardMessage(m) {
  const text = m.plain?.text || '';
  if (!text) {
    toast('Пока пересылаются только текстовые сообщения');
    return;
  }
  const target = await pickForwardTarget();
  if (!target) return;
  try {
    const conv = target.kind === 'dm' ? dmConvOf(target.id) : roomConvOf(target.id);
    const { body, plain } = await encryptOutgoing(conv, { text });
    if (target.kind === 'dm') addMessage({ ...(await Api.post(`/messages/${target.id}`, body)), plain });
    else addRoomMessage({ ...(await Api.post(`/rooms/${target.id}/messages`, body)), plain });
    toast(`Переслано: ${target.name}`);
  } catch (err) {
    toast(err.message);
  }
}

function pickForwardTarget() {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="modal-card forward-card">
        <h3>Переслать сообщение</h3>
        <input class="forward-search" type="search" placeholder="Кому переслать" />
        <div class="forward-list"></div>
        <div class="row"><span class="spacer"></span><button type="button" class="btn" data-cancel>Отмена</button></div>
      </div>`;
    const list = wrap.querySelector('.forward-list');
    const items = [
      ...[...state.contacts.values()].map((u) => ({ kind: 'dm', id: u.id, name: u.displayName, sub: 'личный чат' })),
      ...[...state.rooms.values()].map((r) => ({ kind: 'room', id: r.id, name: r.name, sub: 'комната' })),
    ];
    const finish = (value) => {
      wrap.remove();
      resolve(value);
    };
    const draw = (filter = '') => {
      list.replaceChildren();
      const found = items.filter((i) => i.name.toLowerCase().includes(filter.trim().toLowerCase()));
      for (const item of found) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'forward-item';
        const name = document.createElement('span');
        name.textContent = item.name;
        const sub = document.createElement('span');
        sub.className = 'forward-sub';
        sub.textContent = item.sub;
        b.append(name, sub);
        b.onclick = () => finish(item);
        list.append(b);
      }
      if (!found.length) list.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Никого не нашли' }));
    };
    wrap.querySelector('[data-cancel]').onclick = () => finish(null);
    wrap.onclick = (e) => e.target === wrap && finish(null);
    wrap.querySelector('.forward-search').oninput = (e) => draw(e.target.value);
    draw();
    document.body.append(wrap);
    wrap.querySelector('.forward-search').focus();
  });
}

/** Начать ответ: цитата попадёт внутрь шифрованного конверта */
function startReply(m, chat) {
  setReplyDraft({ id: m.id, fromId: m.fromId, text: m.plain?.text || '' }, chat);
}

/** Правка: новый конверт с новым текстом, сервер текста не видит */
async function editMessage(m, chat) {
  const next = await askText('Изменить сообщение', m.plain?.text || '');
  if (next == null) return;
  const text = next.trim();
  if (!text || text === m.plain?.text) return;
  try {
    const conv = chat.kind === 'dm' ? dmConvOf(chat.peerId) : roomConvOf(chat.roomId);
    const { body } = await encryptOutgoing(conv, { text });
    const updated = await Api.patch(chatPath(chat, m), { enc: body.enc });
    Object.assign(m, updated, { plain: { ...(m.plain || {}), text } });
    refreshChat(chat);
  } catch (err) {
    toast(err.message);
  }
}

async function togglePin(m, chat) {
  try {
    if (m.pinned) await Api.del(chatPath(chat, m, '/pin'));
    else await Api.put(chatPath(chat, m, '/pin'), {});
    m.pinned = !m.pinned;
    refreshChat(chat);
    refreshPinned(chat);
  } catch (err) {
    toast(err.message);
  }
}

/** Текст сообщения из уже расшифрованной истории — для полосы закрепа */
function loadedText(chat, id) {
  const list = chat.kind === 'dm' ? state.history.get(chat.peerId) : state.roomHistory.get(chat.roomId);
  const found = list?.find((x) => x.id === id);
  return found ? { fromId: found.fromId, text: found.plain?.text || '' } : null;
}

async function refreshPinned(chat) {
  const path = chat.kind === 'dm' ? `/messages/${chat.peerId}/pins` : `/rooms/${chat.roomId}/pins`;
  let list = [];
  try {
    list = await Api.get(path);
  } catch {
    list = [];
  }
  const bar = $(chat.kind === 'dm' ? 'chat-pinned' : 'room-pinned');
  if (!bar) return;
  if (!list.length) {
    bar.classList.add('hidden');
    bar.replaceChildren();
    bar.onclick = null;
    return;
  }
  const first = list[0];
  const known = loadedText(chat, first.id) || { fromId: first.fromId, text: '' };
  const author = userById(known.fromId) || { displayName: '?' };
  const label = document.createElement('b');
  label.textContent = 'Закреплено';
  const text = document.createElement('span');
  text.className = 'pin-text';
  text.textContent = `${author.displayName}: ${known.text || 'сообщение'}`;
  const unpin = document.createElement('button');
  unpin.type = 'button';
  unpin.className = 'unpin';
  unpin.title = 'Открепить';
  unpin.textContent = '×';
  unpin.onclick = (e) => {
    e.stopPropagation();
    togglePin(first, chat);
  };
  bar.replaceChildren(label, text, unpin);
  bar.classList.remove('hidden');
  bar.onclick = () => toast(`${author.displayName}: ${known.text || 'сообщение'}`);
}

// Корзина у сообщения: Shift — удалить сразу, без вопроса
async function deleteMessage(m, remove, skipConfirm) {
  if (!skipConfirm && !(await ask('Его больше не увидит никто. Совет: с Shift сообщение удаляется сразу, без этого вопроса.', { title: 'Удалить сообщение?', ok: 'Удалить', danger: true }))) return;
  try {
    await remove(m);
  } catch (err) {
    toast(err.message);
  }
}

// Что уже было на экране в каждой ленте: анимируем только новые сообщения той же переписки,
// а не всю ленту при каждой перерисовке и не чужую переписку при переключении
const shownMessages = new WeakMap();

/** Данные цитаты ответа: снимок из конверта, иначе — сообщение из загруженной ленты */
function replyOf(m, list) {
  const snap = m.plain?.reply;
  const id = snap?.id || m.replyTo;
  if (!id) return null;
  const source = snap || list.find((x) => x.id === id);
  if (!source) return null;
  return { id, fromId: source.fromId, text: source.text || '' };
}

function replyQuote(reply) {
  const el = document.createElement('div');
  el.className = 'msg-reply';
  const name = document.createElement('b');
  name.textContent = (userById(reply.fromId) || { displayName: '?' }).displayName;
  const text = document.createElement('span');
  text.textContent = reply.text || 'вложение';
  el.append(name, text);
  el.onclick = (e) => {
    e.stopPropagation();
    const target = el.closest('.messages')?.querySelector(`[data-msg-id="${reply.id}"]`);
    if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  return el;
}

function reactionsView(m) {
  if (!m.reactions?.length) return null;
  const row = document.createElement('div');
  row.className = 'msg-reactions';
  for (const r of m.reactions) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `reaction-chip${r.mine ? ' mine' : ''}`;
    chip.textContent = `${r.emoji} ${r.count}`;
    chip.title = r.mine ? 'Убрать реакцию' : 'Поставить реакцию';
    chip.dataset.emoji = r.emoji;
    row.append(chip);
  }
  return row;
}

// Лента сообщений: и для чата с другом, и для комнаты
/** actions: { canDelete(m), remove(m) } — можно ли удалить сообщение и как */
function renderMessageList(box, list, loaded, emptyText, actions) {
  const before = shownMessages.get(box);
  // Ту же переписку листают вверх — после перерисовки остаёмся на месте, а не прыгаем вниз.
  // Своё новое сообщение — всегда вниз, к нему
  const sentNow = before?.list === list && list.some((m) => !before.ids.has(m.id) && m.fromId === state.me.id);
  const keepScroll = before?.list === list && !nearBottom(box) && !sentNow;
  const scrollTop = box.scrollTop;
  box.replaceChildren();
  const isNew = (m) => before?.list === list && !before.ids.has(m.id);
  shownMessages.set(box, { list, ids: new Set(list.map((m) => m.id)) });

  if (!list.length) {
    // Пустая переписка — Совон; пока грузим — просто «Загрузка…»
    if (loaded) box.append(mascot('Здесь пока тихо', emptyText));
    else box.append(Object.assign(document.createElement('div'), { className: 'hint', textContent: 'Загрузка…' }));
    jumpBar(box).classList.add('hidden');
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
    const author = userById(m.fromId) || { displayName: '?', avatarColor: '#555' };
    const continued = !newDay && prev.fromId === m.fromId && m.createdAt - prev.createdAt < 5 * 60_000;

    const row = document.createElement('div');
    row.className = `msg${continued ? ' cont' : ''}${isNew(m) ? ' msg-new' : ''}`;
    row.dataset.msgId = m.id;
    // Для меню по правой кнопке: само сообщение и что с ним можно сделать в этой ленте
    row.message = m;
    row.actions = actions;
    const avatar = makeAvatar(author);
    if (author.id) avatar.dataset.profile = author.id;
    row.append(avatar);
    const body = document.createElement('div');
    body.className = 'msg-body';
    if (!continued) {
      const head = document.createElement('div');
      head.className = 'msg-head';
      const name = document.createElement('b');
      name.textContent = author.displayName;
      name.style.color = author.avatarColor;
      if (author.id) name.dataset.profile = author.id;
      const time = document.createElement('time');
      time.textContent = formatTime(m.createdAt);
      head.append(name, time);
      body.append(head);
    }
    const reply = replyOf(m, list);
    if (reply) body.append(replyQuote(reply));
    body.append(messageContent(m));
    if (m.editedAt) {
      const edited = document.createElement('span');
      edited.className = 'msg-edited';
      edited.textContent = '(изменено)';
      body.append(edited);
    }
    const chips = reactionsView(m);
    if (chips) body.append(chips);
    row.append(body);
    if (actions?.chat) {
      const tools = document.createElement('div');
      tools.className = 'msg-tools';
      const tool = (title, svg, fn, extra = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `msg-tool${extra}`;
        b.title = title;
        b.innerHTML = svg;
        b.onclick = fn;
        tools.append(b);
      };
      tool('Ответить', '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 7 7v3"/></svg>', (e) => {
        e.stopPropagation();
        startReply(m, actions.chat);
      });
      tool('Переслать', '<svg viewBox="0 0 24 24"><path d="M15 14 20 9l-5-5"/><path d="M20 9h-9a7 7 0 0 0-7 7v3"/></svg>', (e) => {
        e.stopPropagation();
        forwardMessage(m);
      });
      tool('Реакция', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0"/><path d="M9 9h.01M15 9h.01"/></svg>', (e) => {
        e.stopPropagation();
        openReactions(m, actions.chat, e.currentTarget);
      });
      if (m.fromId === state.me.id)
        tool('Изменить', '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>', (e) => {
          e.stopPropagation();
          editMessage(m, actions.chat);
        });
      tool(
        m.pinned ? 'Открепить' : 'Закрепить',
        '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v6"/></svg>',
        (e) => {
          e.stopPropagation();
          togglePin(m, actions.chat);
        }
      );
      if (actions.canDelete(m))
        tool('Удалить (с Shift — без вопроса)', '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>', (e) => {
          deleteMessage(m, actions.remove, e.shiftKey);
        }, ' danger');
      row.append(tools);
    }
    box.append(row);
    prev = m;
  }
  const bar = jumpBar(box);
  if (keepScroll) {
    box.scrollTop = scrollTop;
    if (list.some(isNew)) bar.classList.add('fresh');
  } else box.scrollTop = box.scrollHeight;
  syncJumpBar(box);
}

const nearBottom = (box) => box.scrollHeight - box.scrollTop - box.clientHeight < 120;

// «Перейти к последним»: полоса над полем ввода, пока ленту листают вверх; ниже есть новые — она яркая
function jumpBar(box) {
  if (box.jumpBar) return box.jumpBar;
  const bar = document.createElement('button');
  bar.type = 'button';
  bar.className = 'jump-bar hidden';
  bar.innerHTML = '<span></span><b>Перейти к последним <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg></b>';
  bar.onclick = () => {
    box.scrollTop = box.scrollHeight;
    syncJumpBar(box);
  };
  box.after(bar);
  box.addEventListener('scroll', () => syncJumpBar(box));
  box.jumpBar = bar;
  return bar;
}

function syncJumpBar(box) {
  const bar = jumpBar(box);
  const atBottom = nearBottom(box);
  if (atBottom) bar.classList.remove('fresh');
  bar.classList.toggle('hidden', atBottom);
  bar.firstChild.textContent = bar.classList.contains('fresh') ? 'Ниже новые сообщения' : 'Вы смотрите старые сообщения';
}

function addMessage(m) {
  const peerId = m.fromId === state.me.id ? m.toId : m.fromId;
  const list = state.history.get(peerId);
  // Своё сообщение приходит дважды (ответ на отправку и событие) — храним одно, с расшифровкой
  const known = list?.find((x) => x.id === m.id);
  if (known) {
    known.plain ??= m.plain;
    m = known;
  } else list?.push(m);
  decryptMessages([m], dmConvOf(peerId)).then(() => showNewMessage(m, peerId));
}

function showNewMessage(m, peerId) {
  if (m.fromId === state.me.id) {
    if (peerId === state.selectedId) renderMessages();
    return;
  }

  const visible = peerId === state.selectedId && document.hasFocus();
  if (peerId === state.selectedId) renderMessages();
  if (!visible) {
    if (peerId !== state.selectedId) state.unread.set(peerId, (state.unread.get(peerId) || 0) + 1);
    renderContacts();
    notify(state.contacts.get(peerId)?.displayName || 'Новое сообщение', messageSummary(m), { kind: 'message', open: { contact: peerId } });
  }
}

// ---------- События с сервера ----------

const END_REASONS = {
  declined: 'Собеседник отклонил звонок',
  timeout: 'Собеседник не ответил',
  hangup: 'Звонок завершён',
  disconnected: 'Собеседник отключился',
  'old-version': 'Это групповой звонок — обновите Созвон, чтобы к нему присоединиться',
};

// Почему не получилось позвать человека в звонок
const ADD_FAILED = {
  'not-contact': 'Позвать в звонок можно только друга',
  offline: 'не в сети',
  busy: 'уже разговаривает',
  full: 'В звонке уже 10 человек — больше не поместится',
  'old-version': 'У кого-то в звонке старая версия Созвона — пусть обновится, и тогда можно будет звать',
};

const UNAVAILABLE_REASONS = {
  offline: 'Друг не в сети',
  busy: 'Друг сейчас разговаривает',
  'not-contact': 'Этот человек не в списке друзей',
};

function handleEvent(msg) {
  switch (msg.type) {
    case 'presence':
      return updateUser(msg.userId, { online: msg.online, status: msg.status || (msg.online ? 'online' : 'offline') });
    case 'me:status':
      return onMyStatus(msg.status);
    case 'contact:added':
      // accepted — это вы сами приняли заявку (с этого или другого устройства)
      dropRequest(msg.user.id);
      state.contacts.set(msg.user.id, msg.user);
      renderContacts();
      if (!msg.accepted)
        notify('Новый друг', `${msg.user.displayName} принял(а) вашу заявку в друзья`, { kind: 'friend', open: { contact: msg.user.id } });
      return;
    case 'friend:request':
      return onFriendRequest(msg.user);
    case 'friend:request:removed':
      return onFriendRequestRemoved(msg.userId);
    case 'contact:removed':
      state.contacts.delete(msg.userId);
      state.history.delete(msg.userId);
      if (state.selectedId === msg.userId) selectContact(null);
      else renderContacts();
      return;
    case 'user:updated':
      onUserKey(msg.user);
      return updateUser(msg.user.id, msg.user);
    case 'keys:updated':
      return refreshConv(msg.conv);
    case 'message':
      return addMessage(msg.message);
    case 'message:deleted': {
      const peerId = msg.fromId === state.me.id ? msg.toId : msg.fromId;
      if (dropMessage(state.history, peerId, msg.id) && peerId === state.selectedId) renderMessages();
      return;
    }
    case 'message:edited': {
      const peerId = msg.message.fromId === state.me.id ? msg.message.toId : msg.message.fromId;
      const list = state.history.get(peerId) || [];
      const i = list.findIndex((x) => x.id === msg.message.id);
      if (i >= 0) {
        list[i] = { ...list[i], ...msg.message, plain: list[i].plain };
        decryptMessages([list[i]], dmConvOf(peerId)).then(() => {
          if (peerId === state.selectedId) renderMessages();
        });
      }
      return;
    }
    case 'message:reactions': {
      const found = (state.history.get(msg.peerId) || []).find((x) => x.id === msg.id);
      if (found) found.reactions = msg.reactions;
      if (msg.peerId === state.selectedId) renderMessages();
      return;
    }
    case 'message:pinned': {
      const found = (state.history.get(msg.peerId) || []).find((x) => x.id === msg.id);
      if (found) found.pinned = msg.pinned;
      if (msg.peerId === state.selectedId) {
        renderMessages();
        refreshPinned({ kind: 'dm', peerId: msg.peerId });
      }
      return;
    }
    case 'call:incoming':
      return onIncoming(msg);
    case 'call:ringing':
      if (state.call && !state.call.callId) state.call.callId = msg.callId;
      // Звонок отменили раньше, чем сервер успел его создать
      else socket.send({ type: 'call:hangup', callId: msg.callId });
      return;
    case 'call:accepted':
      if (state.call?.callId !== msg.callId) return;
      tone.stop();
      state.call.phase = 'connecting';
      state.call.session.addPeer(state.call.peerId, true);
      renderVoice();
      return;
    case 'call:unavailable':
      if (state.call && !state.call.callId) finishCall(UNAVAILABLE_REASONS[msg.reason] || 'Не удалось позвонить');
      return;
    case 'call:ended':
      return onCallEnded(msg);
    case 'signal':
      // from есть у сервера 2.2+; без него сигнал — от единственного собеседника
      if (state.call?.callId === msg.callId) state.call.session.handleSignal(msg.from ?? state.call.peerId, msg.data);
      return;
    case 'call:joined':
      return onCallJoined(msg);
    case 'call:member':
      return onCallMember(msg);
    case 'call:add:failed': {
      const who = userById(msg.to)?.displayName || 'Друг';
      const text = ADD_FAILED[msg.reason] || 'Не удалось позвать';
      return toast(/^[а-яё]/.test(text) ? `${who} ${text}` : text);
    }
    default:
      if (msg.type.startsWith('room:')) handleRoomEvent(msg);
      else if (msg.type.startsWith('hub:')) handleHubEvent(msg);
  }
}

// ---------- Звонки один на один ----------

function newCall(peer, callId, phase) {
  // people — все, кто в звонке или кому звонят: имена и аватарки для плиток
  const call = { peerId: peer.id, peer: { ...peer }, people: new Map([[peer.id, peer]]), callId, phase, connectedAt: null, failTimer: null };
  // Сигналы уходят, только когда сервер уже выдал номер звонка; to — кому из участников
  call.session = newSession((id, data) => call.callId && socket?.send({ type: 'signal', callId: call.callId, to: id, data }));
  state.call = call;
  renderVoice();
  renderChatHeader();
  renderContacts();
  renderRail();
  return call;
}

async function startCall() {
  const peer = state.contacts.get(state.selectedId);
  if (!peer || state.call || state.incoming) return;
  if (!isAvailable(peer)) return toast('Друг не в сети');
  if (state.room) {
    if (!(await ask('Вы в голосовой комнате. Выйти из неё и позвонить?', { title: 'Позвонить?', ok: 'Выйти и позвонить' }))) return;
    leaveRoomVoice();
  }

  const call = newCall(peer, null, 'calling');
  try {
    await call.session.start(audioFlags());
  } catch (err) {
    return finishCall(mediaErrorText(err));
  }
  if (state.call !== call) return; // отменили, пока ждали микрофон
  // group: эта версия умеет групповые звонки — в такой звонок можно будет позвать ещё людей
  if (!socket.send({ type: 'call:invite', to: peer.id, group: true })) return finishCall('Нет связи с сервером');
  tone.loop('ringback');
}

function onIncoming({ callId, from, group = false, others = [] }) {
  if (state.call || state.incoming) return socket.send({ type: 'call:decline', callId });
  state.incoming = { callId, from, group, others };
  const peer = state.contacts.get(from.id) || from;
  const av = $('incoming-avatar');
  av.replaceChildren();
  fillAvatar(av, peer);
  $('incoming-name').textContent = peer.displayName;
  // Групповой звонок: кто уже разговаривает
  const names = others.filter((u) => u.id !== from.id).map((u) => u.displayName);
  $('incoming-sub').textContent = group
    ? `Зовёт в звонок${names.length ? ` — там уже ${names.join(', ')}` : ''}`
    : 'Входящий звонок…';
  $('incoming').classList.remove('hidden');
  renderChatHeader();
  if (doNotDisturb()) return;
  tone.loop('ring');
  window.desktop?.focus();
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
  const call = newCall(peer, inc.callId, 'connecting');
  for (const u of inc.others) call.people.set(u.id, state.contacts.get(u.id) || u);
  if (state.contacts.has(peer.id)) selectContact(peer.id);
  try {
    await call.session.start(audioFlags());
  } catch (err) {
    socket.send({ type: 'call:decline', callId: inc.callId });
    return finishCall(mediaErrorText(err));
  }
  if (state.call !== call) return;
  // В звонок на двоих предложение соединения пришлёт звонивший — ждём его.
  // В групповой — сервер скажет, с кем соединяться (call:joined), и предлагаем мы
  if (!inc.group) call.session.addPeer(peer.id, false);
  socket.send({ type: 'call:accept', callId: inc.callId, group: true });
}

/** Нас добавили в групповой звонок: соединяемся с каждым, кто уже там */
function onCallJoined({ callId, peers }) {
  const call = state.call;
  if (call?.callId !== callId) return;
  for (const id of peers) call.session.addPeer(id, true);
  renderVoice();
  renderRail();
}

/** Кто-то вошёл в звонок, вышел, ему звонят или он отказался */
function onCallMember({ callId, userId, state: st, user }) {
  const call = state.call;
  if (call?.callId !== callId) return;
  if (user) call.people.set(userId, state.contacts.get(userId) || user);
  const name = userById(userId)?.displayName || 'Собеседник';
  if (st === 'joined') {
    tone.blip('join');
    toast(`${name} в звонке`);
  } else if (st === 'left') {
    call.session.removePeer(userId);
    tone.blip('leave');
    toast(`${name} вышел из звонка`);
  } else if (st === 'ringing') {
    toast(`Звоним ${name}…`);
  } else if (st === 'declined' || st === 'missed') {
    toast(st === 'declined' ? `${name} не может присоединиться` : `${name} не ответил`);
  }
  renderVoice();
  renderRail();
  if (!$('call-add-modal').classList.contains('hidden')) renderCallAdd();
}

// ---------- Позвать в звонок ----------

function openCallAdd() {
  if (!state.call) return;
  $('call-add-search').value = '';
  renderCallAdd();
  $('call-add-modal').classList.remove('hidden');
  $('call-add-search').focus();
}

function renderCallAdd() {
  const call = state.call;
  if (!call) return $('call-add-modal').classList.add('hidden');
  const q = $('call-add-search').value.trim().toLowerCase();
  const inCall = new Set([...call.session.peers.keys(), call.peerId]);
  const friends = [...state.contacts.values()]
    .filter((c) => !q || `${c.displayName} ${c.username}`.toLowerCase().includes(q))
    .sort((a, b) => isAvailable(b) - isAvailable(a) || a.displayName.localeCompare(b.displayName, 'ru'));
  const list = $('call-add-list');
  list.replaceChildren();
  if (!friends.length) list.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: state.contacts.size ? 'Никого не нашли' : 'Позвать можно только друзей, а их пока нет' }));
  for (const f of friends) {
    const row = document.createElement('div');
    row.className = 'member-row';
    const info = document.createElement('div');
    info.className = 'grow ellipsis';
    info.innerHTML = '<div class="ellipsis"></div><div class="muted small"></div>';
    info.firstChild.textContent = f.displayName;
    info.lastChild.textContent = inCall.has(f.id) ? 'Уже в звонке' : STATUS[presenceOf(f)].sub;
    row.append(makeAvatar(f, presenceOf(f), 'small'), info);
    if (!inCall.has(f.id)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn primary';
      b.textContent = 'Позвать';
      b.disabled = !isAvailable(f);
      b.onclick = () => {
        socket.send({ type: 'call:add', callId: call.callId, to: f.id });
        call.people.set(f.id, f);
        b.disabled = true;
        b.textContent = 'Звоним…';
      };
      row.append(b);
    }
    list.append(row);
  }
}

$('call-add').onclick = openCallAdd;
$('call-add-search').oninput = renderCallAdd;
$('call-add-close').onclick = () => $('call-add-modal').classList.add('hidden');

function declineIncoming() {
  if (!state.incoming) return;
  socket?.send({ type: 'call:decline', callId: state.incoming.callId });
  hideIncoming();
}

function onCallEnded({ callId, reason }) {
  if (state.incoming?.callId === callId) {
    const { from } = state.incoming;
    const name = from.displayName;
    hideIncoming();
    if (reason !== 'answered-elsewhere') {
      toast(`Пропущенный звонок от ${name}`);
      notify('Пропущенный звонок', name, { kind: 'missed', open: { contact: state.contacts.has(from.id) ? from.id : null } });
    }
    return;
  }
  if (state.call?.callId === callId) finishCall(END_REASONS[reason] || 'Звонок завершён');
}

function hangup(message) {
  const c = state.call;
  if (!c) return;
  if (c.callId) socket?.send({ type: 'call:hangup', callId: c.callId });
  finishCall(message);
}

function finishCall(message) {
  const c = state.call;
  if (!c) return;
  state.call = null;
  clearTimeout(c.failTimer);
  c.session.close();
  $('call-add-modal').classList.add('hidden');
  renderRail();
  tone.stop();
  tone.blip('end');
  renderVoice();
  renderChatHeader();
  renderContacts();
  if (message) toast(message);
}

// ---------- Микрофон и звук ----------

function applyAudioState() {
  const { muted: micOff, deafened } = audioFlags();
  activeSession()?.setMuted(micOff, deafened);
  for (const id of ['mic-btn', 'call-mute']) {
    $(id).innerHTML = micOff ? ICONS.micOff : ICONS.mic;
    $(id).classList.toggle('off', micOff);
    $(id).title = forcedMute()
      ? 'В этой комнате вам нельзя говорить'
      : micOff
        ? 'Включить микрофон (Ctrl+Shift+M)'
        : 'Выключить микрофон (Ctrl+Shift+M)';
  }
  for (const id of ['deafen-btn', 'call-deafen']) {
    $(id).innerHTML = deafened ? ICONS.soundOff : ICONS.sound;
    $(id).classList.toggle('off', deafened);
    $(id).title = deafened ? 'Включить звук (Ctrl+Shift+D)' : 'Выключить звук — вы перестанете слышать остальных (Ctrl+Shift+D)';
  }
  store.set('muted', state.muted);
  store.set('deafened', state.deafened);
}

function toggleMute() {
  if (forcedMute()) return toast('В этой комнате вам нельзя говорить');
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

function applySpeaker() {
  tone.sinkId = state.settings.speakerId || '';
  activeSession()?.setSink(tone.sinkId);
}

// ---------- Настройки ----------

let pickedColor = null;
let pickedBanner = null;

async function fillDeviceSelect(select, kind, selected) {
  let devices = await navigator.mediaDevices.enumerateDevices();
  // Без разрешения на микрофон названия устройств пустые — запрашиваем его один раз.
  // Камеру ради названий не включаем: они появятся после «Проверить камеру»
  if (kind !== 'videoinput' && devices.some((d) => d.kind === kind && !d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {}
  }
  select.replaceChildren(new Option('По умолчанию', ''));
  let n = 0;
  for (const d of devices) {
    if (d.kind !== kind || d.deviceId === 'default' || d.deviceId === 'communications') continue;
    n++;
    select.append(new Option(d.label || (kind === 'videoinput' ? `Камера ${n}` : 'Устройство'), d.deviceId));
  }
  select.value = [...select.options].some((o) => o.value === selected) ? selected : '';
}

/** Ряд кружков с цветами; null — «как у аватара» */
function colorChoices(box, colors, current, onPick) {
  box.replaceChildren();
  for (const color of colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `color${color === current ? ' selected' : ''}${color ? '' : ' auto'}`;
    b.style.background = color || pickedColor;
    if (!color) b.title = 'Как у аватара';
    b.onclick = () => onPick(color);
    box.append(b);
  }
}

function renderColorPicker() {
  colorChoices($('color-picker'), COLORS, pickedColor, (color) => {
    pickedColor = color;
    renderColorPicker();
  });
  colorChoices($('banner-picker'), [null, ...COLORS], pickedBanner, (color) => {
    pickedBanner = color;
    renderColorPicker();
  });
}

function renderIdentities() {
  const list = $('identity-list');
  list.replaceChildren();
  list.append(emailIdentityRow());

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

// Почта: привязать (адрес + код из письма) или отвязать. По почте входят с паролем профиля
function emailIdentityRow() {
  const email = state.me.email;
  const row = document.createElement('div');
  row.className = 'identity-row';
  const info = document.createElement('div');
  const name = document.createElement('div');
  name.textContent = 'Почта';
  const sub = document.createElement('div');
  sub.className = 'muted small ellipsis';
  sub.textContent = email
    ? state.me.hasPassword
      ? email
      : `${email} — чтобы входить по почте, задайте пароль ниже`
    : 'не привязана';
  info.append(name, sub);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = email ? 'btn danger-outline' : 'btn';
  button.textContent = email ? 'Отвязать' : 'Привязать';
  button.onclick = async () => {
    $('settings-error').textContent = '';
    if (!email) {
      const form = $('email-link');
      form.classList.toggle('hidden');
      $('link-hint').textContent = '';
      $('link-code').value = '';
      if (!form.classList.contains('hidden')) $('link-email').focus();
      return;
    }
    if (!(await ask(`Входить по почте ${email} будет нельзя.`, { title: 'Отвязать почту?', ok: 'Отвязать', danger: true }))) return;
    button.disabled = true;
    try {
      state.me = await Api.del('/me/email');
      renderIdentities();
    } catch (err) {
      $('settings-error').textContent = err.message;
      button.disabled = false;
    }
  };
  row.append(providerBadge('email'), info, button);
  return row;
}

let linkTimer = null;

$('link-send').onclick = async () => {
  const email = $('link-email').value.trim();
  if (!email) return ($('settings-error').textContent = 'Введите почту');
  const button = $('link-send');
  button.disabled = true;
  $('settings-error').textContent = '';
  try {
    await Api.post('/me/email/code', { email });
  } catch (err) {
    $('settings-error').textContent = err.message;
    button.disabled = false;
    return;
  }
  $('link-hint').textContent = `Код отправлен на ${email}. Если письма нет, проверьте папку «Спам».`;
  $('link-code').focus();
  let left = 60;
  clearInterval(linkTimer);
  const tick = () => {
    button.textContent = left > 0 ? `Ещё раз через ${left} с` : 'Отправить ещё раз';
    button.disabled = left > 0;
    if (left-- <= 0) clearInterval(linkTimer);
  };
  tick();
  linkTimer = setInterval(tick, 1000);
};

$('link-confirm').onclick = async () => {
  const email = $('link-email').value.trim();
  const code = $('link-code').value.trim();
  if (!email || !code) return ($('settings-error').textContent = 'Введите почту и код из письма');
  $('link-confirm').disabled = true;
  $('settings-error').textContent = '';
  try {
    state.me = await Api.put('/me/email', { email, code });
    $('email-link').classList.add('hidden');
    renderIdentities();
    toast('Почта привязана');
  } catch (err) {
    $('settings-error').textContent = err.message;
  } finally {
    $('link-confirm').disabled = false;
  }
};

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

// Фон комнаты: уменьшаем до 1920 по большей стороне и сжимаем в WebP до 1,9 МБ
const BACKGROUND_SIDE = 1920;
async function makeBackgroundBlob(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Не получилось открыть картинку. Попробуйте JPG или PNG');
  }
  const scale = Math.min(1, BACKGROUND_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.68, 0.5]) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality));
    if (blob && blob.size < 1.9 * 1024 * 1024) return blob;
  }
  throw new Error('Картинка получилась слишком большой');
}

function applyMe(me) {
  state.me = me;
  renderMe();
  renderAvatarEditor();
  renderMessages();
  renderVoice();
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

// Разделы настроек: какой открыт и как он называется в шапке
const SETTINGS_TABS = {
  profile: 'Профиль',
  look: 'Оформление',
  sound: 'Звук и видео',
  notify: 'Уведомления',
  account: 'Аккаунт',
  about: 'О приложении',
};

function showSettingsTab(tab) {
  const current = SETTINGS_TABS[tab] ? tab : 'profile';
  $('set-title').textContent = SETTINGS_TABS[current];
  for (const b of document.querySelectorAll('#set-nav [data-tab]')) b.classList.toggle('active', b.dataset.tab === current);
  for (const p of document.querySelectorAll('#settings .set-pane')) p.classList.toggle('hidden', p.dataset.pane !== current);
  $('settings').querySelector('.set-body').scrollTop = 0;
}

for (const b of document.querySelectorAll('#set-nav [data-tab]')) b.onclick = () => showSettingsTab(b.dataset.tab);

/** tab — раздел, который открыть (по кнопке настроек приходит событие щелчка — тогда «Профиль») */
async function openSettings(tab) {
  showSettingsTab(typeof tab === 'string' ? tab : 'profile');
  renderThemePicker();
  renderPttSettings();
  renderNotifySettings();
  $('email-link').classList.add('hidden');
  $('link-email').value = '';
  renderIdentities();
  renderPasswordSection();
  renderAvatarEditor();
  $('set-display').value = state.me.displayName;
  pickedColor = state.me.avatarColor;
  pickedBanner = state.me.bannerColor || null;
  $('set-bio').value = state.me.bio || '';
  renderColorPicker();
  $('set-ns').checked = state.settings.noiseSuppression;
  $('mic-test-btn').textContent = 'Проверить микрофон';
  $('mic-test-btn').disabled = false;
  $('set-cur-pass').value = '';
  $('set-new-pass').value = '';
  $('settings-error').textContent = '';
  $('set-speaker').closest('.field').classList.toggle('hidden', !HTMLMediaElement.prototype.setSinkId);
  $('settings').classList.remove('hidden');
  try {
    await fillDeviceSelect($('set-mic'), 'audioinput', state.settings.micId);
    await fillDeviceSelect($('set-speaker'), 'audiooutput', state.settings.speakerId);
    await fillDeviceSelect($('set-cam'), 'videoinput', state.settings.camId);
  } catch (err) {
    console.warn(err);
  }
  startMicMeter();
}

function closeSettings() {
  $('settings').classList.add('hidden');
  stopMicMeter();
  stopCamPreview();
}

// ---------- Проверка микрофона, динамиков и камеры ----------

const settingsOpen = () => !$('settings').classList.contains('hidden');
const formAudioSettings = () => ({ micId: $('set-mic').value, noiseSuppression: $('set-ns').checked });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let micTest = null; // { stream, meter } — живая полоска громкости в настройках
let micTestRequest = 0;

// Полоска двигается, когда говоришь: сразу видно, что микрофон выбран правильный
async function startMicMeter() {
  const request = ++micTestRequest;
  const listening = Boolean(micMonitor);
  stopMicMeter();
  $('mic-test-hint').textContent = '';
  try {
    const stream = await navigator.mediaDevices.getUserMedia(micConstraints(formAudioSettings()));
    if (request !== micTestRequest || !settingsOpen()) return stream.getTracks().forEach((t) => t.stop());
    const fill = $('mic-meter');
    const meter = new LevelMeter(stream, null, (level) => {
      fill.style.width = `${Math.round(level * 100)}%`;
      fill.classList.toggle('loud', level > 0.9);
    });
    micTest = { stream, meter };
    if (listening) startMicMonitor();
  } catch (err) {
    if (request === micTestRequest) $('mic-test-hint').textContent = mediaErrorText(err);
  }
}

function stopMicMeter() {
  stopMicMonitor();
  micTest?.meter.stop();
  micTest?.stream.getTracks().forEach((t) => t.stop());
  micTest = null;
  $('mic-meter').style.width = '0';
}

// «Слушать себя»: микрофон сразу звучит в выбранных наушниках — слышно и качество, и шумоподавление
let micMonitor = null; // { ctx, source }

function startMicMonitor() {
  if (!micTest) return;
  stopMicMonitor();
  const ctx = newAudioContext($('set-speaker').value);
  const source = ctx.createMediaStreamSource(micTest.stream);
  source.connect(ctx.destination);
  ctx.resume().catch(() => {});
  micMonitor = { ctx, source };
  $('mic-monitor-btn').textContent = 'Перестать слушать';
  $('mic-monitor-btn').classList.add('on');
}

function stopMicMonitor() {
  if (!micMonitor) return;
  micMonitor.source.disconnect();
  micMonitor.ctx.close();
  micMonitor = null;
  $('mic-monitor-btn').textContent = 'Слушать себя';
  $('mic-monitor-btn').classList.remove('on');
}

async function toggleMicMonitor() {
  if (micMonitor) return stopMicMonitor();
  if (!micTest) await startMicMeter();
  startMicMonitor();
}

// Записываем 5 секунд и проигрываем — человек слышит себя так же, как его слышат друзья
async function recordMicTest() {
  if (!micTest) await startMicMeter();
  if (!micTest) return;
  const btn = $('mic-test-btn');
  btn.disabled = true;
  stopMicMonitor(); // иначе запись наложится на живой звук
  try {
    const recorder = new MediaRecorder(micTest.stream);
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (recorder.onstop = r));
    recorder.start();
    for (let i = 5; i > 0; i--) {
      btn.textContent = `Говорите… ${i}`;
      await sleep(1000);
    }
    recorder.stop();
    await stopped;
    btn.textContent = 'Слушаем запись…';
    const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
    const audio = new Audio(url);
    if ($('set-speaker').value && audio.setSinkId) await audio.setSinkId($('set-speaker').value).catch(() => {});
    const ended = new Promise((r) => (audio.onended = audio.onerror = r));
    await audio.play();
    await ended;
    URL.revokeObjectURL(url);
  } catch (err) {
    $('mic-test-hint').textContent = 'Не получилось записать: ' + err.message;
  } finally {
    btn.textContent = 'Проверить микрофон';
    btn.disabled = false;
  }
}

let camPreview = null;

async function toggleCamPreview() {
  if (camPreview) return stopCamPreview();
  try {
    camPreview = await navigator.mediaDevices.getUserMedia(cameraConstraints({ camId: $('set-cam').value }));
    if (!settingsOpen()) return stopCamPreview();
    $('cam-preview').srcObject = camPreview;
    $('cam-preview').classList.remove('hidden');
    $('cam-test-btn').textContent = 'Выключить';
    // Теперь у камер есть названия
    fillDeviceSelect($('set-cam'), 'videoinput', $('set-cam').value).catch(() => {});
  } catch (err) {
    camPreview = null;
    $('mic-test-hint').textContent = mediaErrorText(err, 'камера');
  }
}

function stopCamPreview() {
  camPreview?.getTracks().forEach((t) => t.stop());
  camPreview = null;
  $('cam-preview').srcObject = null;
  $('cam-preview').classList.add('hidden');
  $('cam-test-btn').textContent = 'Проверить камеру';
}

$('set-mic').onchange = startMicMeter;
// Шумоподавление переключается сразу — и в разговоре тоже
$('set-ns').onchange = () => {
  setNoiseSuppression($('set-ns').checked);
  startMicMeter();
};
$('set-speaker').onchange = () => micMonitor && startMicMonitor();
$('mic-monitor-btn').onclick = toggleMicMonitor;
$('mic-test-btn').onclick = recordMicTest;
$('speaker-test-btn').onclick = () => tone.blip('test', $('set-speaker').value, 0.15);
$('cam-test-btn').onclick = toggleCamPreview;
$('set-cam').onchange = () => {
  if (!camPreview) return;
  stopCamPreview();
  toggleCamPreview();
};

$('settings-form').onsubmit = async (e) => {
  e.preventDefault();
  $('settings-error').textContent = '';

  const body = {};
  const displayName = $('set-display').value.trim();
  if (displayName !== state.me.displayName) body.displayName = displayName;
  if (pickedColor !== state.me.avatarColor) body.avatarColor = pickedColor;
  if (pickedBanner !== (state.me.bannerColor || null)) body.bannerColor = pickedBanner;
  const bio = $('set-bio').value.trim();
  if (bio !== (state.me.bio || '')) body.bio = bio;
  if ($('set-new-pass').value) {
    body.currentPassword = $('set-cur-pass').value;
    body.newPassword = $('set-new-pass').value;
  }

  try {
    if (Object.keys(body).length) {
      state.me = await Api.patch('/me', body);
      renderMe();
      renderMessages();
      renderVoice();
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
    camId: $('set-cam').value,
    noiseSuppression: $('set-ns').checked,
    ptt: document.querySelector('input[name="mic-mode"]:checked')?.value === 'ptt' && Boolean(pickedPtt),
    pttBinding: pickedPtt,
  };
  store.set('audio', state.settings);
  applyPtt();
  applySpeaker();
  const micChanged = prev.micId !== state.settings.micId || prev.noiseSuppression !== state.settings.noiseSuppression;
  const session = activeSession();
  if (session) session.settings = state.settings;
  if (micChanged && session) session.switchMic(state.settings).catch((err) => toast(mediaErrorText(err)));
  closeSettings();
};

// ---------- Обновления ----------

// Новая версия → окно со списком изменений и кнопками «Обновить», «Позже», «Пропустить эту версию»

let updateStatus = { state: 'idle' };
let updateRequested = false; // нажали «Обновить»: после загрузки сразу ставим
let manualCheck = false; // проверка по кнопке показывает окно даже для пропущенной версии

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

  // Плашка внизу слева и точка на кнопке обновлений: вышла новая версия — само окно не выскакивает
  const pending =
    !updateModalOpen() &&
    ((s.state === 'available' && !isSkipped(s.version)) || s.state === 'downloading' || s.state === 'ready');
  $('update-bar').classList.toggle('hidden', !pending);
  document.body.classList.toggle('has-update', pending);
  $('update-text').textContent =
    s.state === 'downloading' ? `Обновление: ${s.percent ?? 0}%` : s.state === 'ready' ? 'Обновление готово' : `Вышла версия ${s.version}`;
  $('update-btn').classList.toggle('hidden', s.state === 'downloading');
  $('update-btn').textContent = 'Обновить';
  $('update-bar').title = `Версия ${s.version ?? ''}`;
  $('update-later-bar').classList.toggle('hidden', s.state !== 'available');
  $('sidebar-update-check').classList.toggle('has-dot', pending);
  $('sidebar-update-check').title = pending ? `Вышла версия ${s.version}` : 'Проверить обновления';

  // Версия и кнопки «Проверить обновления»: экран входа, шапка боковой панели, настройки
  $('app-version').textContent = s.current || '';
  $('auth-version').textContent = s.current ? `Версия ${s.current}` : '';
  $('auth-version-row').classList.toggle('hidden', !s.current);
  $('sidebar-update-check').classList.toggle('spinning', s.state === 'checking' && manualCheck);
  // Когда проверяли в последний раз: сегодня — только время, раньше — с датой
  const checked = s.checkedAt && s.state !== 'checking'
    ? ` · проверено ${formatDay(s.checkedAt) === formatDay(Date.now()) ? 'в' : formatDay(s.checkedAt)} ${formatTime(s.checkedAt)}`
    : '';
  $('update-status').textContent = (UPDATE_TEXT[s.state]?.(s) ?? '') + checked;
  $('update-status').title = s.state === 'error' ? s.message || '' : '';
  $('update-check-btn').textContent =
    s.state === 'ready' ? 'Перезапустить и обновить' : s.state === 'available' ? 'Обновить…' : 'Проверить обновления';
  $('update-check-btn').disabled = s.state === 'checking' || s.state === 'downloading';
}

// Сначала говорим, что происходит: иначе окно просто исчезает, и человек жмёт на ярлык,
// пока установщик меняет файлы, — Windows отвечает «Отсутствует ярлык»
function installUpdate() {
  hangup();
  leaveRoomVoice();
  for (const el of document.querySelectorAll('.modal')) el.classList.add('hidden');
  $('updating').classList.remove('hidden');
  setTimeout(() => window.desktop.update.install(), 1500);
}

async function startUpdate() {
  if (activeSession() && !(await ask('После загрузки приложение перезапустится, и звонок завершится.', { title: 'Сейчас идёт звонок', ok: 'Обновить' })))
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
  // Окно «Что нового» само открывается только по кнопке; при запуске — плашка и точка (renderUpdate)
  if (st === 'available' && manualCheck) openUpdateModal();
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
  // «Не сейчас» прячет плашку до следующей версии; точка на кнопке тоже гаснет
  $('update-later-bar').onclick = () => {
    store.set('skippedUpdate', updateStatus.version);
    renderUpdate();
  };

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
$('accept-btn').onclick = acceptIncoming;
$('decline-btn').onclick = declineIncoming;
$('mic-btn').onclick = toggleMute;
$('call-mute').onclick = toggleMute;
$('deafen-btn').onclick = toggleDeafen;
$('call-deafen').onclick = toggleDeafen;
$('settings-btn').onclick = openSettings;
$('settings-cancel').onclick = closeSettings;
$('settings-close').onclick = closeSettings;
$('logout-btn').onclick = () => logout();

window.desktop?.onHotkey((name) => (name === 'toggle-mute' ? toggleMute() : toggleDeafen()));

window.addEventListener('focus', () => {
  if (state.selectedId && state.unread.has(state.selectedId)) {
    state.unread.delete(state.selectedId);
    renderContacts();
  }
});

window.addEventListener('beforeunload', () => {
  hangup();
  leaveRoomVoice();
});

// ---------- Запуск ----------

async function boot() {
  setAuthMode(false);
  applySpeaker();
  // Пользователь адрес не вводит: всегда общий сервер
  $('server-url').value = DEFAULT_SERVER;
  $('server-url').onchange = () => loadProviders(normalizeServer($('server-url').value));
  loadProviders(isWeb ? location.origin : normalizeServer($('server-url').value));

  let session = store.get('session', null);
  // «Запомнить меня» снят на странице входа: сессия живёт только в этой вкладке
  if (session && session.remember === false && !sessionStorage.getItem('sozvon.tab')) {
    store.set('session', null);
    session = null;
  }
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

window.addEventListener('DOMContentLoaded', boot);
