// Интерфейс: вход, список друзей, чат и звонки. Каналы — в hubs.js, комнаты — в rooms.js, панель разговора — в voice-ui.js

const $ = (id) => document.getElementById(id);
const isWeb = location.protocol.startsWith('http');

const DEFAULT_SERVER = 'https://135-106-226-12.sslip.io';
// Тот же сервер по старому адресу без HTTPS: вход переносим на новый адрес, токен остаётся действительным
const SAME_SERVER_OLD = 'http://135.106.226.12:3000';
// Прежние серверы (локальный и домашний): сохранённый вход сбрасываем
const LEGACY_SERVERS = ['http://localhost:3000', 'http://95.173.207.169:3000', 'http://92.241.13.52:3000'];

const COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f'];
// Баннеры — мягкие светящиеся оттенки, а не те же кислотные цвета аватаров
const BANNER_COLORS = ['#6d8ee8', '#8f7bf0', '#c47ac8', '#d9899a', '#e0a775', '#73b39d', '#6aa9c9', '#b48ad9'];

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
  volumeOff: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/></svg>',
  noise: '<svg viewBox="0 0 24 24"><path d="M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M22 12h0"/></svg>',
  noiseOff: '<svg viewBox="0 0 24 24"><path d="M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M3 3l18 18"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
};

/** Текущий уровень шумоподавления: 0…3 */
function noiseLevelOf() {
  return Math.min(3, Math.max(0, Number(state.settings?.noiseLevel ?? 0)));
}

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
  if (user?.id) el.dataset.profile = String(user.id);
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
  // На экране входа окно фиксированное, после входа — свободное
  window.desktop?.window?.authMode?.(name === 'auth');
  document.documentElement.classList.toggle('auth-screen', name === 'auth');
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

// Человек по логину (для упоминаний @логин): я, друзья, участники комнат и каналов
function userByUsername(username) {
  const n = username.toLowerCase();
  if (state.me?.username.toLowerCase() === n) return state.me;
  for (const c of state.contacts.values()) if (c.username.toLowerCase() === n) return c;
  for (const group of [...state.rooms.values(), ...state.hubs.values()]) {
    const m = group.members.find((u) => u.username?.toLowerCase() === n);
    if (m) return m;
  }
  return null;
}

/** Заглушил ли я этого человека у себя (громкость 0 — «Заглушить для себя») */
const mutedForMe = (userId) => store.get(`volume:${userId}`, 100) === 0;

/** Значки голоса: выключен микрофон и выключен звук — оба, если оба; «заглушён для вас» — свой */
function voiceStateIcons({ userId, muted, deafened }) {
  const icon = (name, title, svg) => svg.replace('<svg', `<svg data-icon="${name}"`).replace('>', `><title>${title}</title>`);
  return (
    (muted ? icon('mic-off', 'Микрофон выключен', ICONS.micOff) : '') +
    (deafened ? icon('sound-off', 'Звук выключен', ICONS.soundOff) : '') +
    (userId !== state.me.id && mutedForMe(userId) ? icon('muted-for-me', 'Заглушён для вас', ICONS.volumeOff) : '')
  );
}

