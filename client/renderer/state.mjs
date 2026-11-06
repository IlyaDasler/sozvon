// Состояние приложения и хранилище настроек. ES-модуль.
// Токен и закрытый ключ на диске — только зашифрованными (vault.js)
// Секретным считается и ключ шифрования нового вида: e2ee:<сервер>:identity:<id>
const isSecret = (key) => key === 'session' || (key.startsWith('e2ee:') && key.includes(':identity:'));

const store = {
  get(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      if (!isSecret(key) || !window.desktop?.vault) return value ?? fallback;
      if (value?.vault) return JSON.parse(window.desktop.vault.open(value.vault)) ?? fallback;
      if (value !== null) store.set(key, value); // запись прежних версий, ещё открытая
      return value ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      // Нет хранилища системы (веб-версия) — остаётся как есть
      const sealed = value !== null && isSecret(key) ? window.desktop?.vault?.seal(JSON.stringify(value)) : null;
      localStorage.setItem(key, JSON.stringify(sealed ? { vault: sealed } : value));
    } catch {}
  },
};

/** Старые настройки звука: галочка noiseSuppression превращается в уровень 2 (или 0, если была выключена) */
function migratedAudioSettings() {
  const saved = store.get('audio', {}) || {};
  if ('noiseLevel' in saved) return saved;
  const { noiseSuppression, ...rest } = saved;
  return { ...rest, noiseLevel: noiseSuppression === false ? 0 : 3 };
}

const state = {
  me: null,
  contacts: new Map(),
  selectedId: null,
  history: new Map(), // id друга -> сообщения
  historyEnd: new Set(), // переписки, у которых старых сообщений больше нет
  readMarks: new Map(), // непрочитанные переписки -> последнее прочитанное сообщение
  newLine: null, // { conv, lastRead } — где в открытом чате линия «Новые сообщения»
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
  // noiseLevel: 0 — выкл, 1 — мягкое, 2 — среднее, 3 — сильное. Старая галочка noiseSuppression
  // превращается в «среднее», чтобы у людей не поменялось поведение после обновления
  settings: { micId: '', speakerId: '', camId: '', noiseLevel: 3, ...migratedAudioSettings() },  registerMode: false,
  providers: [], // способы входа, включённые на сервере: [{ id, name }]
  inviteRequired: true, // требует ли сервер код приглашения при регистрации
  pendingSignup: null, // { ticket } — аккаунт сервиса подтверждён, ждём код приглашения
};


if (typeof window !== 'undefined') {
  window.store = store;
  window.state = state;
}

export { store, state };