/** Упомянули ли меня в сообщении (чужом) */
const mentionsMe = (m) => m.fromId !== state.me.id && findMentions(messageView(m).text).includes(state.me.username.toLowerCase());

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
  $('auth-totp').value = '';
  $('totp-field').classList.add('hidden');
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
  // В приложении ответ принимает Electron, в браузере — сервер (переадресация), поэтому список нужен везде
  const versionHeaders = Api.versionHeaders?.() || {};
  if (base && (window.desktop?.oauth || isWeb)) {
    try {
      const res = await fetch(`${base}/api/oauth/providers`, { headers: versionHeaders, signal: AbortSignal.timeout(5000) });
      if (res.ok) providers = await res.json();
    } catch {}
  }
  // Требует ли сервер код приглашения: если нет, поле кода не показываем
  try {
    const res = await fetch(`${base}/api/health`, { headers: versionHeaders, signal: AbortSignal.timeout(5000) });
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
  // В браузере код принимает сервер и возвращает нас сюда с токеном
  if (isWeb) {
    location.href = `${base}/api/oauth/${provider}/web`;
    return;
  }
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

// Свой сервер: ссылка на экране входа открывает поле адреса
$('server-toggle').onclick = () => {
  const field = $('server-field');
  if (field.classList.contains('hidden')) {
    field.classList.remove('hidden');
    $('server-url').focus();
    $('server-url').select();
  } else {
    field.classList.add('hidden');
  }
};

// Настройки → Сервер: сменить адрес (аккаунты на разных серверах не связаны)
$('server-change-btn').onclick = async () => {
  const host = $('server-current-main').textContent;
  const ok = await ask(
    `Сейчас приложение подключено к ${host}. После смены адреса нужно войти заново: аккаунты на разных серверах не связаны.`,
    { title: 'Сменить сервер?', ok: 'Сменить' }
  );
  if (!ok) return;
  store.set('session', null);
  Api.token = '';
  state.me = null;
  // Ключ прежнего сервера в памяти не держим: на новом свои ключи и своя личность
  resetE2EE();
  showScreen('auth');
  $('server-field').classList.remove('hidden');
  $('server-url').focus();
};
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
    // Сразу, а не после письма с кодом: иначе человек узнает о слабом пароле в самом конце
    if (mode !== 'login' && password.length < 8) return ($('auth-error').textContent = 'Пароль должен быть не короче 8 символов');
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
      const result = await Api.post('/password/reset', { email, code, password });
      toast('Пароль изменён');
      // С двухфакторным входом письма мало: дальше обычный вход с кодом
      if (result.needLogin) setAuthMode('login');
      else finishLogin(base, result);
      return;
    }
    if (mode === 'register') {
      finishLogin(base, await Api.post('/register', { email, password, displayName: $('auth-display').value.trim(), inviteCode, code }));
      return;
    }
    finishLogin(base, await Api.post('/login', { username, password, totpCode: $('auth-totp').value.trim() }));
  } catch (err) {
    $('auth-error').textContent = err.message;
    if (err.data?.needTotp) {
      $('totp-field').classList.remove('hidden');
      $('auth-totp').focus();
    }
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
  loadCustomSounds();

  socket = new ServerSocket({
    onMessage: handleEvent,
    onStatus(ok) {
      Api.online = ok;
      $('conn-dot').classList.toggle('ok', ok);
      $('conn-dot').title = ok ? 'Подключено к серверу' : 'Нет связи с сервером, переподключаемся…';
      if (ok) {
        catchUpHistory();
        refreshUnread();
        refreshContacts();
        refreshHubs();
        refreshRooms();
        sendAutoStatus();
        resumeCall();
      } else if (state.call?.callId) {
        // Связь с сервером пропала, но разговор не рвём: сервер держит наше место,
        // а звук идёт напрямую — ждём переподключения
        if (state.call.phase !== 'reconnecting') {
          state.call.phase = 'reconnecting';
          toast('Связь с сервером прервалась, переподключаемся…');
        }
        renderVoice();
        renderChatHeader();
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
  closeDrafts();
  clearTyping();
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
    historyEnd: new Set(),
    readMarks: new Map(),
    newLine: null,
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
  if (id) {
    openUnread(`dm:${id}`);
    readNotifsOf({ contact: id });
  } else state.newLine = null;
  roomComposer.openDraft(null);
  dmComposer.openDraft(id ? `dm:${id}` : null);
  // Открыли чат — на последнем сообщении, даже если в прошлый раз листали вверх
  $('messages').stick = true;
  renderContacts();
  renderRooms();

  const contact = state.contacts.get(id);
  $('empty-state').classList.toggle('hidden', Boolean(contact));
  $('chat').classList.toggle('hidden', !contact);
  $('room-view').classList.add('hidden');
  renderHubChrome();
  renderVoice();
  renderTyping();
  if (!contact) return;

  renderChatHeader();
  applyChatTheme();
  renderMessages();
  dmComposer.focus();

  if (!state.history.has(id)) await loadHistory(dmHistory(id));
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
      older: () => loadOlder(dmHistory(peerId)),
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
  '💩',
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
const forwardOrigin = (user) => ({
  displayName: user?.displayName || '?',
  avatarColor: user?.avatarColor || '#555',
  avatarUrl: user?.avatarUrl || null,
});

async function forwardMessage(m) {
  const { text = '', files: originals = [], preview = null, forward: earlier = null } = m.plain || {};
  if (!text && !originals.length) return toast('Это сообщение нельзя переслать');
  // Переслали пересланное — автором остаётся первый
  const forward = earlier || forwardOrigin(userById(m.fromId));
  const target = await pickForwardTarget();
  if (!target) return;
  try {
    const conv = target.kind === 'dm' ? dmConvOf(target.id) : roomConvOf(target.id);
    // Вложение принадлежит одному сообщению и зашифровано своим ключом: в новую переписку уходит его копия
    const files = await Promise.all(originals.map(forwardFile));
    const { body, plain } = await encryptOutgoing(conv, { text, files, preview, forward });
    if (target.kind === 'dm') addMessage({ ...(await Api.post(`/messages/${target.id}`, body)), plain });
    else addRoomMessage({ ...(await Api.post(`/rooms/${target.id}/messages`, body)), plain });
    toast(`Переслано: ${target.name}`);
  } catch (err) {
    toast(err.message);
  }
}

/** Копия вложения для пересылки: расшифрованный файл загружается заново, новым ключом */
async function forwardFile(a) {
  const blob = await (await fetch(await decryptedFileUrl(a))).blob();
  return uploadEncrypted(new File([blob], a.name, { type: a.mime }), () => {}).done;
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

/** Правка — в поле ввода чата (полоса «Изменение сообщения» над ним), см. startEdit в composer.js */
function editMessage(m, chat) {
  startEdit(m, chat);
}

/** Сохранить правку: новый конверт с новым текстом, сервер текста не видит */
async function saveEdit(m, chat, next) {
  const text = next.trim();
  const { files = [], preview = null, reply = null, forward = null } = m.plain || {};
  // Без текста может остаться только сообщение с вложением
  if ((!text && !files.length) || text === m.plain?.text) return;
  try {
    const conv = chat.kind === 'dm' ? dmConvOf(chat.peerId) : roomConvOf(chat.roomId);
    // Конверт заменяется целиком: файлы (их ключи только здесь), цитата и превью должны перейти в новый
    const { body, plain } = await encryptOutgoing(conv, { text, files, preview, reply, forward });
    Object.assign(m, await Api.patch(chatPath(chat, m), { enc: body.enc }), { plain });
    refreshChat(chat);
  } catch (err) {
    toast(err.message);
  }
}

async function togglePin(m, chat) {
  try {
    // Значение запоминаем заранее: событие от сервера может прийти раньше ответа
    const pinned = !m.pinned;
    if (pinned) await Api.put(chatPath(chat, m, '/pin'), {});
    else await Api.del(chatPath(chat, m, '/pin'));
    m.pinned = pinned;
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
  bar.onclick = () => jumpToMessage(bar.nextElementSibling, first.id) || toast(`${author.displayName}: ${known.text || 'сообщение'}`);
}

/** Сообщения нет среди загруженных — листаем историю назад, пока не дойдём до него */
async function seekMessage(box, id) {
  const first = () => Number(box.querySelector('[data-msg-id]')?.dataset.msgId);
  while (first() > id && (await box.older()));
  if (box.querySelector(`[data-msg-id="${id}"]`)) jumpToMessage(box, id);
  else toast('Сообщение удалено');
}

/** Пролистать ленту к сообщению и подсветить его; false — перейти некуда */
function jumpToMessage(box, id) {
  const row = box?.querySelector(`[data-msg-id="${id}"]`);
  if (!row) {
    if (!box?.older) return false;
    seekMessage(box, id);
    return true;
  }
  // Человек сам ушёл от низа — лента больше не держится внизу, видна плашка «Перейти к последним»
  box.stick = false;
  box.userScrolled = true;
  syncJumpBar(box);
  row.scrollIntoView({ block: 'center' });
  row.classList.remove('msg-flash');
  void row.offsetWidth;
  row.classList.add('msg-flash');
  setTimeout(() => row.classList.remove('msg-flash'), 2000);
  return true;
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
  const user = userById(reply.fromId) || { displayName: '?', avatarColor: '#555' };
  const el = document.createElement('div');
  el.className = 'msg-reply';
  const name = document.createElement('b');
  name.textContent = user.displayName;
  name.style.color = user.nameColor || user.avatarColor;
  const text = document.createElement('span');
  text.textContent = reply.text || 'вложение';
  el.append(makeAvatar(user, undefined, 'micro'), name, text);
  el.onclick = (e) => {
    e.stopPropagation();
    jumpToMessage(el.closest('.messages'), reply.id);
  };
  return el;
}

/** «Переслано от …» над пересланным сообщением */
function forwardMark(origin) {
  const el = document.createElement('div');
  el.className = 'msg-forward';
  el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 14 20 9l-5-5"/><path d="M20 9h-9a7 7 0 0 0-7 7v3"/></svg>';
  const label = document.createElement('span');
  label.textContent = 'Переслано от';
  const name = document.createElement('b');
  name.textContent = origin.displayName;
  el.append(label, makeAvatar(origin, undefined, 'micro'), name);
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
    chip.setAttribute('aria-label', r.mine ? 'Убрать реакцию' : 'Поставить реакцию');
    chip.dataset.emoji = r.emoji;
    row.append(chip);
  }
  return row;
}

// ---------- Кто поставил реакцию ----------
// Слушаем ленту целиком: она перерисовывается, пока мышь стоит на реакции

const WHO_DELAY_MS = 250;
const WHO_MAX_NAMES = 10;
let whoTimer = null;
let whoChip = null;

function hideReactionWho() {
  clearTimeout(whoTimer);
  whoChip = null;
  $('reaction-who').classList.add('hidden');
}

function whoNames(users) {
  const names = users.map((u) => u.displayName);
  const rest = names.length - WHO_MAX_NAMES;
  return rest > 0 ? `${names.slice(0, WHO_MAX_NAMES).join(', ')} и ещё ${rest}` : names.join(', ');
}

async function showReactionWho(chip, chat) {
  const m = chip.closest('.msg')?.message;
  if (!m) return;
  const list = await Api.get(chatPath(chat, m, '/reactions')).catch(() => null);
  if (whoChip !== chip) return;
  const users = list?.find((r) => r.emoji === chip.dataset.emoji)?.users;
  if (!users?.length) return;
  const box = $('reaction-who');
  box.textContent = `${chip.dataset.emoji} ${whoNames(users)}`;
  box.classList.remove('hidden');
  const r = chip.getBoundingClientRect();
  const size = box.getBoundingClientRect();
  box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - size.width - 8))}px`;
  box.style.top = `${Math.max(8, r.top - size.height - 6)}px`;
}

/** Видно ли в этом чате, кто поставил: в канале это выключается в настройках */
function reactionsOpen(chat) {
  if (chat.kind === 'dm') return true;
  const hubId = roomById(chat.roomId)?.hubId;
  return !hubId || hubById(hubId)?.reactionsVisible !== false;
}

function watchReactionChips(feedId, chatOf) {
  $(feedId).addEventListener('mouseover', (e) => {
    const chip = e.target.closest('.reaction-chip');
    if (chip === whoChip) return;
    hideReactionWho();
    const chat = chatOf();
    if (!chip || !reactionsOpen(chat)) return;
    whoChip = chip;
    whoTimer = setTimeout(() => showReactionWho(chip, chat), WHO_DELAY_MS);
  });
  $(feedId).addEventListener('mouseleave', hideReactionWho);
  $(feedId).addEventListener('click', hideReactionWho);
}
watchReactionChips('messages', () => ({ kind: 'dm', peerId: state.selectedId }));
watchReactionChips('room-messages', () => ({ kind: 'room', roomId: state.selectedRoomId }));

// Лента сообщений: и для чата с другом, и для комнаты. Строка живёт, пока не поменялась: перестроить всю ленту значит
// сбросить выделение, остановить видео, а пока картинки заново узнают размер — сдвинуть текст под глазами читателя

/**
 * Участники обсуждения под сообщением канала. Сервер обычно присылает их сразу,
 * но если данных не оказалось (например, сообщение пришло событием) — подтягиваем
 * один раз, чтобы аватарки были видны без открытия треда
 */
function ensureThreadUsers(m, chat) {
  if (!chat?.roomId || m.threadUsers?.length || m._threadUsersLoaded || !Number(m.replies || 0)) return;
  m._threadUsersLoaded = true;
  Api.get(`/rooms/${chat.roomId}/messages/${m.id}/thread`)
    .then((rows) => {
      const ids = [...new Set((rows || []).map((r) => r.fromId))];
      m.threadUsers = ids.slice(0, 5);
      m.threadUserCount = ids.length;
      if (state.selectedRoomId === chat.roomId && typeof renderRoomMessages === 'function') renderRoomMessages();
    })
    .catch(() => {
      m._threadUsersLoaded = false;
    });
}

/** Строка сообщения; shown — та же строка, уже показанная в ленте (вернётся она же, если ничего не поменялось) */
function messageRow(m, prev, list, actions, shown, fresh) {
  const newDay = !prev || formatDay(prev.createdAt) !== formatDay(m.createdAt);
  const base = userById(m.fromId) || { displayName: '?', avatarColor: '#555' };
  // В комнате у человека может быть своё имя в канале — показываем его
  const nick = actions.chat?.kind === 'room' ? channelNickOf(m.fromId, actions.chat.roomId) : null;
  const author = nick ? { ...base, displayName: nick } : base;
  const reply = replyOf(m, list);
  // У ответа своя дуга к аватарке, поэтому он всегда начинает новую группу
  const continued = !reply && !newDay && prev.fromId === m.fromId && m.createdAt - prev.createdAt < 5 * 60_000;

  const look = JSON.stringify([
    continued,
    m.createdAt,
    m.editedAt,
    m.reactions,
    m.pinned,
    // Счётчик и участники обсуждения: без них строка кэшировалась со старым
    // «Обсуждение · 4», хотя в данных уже 5 ответов.
    m.replies,
    m.threadUserCount,
    m.threadUsers?.join(','),
    reply,
    mentionsMe(m),
    actions.canDelete(m),
    author.displayName,
    author.nameColor,
    author.avatarColor,
    author.avatarUrl,
    // Событие в сообщении: ответы участников меняются — карточку нужно перерисовать
    m.plain?.eventId ? JSON.stringify(roomById(m.roomId)?.events?.find((e) => e.id === m.plain.eventId)?.responses || null) : '',
  ]);
  const text = JSON.stringify([m.text, m.plain, m.attachments, m.preview]);
  if (shown?.look === look && shown.text === text) {
    shown.row.message = m;
    return shown;
  }

  const row = document.createElement('div');
  row.className = `msg${continued ? ' cont' : ''}${fresh ? ' msg-new' : ''}`;
  row.dataset.msgId = m.id;
  if (mentionsMe(m)) row.classList.add('mentions-me');
  if (m.mentionAll) row.classList.add('mentions-all');
  // Для меню по правой кнопке: само сообщение и что с ним можно сделать в этой ленте
  row.message = m;
  row.actions = actions;
  if (reply) {
    row.classList.add('has-reply');
    row.append(replyQuote(reply));
  }
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
    name.style.color = author.nameColor || author.avatarColor;
    if (author.id) name.dataset.profile = author.id;
    const time = document.createElement('time');
    time.textContent = formatTime(m.createdAt);
    head.append(name, time);
    body.append(head);
  }
  if (m.plain?.forward) body.append(forwardMark(m.plain.forward));
  // Реакция или закреп меняют только строку: содержимое (картинки, идущее видео) остаётся тем же
  const content = shown?.text === text ? shown.content : messageContent(m);
  body.append(content);
  if (m.editedAt) {
    const edited = document.createElement('span');
    edited.className = 'msg-edited';
    edited.textContent = '(изменено)';
    body.append(edited);
  }
  const chips = reactionsView(m);
  if (chips) body.append(chips);
  row.append(body);
  if (actions?.chat?.kind === 'room' && (Number(m.replies || 0) > 0 || m.threadUsers?.length)) {
    ensureThreadUsers(m, actions.chat);
    const rowEl = document.createElement('div');
    rowEl.className = 'msg-thread-row';
    if (m.threadUsers?.length) {
      const strip = document.createElement('div');
      strip.className = 'thread-people';
      for (const uid of m.threadUsers) {
        const u = typeof userById === 'function' ? userById(uid) : null;
        if (u && typeof makeAvatar === 'function') strip.append(makeAvatar(u, typeof presenceOf === 'function' ? presenceOf(u) : undefined, 'small'));
      }
      if (m.threadUserCount > m.threadUsers.length) {
        const more = document.createElement('span');
        more.className = 'thread-more';
        more.textContent = '+\u2009' + (m.threadUserCount - m.threadUsers.length);
        strip.append(more);
      }
      rowEl.append(strip);
    }
    // Внутри обсуждения ссылки «Обсуждение · N» быть не должно: второго треда не существует
    if (Number(m.replies || 0) > 0 && actions.scope !== 'thread') {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'msg-thread-link';
      link.textContent = '\u041e\u0431\u0441\u0443\u0436\u0434\u0435\u043d\u0438\u0435 \u00b7 ' + m.replies;
      link.onclick = (e) => {
        e.stopPropagation();
        openThread(m, actions.chat);
      };
      rowEl.append(link);
    }
    body.append(rowEl);
  }
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
    // В обсуждении ответ уходит в обсуждение, а не в общий чат
    const inThread = actions.scope === 'thread' || Boolean(tools.closest?.('.thread-panel'));
    tool('Ответить', '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 7 7v3"/></svg>', (e) => {
      e.stopPropagation();
      if (inThread && typeof window.replyInThread === 'function') {
        window.replyInThread(row.message, actions.chat);
        return;
      }
      startReply(row.message, actions.chat);
    });
    // Внутри обсуждения нельзя завести ещё одно обсуждение
    if (actions.chat.kind === 'room' && !inThread)
      tool('Обсудить сообщение', '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>', (e) => {
        e.stopPropagation();
        openThread(row.message, actions.chat);
      }, ' thread');
    // Пересылка и закреп — только для ленты канала, не для обсуждения
    if (!inThread)
      tool('Переслать', '<svg viewBox="0 0 24 24"><path d="M15 14 20 9l-5-5"/><path d="M20 9h-9a7 7 0 0 0-7 7v3"/></svg>', (e) => {
        e.stopPropagation();
        forwardMessage(row.message);
      });
    tool('Реакция', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0"/><path d="M9 9h.01M15 9h.01"/></svg>', (e) => {
      e.stopPropagation();
      openReactions(row.message, actions.chat, e.currentTarget);
    });
    if (m.fromId === state.me.id)
      tool('Изменить', '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>', (e) => {
        e.stopPropagation();
        if (typeof window.editThreadMessage === 'function' && (inThread || tools.closest?.('.thread-panel'))) {
          window.editThreadMessage(row.message, actions.chat);
          return;
        }
        editMessage(row.message, actions.chat);
      });
    if (!inThread)
      tool(
        m.pinned ? 'Открепить' : 'Закрепить',
        '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v6"/></svg>',
        (e) => {
          e.stopPropagation();
          togglePin(row.message, actions.chat);
        },
        ' pin'
      );
    if (actions.canDelete(m))
      tool('Удалить (с Shift — без вопроса)', '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>', (e) => {
        deleteMessage(row.message, actions.remove, e.shiftKey);
      }, ' danger');
    row.append(tools);
  }
  return { row, look, text, content };
}

/** actions: { chat, canDelete(m), remove(m), older() } — чья лента, можно ли удалить сообщение, как, и как догрузить старое */
function renderMessageList(box, list, loaded, emptyText, actions) {
  jumpBar(box);
  const conv = `${actions.chat.kind}:${actions.chat.peerId ?? actions.chat.roomId}`;
  const same = box.feed?.conv === conv;
  if (!same) box.feed = { conv, rows: new Map(), days: new Map(), last: 0 };
  const feed = box.feed;
  box.older = actions.older;
  const isNew = (m) => same && m.id > feed.last;
  // Ту же переписку листают вверх — стоим на месте. Внизу ли человек, решает только его прокрутка (box.stick), а не
  // высота ленты: картинки и превью догружаются позже. Своё новое сообщение — всегда вниз, к нему
  const sentNow = list.some((m) => isNew(m) && m.fromId === state.me.id);
  const keepScroll = same && !box.stick && !sentNow;

  if (!list.length) {
    // Пустая переписка — Совон; пока грузим — просто «Загрузка…»
    box.replaceChildren(loaded ? mascot('Здесь пока тихо', emptyText) : Object.assign(document.createElement('div'), { className: 'hint', textContent: 'Загрузка…' }));
    box.feed = null;
    jumpBar(box).classList.add('hidden');
    return;
  }

  const nodes = [];
  const rows = new Map();
  let prev = null;
  // Линия «Новые сообщения» — перед первым непрочитанным, пока чат открыт
  let line = state.newLine?.conv === conv ? list.find((m) => m.id > state.newLine.lastRead && m.fromId !== state.me.id) : null;
  for (const m of list) {
    const day = formatDay(m.createdAt);
    if (!prev || formatDay(prev.createdAt) !== day) {
      if (!feed.days.has(day)) {
        const dayRow = Object.assign(document.createElement('div'), { className: 'day' });
        dayRow.append(Object.assign(document.createElement('span'), { textContent: day }));
        feed.days.set(day, dayRow);
      }
      nodes.push(feed.days.get(day));
    }
    if (m === line) {
      feed.line ??= Object.assign(document.createElement('div'), { className: 'new-line', textContent: 'Новые сообщения' });
      nodes.push(feed.line);
    }
    const shown = messageRow(m, prev, list, actions, feed.rows.get(m.id), isNew(m));
    rows.set(m.id, shown);
    nodes.push(shown.row);
    prev = m;
  }
  const bar = jumpBar(box);
  if (keepScroll && list.some(isNew)) bar.classList.add('fresh');
  feed.rows = rows;
  feed.last = list.at(-1).id;

  // Сверка: на месте остаётся всё, что не поменялось. Читающему браузер сам держит экран при вставке выше него, кроме самого верха
  box.style.overflowAnchor = keepScroll ? 'auto' : '';
  const atTop = keepScroll && box.scrollTop === 0;
  const height = box.scrollHeight;
  let at = box.firstChild;
  for (const node of nodes) {
    if (node === at) at = at.nextSibling;
    else box.insertBefore(node, at);
  }
  while (at) {
    const next = at.nextSibling;
    at.remove();
    at = next;
  }
  if (atTop) box.scrollTop = box.scrollHeight - height;
  if (!keepScroll) settleAtBottom(box);
  syncJumpBar(box);
  if (box.scrollTop < OLDER_ZONE_PX) box.older?.(); // экран не заполнен — листать нечего, догружаем сами
}

// Столько пикселей до верха ленты — пора догружать старые сообщения
const OLDER_ZONE_PX = 400;

const nearBottom = (box) => box.scrollHeight - box.scrollTop - box.clientHeight < 40;

/** Открыли чат: доводим ленту вниз несколько раз, пока вёрстка «доезжает» (шрифты, картинки, большой экран). Человек начал листать — не трогаем */
function settleAtBottom(box) {
  box.openAt = Date.now();
  box.userScrolled = false;
  stickToBottom(box);
  const settle = () => {
    if (box.userScrolled) return;
    if (box.stick || Date.now() - box.openAt < 1200) {
      box.stick = true;
      scrollDown(box);
    }
  };
  requestAnimationFrame(settle);
  setTimeout(settle, 120);
  setTimeout(settle, 420);
  setTimeout(settle, 900);
}

function stickToBottom(box) {
  box.stick = true;
  scrollDown(box);
}

/** Прокрутить вниз самим — и запомнить, куда поставили: это событие прокрутки не от человека */
function scrollDown(box) {
  box.scrollTop = box.scrollHeight;
  box.autoTop = box.scrollTop;
}

// «Перейти к последним»: полоса над полем ввода, пока ленту листают вверх; ниже есть новые — она яркая
function jumpBar(box) {
  if (box.jumpBar) return box.jumpBar;
  const bar = document.createElement('button');
  bar.type = 'button';
  bar.className = 'jump-bar hidden';
  bar.innerHTML = '<span></span><b>Перейти к последним <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg></b>';
  bar.onclick = () => {
    stickToBottom(box);
    syncJumpBar(box);
  };
  box.after(bar);
  box.stick = true;
  // Прокрутку делает человек (колесо, полоса, клавиши) — запоминаем, внизу он или нет. Браузер присылает
  // событие и на нашу собственную прокрутку, причём с опозданием: к нему лента могла вырасти (картинка узнала
  // размер раньше «load»). Лента стоит там, куда её поставили мы, — человек не листал, решение не меняем
  box.addEventListener('scroll', () => {
    if (box.scrollTop === box.autoTop) return;
    // Прокрутка не наша — значит человек листает сам, дожатие вниз прекращаем
    box.userScrolled = true;
    box.stick = nearBottom(box);
    box.style.overflowAnchor = box.stick ? '' : 'auto'; // читает историю — картинки выше экрана не должны двигать текст
    syncJumpBar(box);
    if (box.scrollTop < OLDER_ZONE_PX) box.older?.();
  });
  // Колесо, тач и клавиши — тоже «человек листает»
  for (const name of ['wheel', 'touchstart', 'touchmove', 'keydown']) {
    box.addEventListener(name, () => (box.userScrolled = true), { passive: true });
  }
  // Догрузилась картинка, видео или превью — если человек был внизу, держим его внизу
  const keepDown = () => box.stick && scrollDown(box);
  box.addEventListener('load', keepDown, true);
  box.addEventListener('loadedmetadata', keepDown, true);
  new ResizeObserver(keepDown).observe(box);
  // Превью ссылок, расшифрованные вложения и реакции дописываются в ленту позже, без «load»
  new MutationObserver(keepDown).observe(box, { childList: true, subtree: true });
  box.jumpBar = bar;
  return bar;
}

function syncJumpBar(box) {
  const bar = jumpBar(box);
  const atBottom = box.stick;
  if (atBottom) bar.classList.remove('fresh');
  bar.classList.toggle('hidden', atBottom);
  bar.firstChild.textContent = bar.classList.contains('fresh') ? 'Ниже новые сообщения' : 'Вы смотрите старые сообщения';
}

function addMessage(m) {
  const peerId = m.fromId === state.me.id ? m.toId : m.fromId;
  stopTyping(`dm:${peerId}`, m.fromId);
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
  if (visible) markRead(`dm:${peerId}`);
  else {
    if (peerId !== state.selectedId) state.unread.set(peerId, (state.unread.get(peerId) || 0) + 1);
    noteUnread(`dm:${peerId}`, m.id);
    renderContacts();
    renderRail();
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
    case 'chat:theme':
      return onChatTheme(msg);
    case 'chat:wallpaper':
      return onChatWallpaper(msg);
    case 'user:updated':
      if (msg.user.id === state.me.id) {
        // Свой профиль (с этого или другого устройства): и себя, и свои копии в участниках комнат и каналов
        Object.assign(state.me, msg.user);
        renderMe();
        renderVoice();
      } else onUserKey(msg.user);
      return updateUser(msg.user.id, msg.user);
    case 'read':
      forgetUnread(msg.conv);
      renderContacts();
      renderRooms();
      return renderRail();
    case 'typing':
      return showTyping(msg);
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
        // Новый конверт — старый расшифрованный текст не оставляем, иначе расшифровка его пропустит и видна старая версия
        list[i] = { ...list[i], ...msg.message, plain: null };
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
    case 'call:resumed': {
      // Сервер подтвердил: мы снова в том же звонке, разговор продолжается
      const c = state.call;
      if (c?.callId !== msg.callId) return;
      clearTimeout(c.resumeTimer);
      c.resumeTimer = null;
      if (c.phase === 'reconnecting') c.phase = c.connectedAt ? 'connected' : 'connecting';
      renderVoice();
      renderChatHeader();
      return;
    }
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
      if (msg.type.startsWith('room:') || msg.type.startsWith('event:')) handleRoomEvent(msg);
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
  // Звонящий может застать нас в голосовом канале: предлагаем выйти из него и принять
  if (state.room) {
    const ok = await ask('Вы в голосовом канале. Выйти из него и принять звонок?', {
      title: 'Принять звонок?',
      ok: 'Выйти и принять',
    });
    if (!ok) return; // остаёмся в канале, звонок продолжает звонить
    leaveRoomVoice();
  }
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
  } else if (st === 'reconnecting') {
    toast(`Связь с ${name} прервалась, ждём…`);
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
$('call-add-x').onclick = () => $('call-add-modal').classList.add('hidden');

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

// Связь вернулась: просим сервер вернуть нас в тот же звонок. Если за 25 секунд он не подтвердит,
// значит звонок уже завершён — тогда честно показываем это человеку
function resumeCall() {
  const c = state.call;
  if (!c?.callId) return;
  socket.send({ type: 'call:resume', callId: c.callId });
  clearTimeout(c.resumeTimer);
  c.resumeTimer = setTimeout(() => {
    if (state.call === c) finishCall('Связь с сервером не восстановилась, звонок завершён');
  }, 25_000);
}

function finishCall(message) {
  const c = state.call;
  if (!c) return;
  state.call = null;
  clearTimeout(c.failTimer);
  clearTimeout(c.resumeTimer);
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
let pickedName = null;

async function fillDeviceSelect(select, kind, selected) {
  let devices = await navigator.mediaDevices.enumerateDevices();
  // Без разрешения названия устройств пустые. Для камеры тоже просим доступ:
  // иначе в списке нет нормальных имён, а «Проверить камеру» молча падает.
  if (devices.some((d) => d.kind === kind && !d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(
        kind === 'videoinput' ? { video: true } : { audio: true }
      );
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
  if (select.id === 'set-cam') updateCamLabel();
}

function updateCamLabel() {
  const select = $('set-cam');
  const btn = $('cam-picker-btn');
  if (!select || !btn) return;
  btn.textContent = select.selectedOptions[0]?.textContent || 'По умолчанию';
}

/** Ряд кружков с цветами; null — «как у аватара» */
/** #abc → #AABBCC, мусор → null */
function normalizeHex(value) {
  let v = String(value).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(v)) return null;
  return `#${v.toUpperCase()}`;
}

/** Цвет текста на плашке: светлый на тёмном, тёмный на светлом */
function readableText(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#11131a' : '#ffffff';
}

let colorResolve = null;
function closeColor(value) {
  $('color-modal').classList.add('hidden');
  const done = colorResolve;
  colorResolve = null;
  done?.(value);
}

/** Окно «Свой цвет»: палитра, поле HEX и системный выбор. Возвращает цвет или null */
function askColor(current) {
  const start = normalizeHex(current) || normalizeHex(pickedColor) || '#7B6CFF';
  const input = $('color-hex');
  const native = $('color-native');
  input.value = start;
  native.value = start.toLowerCase();
  $('color-error').textContent = '';
  const preview = (hex) => {
    const box = $('color-preview');
    box.style.background = hex;
    box.style.color = readableText(hex);
    $('color-preview-hex').textContent = hex;
  };
  preview(start);
  $('color-modal').classList.remove('hidden');
  setTimeout(() => { input.focus(); input.select(); }, 30);
  return new Promise((resolve) => {
    colorResolve = resolve;
    const onEscape = (e) => {
      if (e.key !== 'Escape') return;
      document.removeEventListener('keydown', onEscape, true);
      closeColor(null);
    };
    document.addEventListener('keydown', onEscape, true);
  });
}

// Поле HEX: принимаем и #abc, и abc, и с решёткой; пока ввод неверный — подсказываем
$('color-hex').oninput = () => {
  const hex = normalizeHex($('color-hex').value);
  $('color-error').textContent = hex ? '' : 'Нужен код вида #7B6CFF';
  if (!hex) return;
  $('color-preview').style.background = hex;
  $('color-preview').style.color = readableText(hex);
  $('color-preview-hex').textContent = hex;
  $('color-native').value = hex.toLowerCase();
};
$('color-hex').onkeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('color-ok').click();
  }
};
$('color-native').oninput = () => {
  const hex = normalizeHex($('color-native').value);
  if (!hex) return;
  $('color-hex').value = hex;
  $('color-hex').oninput();
};
$('color-native-btn').onclick = () => $('color-native').click();
$('color-cancel').onclick = () => closeColor(null);
$('color-ok').onclick = () => {
  const hex = normalizeHex($('color-hex').value);
  if (!hex) {
    $('color-error').textContent = 'Нужен код вида #7B6CFF';
    $('color-hex').focus();
    return;
  }
  closeColor(hex);
};

function colorChoices(box, colors, current, onPick) {
  box.replaceChildren();
  for (const color of colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `color${color === current ? ' selected' : ''}${color ? '' : ' auto'}`;
    b.dataset.color = color || '';
    b.style.background = color || pickedColor;
    if (!color) b.title = 'Как у аватара';
    b.onclick = () => onPick(color);
    box.append(b);
  }
  // Свой цвет: если он уже выбран и не совпал с готовыми — кружок показывает его же
  const own = current && !colors.includes(current) ? current : null;
  const custom = document.createElement('button');
  custom.type = 'button';
  custom.className = `color custom${own ? ' selected' : ''}`;
  custom.title = own ? `Свой цвет ${own}` : 'Свой цвет';
  if (own) custom.style.background = own;
  custom.onclick = async () => {
    const hex = await askColor(own);
    if (hex) onPick(hex);
  };
  box.append(custom);
}

function renderColorPicker() {
  colorChoices($('color-picker'), COLORS, pickedColor, (color) => {
    pickedColor = color;
    renderColorPicker();
  });
  colorChoices($('banner-picker'), [null, ...BANNER_COLORS], pickedBanner, (color) => {
    pickedBanner = color;
    renderColorPicker();
  });
  colorChoices($('name-picker'), [null, ...COLORS], pickedName, (color) => {
    pickedName = color;
    renderColorPicker();
  });
}

// Навели на цвет баннера — показываем, как будет выглядеть карточка профиля.
// Слушаем весь ряд: кружки перерисовываются под мышью, и ухода с них браузер уже не сообщит
$('banner-picker').addEventListener('mouseover', (e) => {
  const swatch = e.target.closest('.color');
  if (swatch) showBannerPeek(swatch);
});
$('banner-picker').addEventListener('mouseleave', hideBannerPeek);

function hideBannerPeek() {
  $('banner-peek').classList.add('hidden');
}

/** Мини-карточка профиля с цветом баннера из наведённого кружка */
function showBannerPeek(swatch) {
  const peek = $('banner-peek');
  const bannerColor = swatch.dataset.color || pickedColor; // «как у аватара» — цвет аватара
  peek.querySelector('.pc-banner').style.setProperty('--banner', bannerColor);
  const name = $('set-display').value.trim() || state.me.displayName;
  const avatar = $('banner-peek-avatar');
  avatar.textContent = name.trim().charAt(0).toUpperCase();
  avatar.style.background = pickedColor;
  $('banner-peek-name').textContent = name;
  peek.classList.remove('hidden');
  // Ставим карточку над кружком, а если места нет — под ним
  const r = swatch.getBoundingClientRect();
  const box = peek.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left - 8, innerWidth - box.width - 8));
  const top = r.top - box.height - 8 < 8 ? r.bottom + 8 : r.top - box.height - 8;
  peek.style.left = `${left}px`;
  peek.style.top = `${top}px`;
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

// Человек выбирает квадрат, уменьшаем до 256×256 и сжимаем в WebP. null — передумал
async function makeAvatarBlob(file, { title = 'Выберите область', round = true } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Не получилось открыть картинку. Попробуйте JPG или PNG');
  }
  const area = await askCrop(bitmap, { title, round });
  if (!area) {
    bitmap.close();
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, area.x, area.y, area.side, area.side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
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
    const blob = await makeAvatarBlob(file, { title: 'Фото профиля' });
    if (!blob) return;
    applyMe(await Api.upload('PUT', '/me/avatar', blob));
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
  privacy: 'Данные и конфиденциальность',
  about: 'О приложении',
};

function showSettingsTab(tab) {
  const current = SETTINGS_TABS[tab] ? tab : 'profile';
  $('set-title').textContent = SETTINGS_TABS[current];
  for (const b of document.querySelectorAll('#set-nav [data-tab]')) b.classList.toggle('active', b.dataset.tab === current);
  for (const p of document.querySelectorAll('#settings .set-pane')) p.classList.toggle('hidden', p.dataset.pane !== current);
  document.getElementById('privacy-subnav')?.classList.toggle('hidden', current !== 'privacy');
  document.getElementById('settings')?.classList.toggle('privacy-mode', current === 'privacy');
  // Оформление: подложка без размытия — видно, как выбранная тема ложится на приложение
  document.getElementById('settings')?.classList.toggle('look-preview', current === 'look');
  $('settings').querySelector('.set-body').scrollTop = 0;
  if (current === 'privacy') {
    showPrivacyPage(window.privacyPage || 'data');
    renderPrivacySettings();
  }
  if (current === 'account') {
    renderDevices();
    renderTwoFactor();
  }
}

for (const b of document.querySelectorAll('#set-nav [data-tab]')) b.onclick = () => showSettingsTab(b.dataset.tab);

/** tab — раздел, который открыть (по кнопке настроек приходит событие щелчка — тогда «Профиль») */
async function openSettings(tab) {
  showSettingsTab(typeof tab === 'string' ? tab : 'profile');
  // Компоненты стекла перерисовываем после того, как вкладка показана
  setTimeout(() => {
    window.initGlassControls?.();
  }, 0);
  renderThemePicker();
  renderPttSettings();
  renderNotifySettings();
  renderSoundSettings();
  $('email-link').classList.add('hidden');
  $('link-email').value = '';
  renderIdentities();
  renderPasswordSection();
  renderAvatarEditor();
  $('set-display').value = state.me.displayName;
  pickedColor = state.me.avatarColor;
  pickedBanner = state.me.bannerColor || null;
  pickedName = state.me.nameColor || null;
  $('set-bio').value = state.me.bio || '';
  renderColorPicker();
  $('set-ns-level').value = String(noiseLevelOf());
  if ($('set-ns-value')) $('set-ns-value').textContent = NOISE_LEVELS.find((l) => l.value === noiseLevelOf())?.name || '';
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
  hideBannerPeek();
  stopMicMeter();
  stopCamPreview();
}

// ---------- Проверка микрофона, динамиков и камеры ----------

const settingsOpen = () => !$('settings').classList.contains('hidden');
const formAudioSettings = () => ({ micId: $('set-mic').value, noiseLevel: Number($('set-ns-level').value) });
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

async function startCameraPreview(deviceId = '') {
  if (camPreview) {
    camPreview.getTracks().forEach((t) => t.stop());
    camPreview = null;
  }
  $('camera-error').textContent = '';
  try {
    camPreview = await navigator.mediaDevices.getUserMedia(cameraConstraints({ camId: deviceId }));
    for (const id of ['cam-preview', 'camera-preview']) {
      const el = $(id);
      if (!el) continue;
      el.srcObject = camPreview;
      el.classList.remove('hidden');
    }
    $('cam-test-btn').textContent = 'Закрыть камеру';
  } catch (err) {
    camPreview = null;
    $('camera-error').textContent = mediaErrorText(err, 'камера');
    $('camera-hint').textContent = 'Камера недоступна. Проверьте, что она не занята другим приложением и разрешение выдано.';
  }
}

function stopCamPreview() {
  camPreview?.getTracks().forEach((t) => t.stop());
  camPreview = null;
  for (const id of ['cam-preview', 'camera-preview']) {
    const el = $(id);
    if (el) { el.srcObject = null; el.classList.add('hidden'); }
  }
  $('cam-test-btn').textContent = 'Проверить камеру';
}

async function renderCameraList() {
  const select = $('set-cam');
  const list = $('camera-list');
  if (!select || !list) return;
  list.replaceChildren();
  const options = [...select.options];
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'camera-option' + (option.value === select.value ? ' active' : '');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.textContent = option.textContent;
    button.append(dot, label);
    button.onclick = async () => {
      select.value = option.value;
      updateCamLabel();
      await renderCameraList();
      await startCameraPreview(option.value);
    };
    list.append(button);
  }
  $('camera-hint').textContent = options.length <= 1
    ? 'Камеры не найдены — проверьте подключение и разрешение Windows/macOS.'
    : 'Выберите камеру — картинка обновится сразу.';
}

async function openCameraPicker() {
  const dialog = $('camera-picker');
  dialog.classList.remove('hidden');
  if (typeof dialog.showModal === 'function' && !dialog.open) {
    try { dialog.showModal(); } catch { /* уже открыт */ }
  }
  await fillDeviceSelect($('set-cam'), 'videoinput', $('set-cam').value).catch(() => {});
  await renderCameraList();
  await startCameraPreview($('set-cam').value);
}

function closeCameraPicker() {
  const dialog = $('camera-picker');
  if (dialog.open) dialog.close();
  dialog.classList.add('hidden');
  stopCamPreview();
}

async function toggleCamPreview() {
  await openCameraPicker();
}

$('set-mic').onchange = startMicMeter;
// Шумоподавление переключается сразу — и в разговоре тоже
$('set-ns-level').oninput = () => {
  if ($('set-ns-value')) $('set-ns-value').textContent = NOISE_LEVELS.find((l) => l.value === Number($('set-ns-level').value))?.name || '';
};
$('set-ns-level').onchange = () => {
  setNoiseLevel(Number($('set-ns-level').value));
  startMicMeter();
};
$('set-speaker').onchange = () => micMonitor && startMicMonitor();
$('mic-monitor-btn').onclick = toggleMicMonitor;
$('mic-test-btn').onclick = recordMicTest;
$('speaker-test-btn').onclick = () => tone.blip('test', $('set-speaker').value, 0.15);
$('cam-test-btn').onclick = openCameraPicker;
$('cam-picker-btn').onclick = openCameraPicker;
$('camera-close').onclick = closeCameraPicker;
$('camera-picker').addEventListener('close', () => {
  $('camera-picker').classList.add('hidden');
  stopCamPreview();
});
$('set-cam').onchange = () => {
  updateCamLabel();
  if (!$('camera-picker').classList.contains('hidden')) startCameraPreview($('set-cam').value);
};

$('settings-form').onsubmit = async (e) => {
  e.preventDefault();
  $('settings-error').textContent = '';

  const body = {};
  const displayName = $('set-display').value.trim();
  if (displayName !== state.me.displayName) body.displayName = displayName;
  if (pickedColor !== state.me.avatarColor) body.avatarColor = pickedColor;
  if (pickedBanner !== (state.me.bannerColor || null)) body.bannerColor = pickedBanner;
  if (pickedName !== (state.me.nameColor || null)) body.nameColor = pickedName;
  const bio = $('set-bio').value.trim();
  if (bio !== (state.me.bio || '')) body.bio = bio;
  if ($('set-new-pass').value) {
    body.currentPassword = $('set-cur-pass').value;
    body.newPassword = $('set-new-pass').value;
  }

  try {
    if (Object.keys(body).length) {
      const { token, ...me } = await Api.patch('/me', body);
      rememberToken(token);
      state.me = me;
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
    noiseLevel: Number($('set-ns-level').value),
    ptt: document.querySelector('input[name="mic-mode"]:checked')?.value === 'ptt' && Boolean(pickedPtt),
    pttBinding: pickedPtt,
  };
  store.set('audio', state.settings);
  applyPtt();
  applySpeaker();
  const micChanged = prev.micId !== state.settings.micId || prev.noiseLevel !== state.settings.noiseLevel;
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
  unpacking: (s) => `Распаковываем версию ${s.version}…`,
  ready: (s) => `Версия ${s.version} скачана и готова к установке`,
  latest: () => 'У вас последняя версия',
  error: () => 'Не удалось проверить обновления',
  unsupported: () => 'Обновления работают только в установленной версии',
};

const isSkipped = (version) => store.get('skippedUpdate', null) === version;
const updateModalOpen = () => !$('update-modal').classList.contains('hidden');

// Сервер ответил 426: версия ниже минимальной. Показываем блокирующий экран,
// а не даём человеку ходить по пустому интерфейсу с ошибками.
let versionGateInfo = null;
function showVersionGate(info = {}) {
  versionGateInfo = { ...info };
  const current = window.desktop?.version || info.current || '';
  const min = info.minClient || '3.0.0';
  $('version-gate-meta').textContent = current
    ? `Ваша версия: ${current} · требуется: ${min}`
    : `Требуется версия ${min} или новее`;
  if (info.updateUrl) $('version-gate-link').href = info.updateUrl;
  $('version-gate').classList.remove('hidden');
  document.body.classList.add('version-blocked');
}

function hideVersionGate() {
  $('version-gate').classList.add('hidden');
  document.body.classList.remove('version-blocked');
}

function updateFromGate() {
  const btn = $('version-gate-update');
  if (!window.desktop?.update) {
    $('version-gate-link').click();
    return;
  }
  manualCheck = true;
  if (updateStatus.state === 'ready') {
    hideVersionGate();
    startUpdate();
    return;
  }
  if (updateStatus.state === 'available') {
    openUpdateModal();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Проверяем обновление…';
  updateStatus = { ...updateStatus, state: 'checking' };
  renderUpdate();
  window.desktop.update.check();
  setTimeout(() => {
    if (!versionGateInfo) return;
    btn.disabled = false;
    btn.textContent = 'Обновить Созвон';
  }, 8000);
}

// Описание релиза приходит в HTML — превращаем в простой текст, ничего из него не выполняя
function notesToText(html) {
  const fallback = 'Исправления и улучшения.';
  if (!html) return fallback;
  const prepared = html.replace(/<li[^>]*>/gi, '• ').replace(/<\/(li|p|h[1-6]|ul|ol)>|<br\s*\/?>/gi, '\n');
  const text = new DOMParser().parseFromString(prepared, 'text/html').body.textContent || '';
  return text.replace(/\n{3,}/g, '\n\n').trim() || fallback;
}

/** mode: 'available' | 'latest' | 'error'.
 *  latest — версия уже последняя: показываем, что нового в ней, без кнопок обновления.
 *  error — проверка не удалась: объясняем, даём повторить и ссылку на релизы */
function openUpdateModal(mode = 'available') {
  const s = updateStatus;
  const latest = mode === 'latest';
  const failed = mode === 'error';
  const required = Boolean(versionGateInfo);
  $('update-modal').classList.toggle('latest', latest);
  $('update-modal').classList.toggle('failed', failed);
  $('update-modal').classList.toggle('required', required);
  if (required) hideVersionGate();
  $('update-notes').classList.toggle('hidden', failed);
  $('update-notes-title').classList.toggle('hidden', failed);
  $('update-title').textContent = failed
    ? 'Не удалось проверить обновления'
    : latest
      ? `У вас последняя версия ${s.current}`
      : `Доступно обновление ${s.version}`;
  $('update-current').textContent = failed
    ? `Сейчас у вас версия ${s.current}. Проверьте интернет и попробуйте ещё раз — обновление выйдет, когда появится новая версия.`
    : latest
      ? 'Обновлений нет — вот что появилось в этой версии'
      : `Сейчас у вас версия ${s.current}`;
  $('update-notes').textContent = failed ? '' : notesToText(s.notes);
  $('update-error').textContent = failed ? s.message || 'Проверьте интернет и попробуйте ещё раз' : '';
  // Кнопки: при ошибке вместо «Пропустить» — повтор проверки и ссылка на релизы
  $('update-skip').classList.toggle('hidden', failed);
  $('update-releases').classList.toggle('hidden', !failed);
  $('update-now').textContent = failed ? 'Повторить' : 'Обновить';
  $('update-now').onclick = failed ? retryUpdateCheck : startUpdate;
  $('update-modal').classList.remove('hidden');
  renderUpdate();
}

/** Повторная проверка по кнопке из окна с ошибкой */
function retryUpdateCheck() {
  $('update-error').textContent = '';
  manualCheck = true;
  updateStatus = { ...updateStatus, state: 'checking' };
  renderUpdate();
  window.desktop.update.check();
}

function closeUpdateModal() {
  $('update-modal').classList.add('hidden');
  renderUpdate();
}

/** Обёртка: расчёт живёт в update-bar.mjs и покрыт тестом. */
function placeUpdateBar() {
  if (window.UpdateBar?.place) return window.UpdateBar.place();
  // На случай очень старого кэша без модуля — прежнее поведение не теряем.
  const bar = $('update-bar');
  const voice = $('voice-panel');
  if (!bar || !voice || !voice.getClientRects().length) return;
  const r = voice.getBoundingClientRect();
  bar.style.left = `${Math.round(r.left)}px`;
  bar.style.width = `${Math.round(r.width)}px`;
  bar.style.borderRadius = getComputedStyle(voice).borderRadius;
}

window.addEventListener('resize', () => requestAnimationFrame(placeUpdateBar));

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
  requestAnimationFrame(placeUpdateBar);
}

// Сначала говорим, что происходит: иначе окно просто исчезает, и человек жмёт на ярлык,
// пока установщик меняет файлы, — Windows отвечает «Отсутствует ярлык»
function installUpdate() {
  hangup();
  leaveRoomVoice();
  for (const el of document.querySelectorAll('.modal')) el.classList.add('hidden');
  $('updating').classList.remove('hidden');
  setTimeout(() => window.desktop.update.install(), 1500);
  // Если установка не закрыла приложение за 25 секунд — не оставляем человека на экране-заглушке.
  setTimeout(() => {
    if (updateStatus.state !== 'ready') return;
    $('updating').classList.add('hidden');
    toast('Не удалось установить обновление автоматически. Скачайте новую версию со страницы релиза.');
  }, 25000);
}

async function startUpdate() {
  if (activeSession() && !(await ask('После загрузки приложение перезапустится, и звонок завершится.', { title: 'Сейчас идёт звонок', ok: 'Обновить' })))
    return;
  // macOS без сертификата Apple: приложение качает архив с GitHub и подменяет себя само,
  // поэтому здесь тот же путь, что и в Windows
  updateRequested = true;
  $('update-error').textContent = '';
  if (updateStatus.state === 'ready') return installUpdate();
  window.desktop.update.download(Api.base);
  renderUpdate();
}

function onUpdateStatus(s) {
  updateStatus = { ...updateStatus, ...s };
  const { state: st, version } = updateStatus;
  // Окно «Что нового» само открывается только по кнопке; при запуске — плашка и точка (renderUpdate)
  if (st === 'available' && manualCheck) openUpdateModal();
  if (manualCheck && st === 'latest') openUpdateModal('latest');
  // Не «проверьте интернет» всплывашкой, а окно с объяснением, кнопкой «Повторить» и ссылкой на релизы
  if (manualCheck && st === 'error') openUpdateModal('error');
  if (manualCheck && st === 'unsupported') toast('Обновления работают только в установленной версии');
  if (['available', 'latest', 'error', 'unsupported'].includes(st)) manualCheck = false;
  if (st === 'ready' && updateRequested) installUpdate();
  if (st === 'error') {
    $('updating').classList.add('hidden');
    if (updateRequested) {
      updateRequested = false;
      $('update-error').textContent = 'Не удалось установить обновление. Скачайте новую версию со страницы релиза.';
      openUpdateModal('error');
    }
  }
  renderUpdate();
}

if (window.desktop?.update) {
  $('about-section').classList.remove('hidden');
  $('version-gate-update').onclick = updateFromGate;
  window.desktop.update.onStatus(onUpdateStatus);
  window.desktop.update.status().then(onUpdateStatus).catch(() => {});

  $('update-now').onclick = startUpdate;
  $('update-later').onclick = closeUpdateModal;
  $('update-close').onclick = closeUpdateModal;
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
  readSeenNotifs();
  if (state.me) readOpenChat();
  renderContacts();
});

window.addEventListener('beforeunload', () => {
  hangup();
  leaveRoomVoice();
});

// ---------- Запуск ----------

// Возврат из сервиса входа в браузере: в адресе одноразовый код, токен в адрес не попадает
async function completeWebOAuth() {
  if (!isWeb) return false;
  const params = new URLSearchParams(location.search);
  const code = params.get('oauth_code');
  const error = params.get('oauth_error');
  if (!code && !error) return false;
  history.replaceState(null, '', location.pathname);
  if (error) {
    $('auth-error').textContent = error;
    return false;
  }
  Api.base = location.origin;
  try {
    const result = await Api.post('/oauth/web/exchange', { code });
    if (result.ticket) {
      showPendingSignup(result.ticket, 'yandex');
      return false;
    }
    finishLogin(location.origin, result);
    return true;
  } catch (err) {
    $('auth-error').textContent = err.message || 'Не удалось войти через сервис';
    return false;
  }
}

let bootStarted = false;
async function boot() {
  if (bootStarted) return;
  bootStarted = true;
  setAuthMode(false);
  applySpeaker();
  Api.onUpdateRequired = showVersionGate;
  // Сервер по умолчанию общий; свой адрес вводят по ссылке «Свой сервер» (docs/self-hosting.md)
  const applyServer = () => {
    const url = isWeb ? location.origin : normalizeServer($('server-url').value) || DEFAULT_SERVER;
    const host = url.replace(/^https?:\/\//, '');
    $('server-hint').classList.toggle('hidden', isWeb || url === DEFAULT_SERVER);
    $('server-current').textContent = host;
    $('server-current-main').textContent = host;
    return url;
  };
  $('server-url').value = (!isWeb && store.get('customServer', '')) || DEFAULT_SERVER;
  $('server-url').onchange = () => {
    if (isWeb) return;
    const url = normalizeServer($('server-url').value) || DEFAULT_SERVER;
    store.set('customServer', url === DEFAULT_SERVER ? '' : url);
    $('server-url').value = url;
    applyServer();
    loadProviders(url);
  };
  const startServer = applyServer();
  Api.base = startServer;
  // Проверяем политику версий до входа: старый клиент сразу видит причину,
  // а не ошибку входа «Сервер недоступен» после каждого действия.
  Api.get('/version')
    .then((policy) => {
      if (policy?.updateRequired) showVersionGate(policy);
    })
    .catch(() => {});
  loadProviders(isWeb ? location.origin : startServer);

  // Вернулись из Яндекса — входим сразу, экран авторизации не показываем
  if (await completeWebOAuth()) return;

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
    $('server-current-main').textContent = session.base.replace(/^https?:\/\//, '');
    try {
      return enterMain(await Api.get('/me'));
    } catch (err) {
      if (err.status === 401) store.set('session', null);
      $('auth-error').textContent = err.status === 401 ? 'Сессия истекла, войдите заново' : err.message;
    }
  }
  showScreen('auth');
}

window.addEventListener('DOMContentLoaded', () => { if (!window.__bootstrapPending) boot(); });
// ---------- Баннер профиля картинкой или GIF ----------

async function uploadBanner(file) {
  $('settings-error').textContent = '';
  $('banner-upload-btn').disabled = true;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Баннер — не больше 2 МБ');
    applyMe(await Api.upload('PUT', '/me/banner', file));
    toast('Баннер профиля обновлён');
  } catch (err) {
    $('settings-error').textContent = err.message;
  } finally {
    $('banner-upload-btn').disabled = false;
  }
}

$('banner-upload-btn').onclick = () => $('banner-input').click();
$('banner-input').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) uploadBanner(file);
};
$('banner-remove-btn').onclick = async () => {
  try {
    applyMe(await Api.del('/me/banner'));
    toast('Баннер убран');
  } catch (err) {
    $('settings-error').textContent = err.message;
  }
};
