import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from './config.js';
import { canonicalEmail } from './email-address.js';
import { ALL_PERMS, DEFAULT_PERMS, PERMS, rankOf } from './perms.js';

export const db = new DatabaseSync(path.join(config.dataDir, 'sozvon.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, contact_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_pair ON messages (from_id, to_id, id);

  -- Аккаунты сервисов (сейчас — Яндекс), через которые можно войти в профиль
  CREATE TABLE IF NOT EXISTS identities (
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, provider_user_id),
    UNIQUE (user_id, provider)
  );

  -- Комнаты: голосовые (общий голосовой канал + чат) и текстовые (только чат)
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('voice', 'text')),
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS room_members (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS room_members_user ON room_members (user_id);

  CREATE TABLE IF NOT EXISTS room_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS room_messages_room ON room_messages (room_id, id);

  -- Роли комнаты: название, цвет и набор прав (см. perms.js)
  CREATE TABLE IF NOT EXISTS room_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    perms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS room_roles_room ON room_roles (room_id);

  -- Загруженные файлы: пока used = 0, файл ещё не прикреплён ни к одному сообщению
  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    kind TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  -- Заявки в друзья: from_id зовёт to_id; друзьями становятся, когда to_id примет
  CREATE TABLE IF NOT EXISTS friend_requests (
    from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (from_id, to_id)
  );
  CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests (to_id);

  -- Кого человек заблокировал: ни заявок, ни дружбы в обе стороны
  CREATE TABLE IF NOT EXISTS blocks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, blocked_id)
  );

  CREATE TABLE IF NOT EXISTS room_bans (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    by_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );

  -- Каналы (в коде — hubs; не путать с hub.js, рассылкой по WebSocket): свой «сервер» с комнатами внутри.
  -- Участник канала — участник его комнат (кроме тех, где забанен); создатель может всё,
  -- управляющий (manager = 1) — создавать и удалять комнаты, переименовывать, звать, выгонять и банить
  CREATE TABLE IF NOT EXISTS hubs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    icon_color TEXT NOT NULL,
    icon TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hub_members (
    hub_id INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    manager INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (hub_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS hub_members_user ON hub_members (user_id);

  -- Приглашения: друг вступает в канал, только когда сам примет
  CREATE TABLE IF NOT EXISTS hub_invites (
    hub_id INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    by_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (hub_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS hub_invites_user ON hub_invites (user_id);

  -- Ключи переписок: для каждой версии (epoch) ключа — копия, запечатанная публичным ключом участника.
  -- Сервер открыть их не может; conv — «dm:<a>-<b>» или «room:<id>»
  CREATE TABLE IF NOT EXISTS conv_keys (
    conv TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sealed TEXT NOT NULL,
    by_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (conv, epoch, user_id)
  );
  CREATE INDEX IF NOT EXISTS conv_keys_user ON conv_keys (user_id);

  -- Перенос ключа на новое устройство: зашифрованный кодом ключ, живёт 10 минут; id — хэш кода
  CREATE TABLE IF NOT EXISTS key_transfers (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blob TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hub_bans (
    hub_id INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    by_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (hub_id, user_id)
  );
`);

// Миграции для баз, созданных старыми версиями
const columnsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
if (!columnsOf('users').includes('avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
// Почта для входа (в нижнем регистре); у старых профилей её нет
if (!columnsOf('users').includes('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
// Роли живут в канале: одна роль на все его комнаты. room_roles и room_members.role_id остались от версий до 2.6.3
// и нужны только для переноса ниже
const rolesInHubs = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hub_roles'").get());
db.exec(`
  CREATE TABLE IF NOT EXISTS hub_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hub_id INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    perms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS hub_roles_hub ON hub_roles (hub_id);
`);
if (!columnsOf('hub_members').includes('role_id')) db.exec('ALTER TABLE hub_members ADD COLUMN role_id INTEGER');
// Своё имя участника в канале: видно только в этом канале и его комнатах
db.exec(`
  CREATE TABLE IF NOT EXISTS hub_nicknames (
    hub_id INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    PRIMARY KEY (hub_id, user_id)
  );
`);
// События канала: собираемся играть в 21:00. Публикуются сообщением в выбранную комнату,
// а готовность участников («буду», «не смогу», «готов в 21:30») живёт здесь
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    hub_id INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    starts_at INTEGER NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS event_responses (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    ready_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, user_id)
  );
`);
// Повтор события и напоминание: каждый день, по будням, раз в неделю; напомнить за N минут
for (const [name, sql] of [
  ['repeat', "ALTER TABLE events ADD COLUMN repeat TEXT NOT NULL DEFAULT 'none'"],
  ['remind', 'ALTER TABLE events ADD COLUMN remind INTEGER NOT NULL DEFAULT 0'],
  ['last_remind', 'ALTER TABLE events ADD COLUMN last_remind INTEGER'],
  ['active', 'ALTER TABLE events ADD COLUMN active INTEGER NOT NULL DEFAULT 1'],
]) {
  if (!columnsOf('events').includes(name)) db.exec(sql);
}
db.exec(`
  CREATE TABLE IF NOT EXISTS room_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hub_id INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
    name TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS room_groups_hub ON room_groups (hub_id);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS hub_emojis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hub_id INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    UNIQUE (hub_id, name)
  );
`);
if (!columnsOf('rooms').includes('group_id')) db.exec('ALTER TABLE rooms ADD COLUMN group_id INTEGER');
  // Приватная комната: видна только приглашённым, а не всем участникам канала
  if (!columnsOf('rooms').includes('private')) db.exec('ALTER TABLE rooms ADD COLUMN private INTEGER NOT NULL DEFAULT 0');

  // Треды: ответ в треде хранится отдельной строкой и ссылается на корневое сообщение.
  // В основной ленте такие ответы не показываются, их видно только внутри треда
  if (!columnsOf('room_messages').includes('thread_root')) db.exec('ALTER TABLE room_messages ADD COLUMN thread_root INTEGER');
  // @all: флаг хранится в сообщении, чтобы он переживал перезагрузку и был виден всем
  if (!columnsOf('room_messages').includes('mention_all')) db.exec('ALTER TABLE room_messages ADD COLUMN mention_all INTEGER NOT NULL DEFAULT 0');
  if (!columnsOf('messages').includes('thread_root')) db.exec('ALTER TABLE messages ADD COLUMN thread_root INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS room_messages_thread ON room_messages (thread_root, id)');
  db.exec('CREATE INDEX IF NOT EXISTS messages_thread ON messages (thread_root, id)');
// Свой порядок комнат в канале (перетаскивание): меньше — выше
if (!columnsOf('rooms').includes('position')) db.exec('ALTER TABLE rooms ADD COLUMN position INTEGER');
db.exec('UPDATE rooms SET position = id WHERE position IS NULL');
if (!columnsOf('hubs').includes('reactions_visible')) db.exec('ALTER TABLE hubs ADD COLUMN reactions_visible INTEGER NOT NULL DEFAULT 1');
if (!columnsOf('hubs').includes('default_perms')) db.exec(`ALTER TABLE hubs ADD COLUMN default_perms INTEGER NOT NULL DEFAULT ${DEFAULT_PERMS}`);

// Токены версий до сессий (см. sessions.js) больше не действуют
if (!columnsOf('users').includes('legacy_revoked')) db.exec('ALTER TABLE users ADD COLUMN legacy_revoked INTEGER NOT NULL DEFAULT 0');
// Двухфакторный вход: секрет, ещё не подтверждённый секрет, последний принятый шаг, хэши резервных кодов
for (const [column, type] of [['totp_secret', 'TEXT'], ['totp_pending', 'TEXT'], ['totp_last_step', 'INTEGER NOT NULL DEFAULT 0'], ['totp_recovery', 'TEXT']])
  if (!columnsOf('users').includes(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} ${type}`);
// email — единый вид адреса (по нему вход и «ящик занят»), email_shown — как человек его ввёл, его и показываем
if (!columnsOf('users').includes('email_shown')) db.exec('ALTER TABLE users ADD COLUMN email_shown TEXT');
// Выбранный статус: online, idle, dnd, invisible (см. presence.js)
// Вложения и предпросмотр ссылки хранятся в сообщении как JSON
for (const table of ['messages', 'room_messages']) {
  const cols = columnsOf(table);
  if (!cols.includes('attachments')) db.exec(`ALTER TABLE ${table} ADD COLUMN attachments TEXT`);
  if (!cols.includes('preview')) db.exec(`ALTER TABLE ${table} ADD COLUMN preview TEXT`);
}
// Карточка профиля: «О себе» и цвет баннера (пусто — по цвету аватара)
if (!columnsOf('users').includes('bio')) db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
if (!columnsOf('users').includes('banner_color')) db.exec('ALTER TABLE users ADD COLUMN banner_color TEXT');
// Баннер картинкой или гифкой: имя файла в data/banners, пусто — только цвет
if (!columnsOf('users').includes('banner')) db.exec('ALTER TABLE users ADD COLUMN banner TEXT');
  // Запущенная игра: приходит из приложения (детект процессов) и показывается в профиле
  if (!columnsOf('users').includes('game')) db.exec('ALTER TABLE users ADD COLUMN game TEXT');
    nameColor: row.name_color || null,
    memberSince: row.created_at,
    publicKey: row.public_key || null,
  };

const parseJson = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

export const toMessage = (row) => ({
  id: row.id,
  fromId: row.from_id,
  toId: row.to_id,
  text: row.text,
  attachments: parseJson(row.attachments, []),
  preview: parseJson(row.preview, null),
  enc: parseJson(row.enc, null),
  replyTo: row.reply_to || null,
  mentionAll: Boolean(row.mention_all),
  threadRoot: row.thread_root || null,
  editedAt: row.edited_at || null,
  createdAt: row.created_at,
});

const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  setEmail: db.prepare('UPDATE users SET email = ?, email_shown = ? WHERE id = ?'),
  setStatus: db.prepare('UPDATE users SET status = ? WHERE id = ?'),
  insertUser: db.prepare(
    'INSERT INTO users (username, password_hash, display_name, avatar_color, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  updateProfile: db.prepare('UPDATE users SET display_name = ?, avatar_color = ?, bio = ?, banner_color = ?, name_color = ? WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  uploadsSize: db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM uploads WHERE owner_id = ?'),
  revokeLegacy: db.prepare('UPDATE users SET legacy_revoked = 1 WHERE id = ?'),
  setTotpPending: db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?'),
  enableTotp: db.prepare('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = ?, totp_recovery = ? WHERE id = ?'),
  disableTotp: db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_last_step = 0, totp_recovery = NULL WHERE id = ?'),
  setTotpStep: db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?'),
  setTotpRecovery: db.prepare('UPDATE users SET totp_recovery = ? WHERE id = ?'),
  updateAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),
  updateBanner: db.prepare('UPDATE users SET banner = ? WHERE id = ?'),
  updateGame: db.prepare('UPDATE users SET game = ? WHERE id = ?'),
};

// Дружба взаимная: при добавлении записываем обе стороны
export const contacts = {
  list: (userId) => q.listContacts.all(userId),
  has: (userId, contactId) => Boolean(q.hasContact.get(userId, contactId)),
  setTheme: (a, b, theme) => q.setChatTheme.run(theme, a, b, b, a),
  setWallpaper: (a, b, file) => q.setContactWallpaper.run(file, a, b, b, a),
  wallpaperOf: (a, b) => q.contactWallpaperOf.get(a, b)?.wallpaper || null,
  add(a, b) {
    const now = Date.now();
    q.addContact.run(a, b, now);
    q.addContact.run(b, a, now);
    q.removeRequest.run(a, b);
    q.removeRequest.run(b, a);
  },
  remove(a, b) {
    q.removeContact.run(a, b);
    q.removeContact.run(b, a);
  },
};

/** Заявки в друзья: from зовёт to */
export const friendRequests = {
  incoming: (userId) => q.incomingRequests.all(userId),
  outgoing: (userId) => q.outgoingRequests.all(userId),
  has: (fromId, toId) => Boolean(q.hasRequest.get(fromId, toId)),
  add: (fromId, toId) => q.addRequest.run(fromId, toId, Date.now()),
  remove: (fromId, toId) => q.removeRequest.run(fromId, toId),
};

/** Блокировка односторонняя, но мешает в обе стороны: ни заявок, ни дружбы */
export const blocks = {
  of: (userId) => q.blockedBy.all(userId),
  has: (userId, otherId) => Boolean(q.isBlocked.get(userId, otherId)),
  between: (a, b) => Boolean(q.isBlocked.get(a, b) || q.isBlocked.get(b, a)),
  add(userId, otherId) {
    q.addBlock.run(userId, otherId, Date.now());
    contacts.remove(userId, otherId);
    q.removeRequest.run(userId, otherId);
    q.removeRequest.run(otherId, userId);
  },
  remove: (userId, otherId) => q.removeBlock.run(userId, otherId),
};

export const identities = {
  find: (provider, providerUserId) => q.findIdentity.get(provider, providerUserId),
  of: (userId) => q.identitiesOf.all(userId),
  add: (provider, providerUserId, userId, email) =>
    q.addIdentity.run(provider, providerUserId, userId, email, Date.now()),
  remove: (userId, provider) => q.removeIdentity.run(userId, provider),
};

// Данные о себе: публичный профиль плюс способы входа
export const toSelf = (row) => ({
  ...toPublicUser(row),
  email: row.email_shown || row.email || null,
  status: row.status || 'online',
  hasPassword: Boolean(row.password_hash),
  twoFactor: Boolean(row.totp_secret),
  identities: identities.of(row.id).map((i) => ({ provider: i.provider, email: i.email })),
});

export const messages = {
  add(fromId, toId, text, { attachments = [], preview = null, enc = null, replyTo = null } = {}) {
    const res = q.insertMessage.run(fromId, toId, text, JSON.stringify(attachments), preview && JSON.stringify(preview), enc && JSON.stringify(enc), replyTo, Date.now());
    return q.messageById.get(Number(res.lastInsertRowid));
  },
  /** Правка: новый зашифрованный конверт вместо текста */
  setEnc(id, enc) {
    db.prepare('UPDATE messages SET enc = ?, text = ?, edited_at = ? WHERE id = ?').run(enc && JSON.stringify(enc), '', Date.now(), id);
    return q.messageById.get(id);
  },
  between(a, b, beforeId = Number.MAX_SAFE_INTEGER, limit = 50) {
    return q.messagesBetween.all(a, b, b, a, beforeId, limit).reverse();
  },
  byId: (id) => q.messageById.get(id),
  remove: (id) => q.deleteMessage.run(id),
};

export const rooms = {
  byId: (id) => q.roomById.get(id),
  setBackground: (id, background) => q.setRoomBackground.run(background, id),
  of: (userId) => q.roomsOf.all(userId),
  /** Комната в канале hubId. everyone — сразу позвать всех участников канала (старые версии зовут поимённо) */
  create(ownerId, name, kind, hubId, { everyone = true, isPrivate = false } = {}) {
    const now = Date.now();
    const id = Number(q.insertRoom.run(name, kind, ownerId, hubId, isPrivate ? 1 : 0, now).lastInsertRowid);
    q.addRoomMember.run(id, ownerId, now);
    if (everyone) for (const m of q.hubMembers.all(hubId)) q.addRoomMember.run(id, m.id, now);
    // «Порядок» комнат: новая встаёт в конец списка канала
    if (hubId) q.setRoomPosition.run(q.nextRoomPosition.get(hubId).pos, id);
    return rooms.byId(id);
  },
  rename: (id, name) => q.renameRoom.run(name, id),
  setPrivate: (id, value) => db.prepare('UPDATE rooms SET private = ? WHERE id = ?').run(value ? 1 : 0, id),
  setGroup: (id, groupId) => q.setRoomGroup.run(groupId, id),
  /** Порядок комнат в канале: ids — комнаты в нужном порядке */
  reorder(ids) {
    ids.forEach((id, index) => q.setRoomPosition.run(index + 1, id));
  },
  remove: (id) => q.deleteRoom.run(id),
  members: (roomId) => q.roomMembers.all(roomId),
  member: (roomId, userId) => q.roomMember.get(roomId, userId),
  isMember: (roomId, userId) => Boolean(q.isRoomMember.get(roomId, userId)),
  addMember: (roomId, userId) => q.addRoomMember.run(roomId, userId, Date.now()),
  removeMember: (roomId, userId) => q.removeRoomMember.run(roomId, userId),

  /** Права участника по роли (без учёта того, что создатель может всё); кик на время на них не влияет */
  rolePermsOf(room, userId) {
    if (!q.roomMember.get(room.id, userId)) return 0;
    const hub = q.hubById.get(room.hub_id);
    const roleId = q.hubMember.get(room.hub_id, userId)?.role_id;
    const role = roleId && q.roleById.get(roleId);
    return role ? role.perms : hub.default_perms;
  },

  /** Положение в комнате: создатель комнаты и создатель её канала могут всё, управляющий каналом — как администратор.
   *  rank — старшинство (см. rankOf): действовать можно только на тех, кто младше */
  standing(room, userId) {
    const hub = room.hub_id && q.hubById.get(room.hub_id);
    const isOwner = room.owner_id === userId || hub?.owner_id === userId;
    const manager = Boolean(hub && q.hubMember.get(hub.id, userId)?.manager);
    const perms = isOwner ? ALL_PERMS : rooms.rolePermsOf(room, userId) | (manager ? PERMS.admin : 0);
    return { isOwner, perms, rank: rankOf(isOwner, perms) };
  },

  /** Действующие права: кикнутый на время может только читать чат */
  permsOf(room, userId) {
    const { isOwner, perms } = rooms.standing(room, userId);
    return isOwner || !rooms.timeoutOf(room.id, userId) ? perms : 0;
  },

  /** До какого момента участник кикнут, или null */
  timeoutOf(roomId, userId) {
    const until = q.roomMember.get(roomId, userId)?.timeout_until;
    return until > Date.now() ? until : null;
  },
  setTimeout: (roomId, userId, until) => q.setMemberTimeout.run(until, roomId, userId),

  bans: (roomId) => q.roomBans.all(roomId),
  isBanned: (roomId, userId) => Boolean(q.isBanned.get(roomId, userId)),
  ban: (roomId, userId, byId) => q.addBan.run(roomId, userId, byId, Date.now()),
  unban: (roomId, userId) => q.removeBan.run(roomId, userId),
};

/** Каналы. Участник канала — участник его комнат, кроме тех, где его забанили */
export const hubs = {
  byId: (id) => q.hubById.get(id),
  of: (userId) => q.hubsOf.all(userId),
  ownedCount: (userId) => q.ownedHubs.get(userId).n,
  create(ownerId, name, iconColor) {
    const now = Date.now();
    const id = Number(q.insertHub.run(name, ownerId, iconColor, now).lastInsertRowid);
    q.addHubMember.run(id, ownerId, now);
    roles.create(id, ADMIN_ROLE);
    return hubs.byId(id);
  },

  /** Куда класть комнату без канала (старые версии и перенос): в первый свой канал, а нет — в новый «Канал <имя>» */
  defaultFor(owner) {
    return q.firstOwnedHub.get(owner.id) || hubs.create(owner.id, `Канал ${owner.display_name}`.slice(0, 40), owner.avatar_color);
  },

  /** Переносит комнату в канал вместе с его участниками */
  attachRoom(hubId, roomId) {
    q.setRoomHub.run(hubId, roomId);
    q.roomMembersToHub.run(hubId, roomId);
  },

  update: (id, { name, iconColor }) => q.updateHub.run(name, iconColor, id),
  setDefaultPerms: (id, perms) => q.setHubDefaultPerms.run(perms, id),
  emojis: (id) => q.hubEmojis.all(id),
  emoji: (hubId, id) => q.hubEmoji.get(id, hubId),
  /** false — такое имя в канале уже есть */
  addEmoji: (hubId, name, file, userId) => q.insertEmoji.run(hubId, name, file, userId).changes > 0,
  removeEmoji: (id) => q.deleteEmoji.run(id),
  groups: (id) => q.hubGroups.all(id),
  group: (hubId, id) => q.hubGroup.get(id, hubId),
  createGroup: (hubId, name) => q.insertGroup.run(hubId, name),
  renameGroup: (id, name) => q.renameGroup.run(name, id),
  /** Комнаты группы остаются в канале, просто без группы */
  deleteGroup(id) {
    q.ungroupRooms.run(id);
    q.deleteGroup.run(id);
  },
  setReactionsVisible: (id, visible) => q.setHubReactionsVisible.run(visible ? 1 : 0, id),
  setRole: (hubId, userId, roleId) => q.setMemberRole.run(roleId, hubId, userId),
  /** Своё имя участника в канале: видно только в этом канале */
  setNickname: (hubId, userId, name) => q.setHubNickname.run(hubId, userId, name),
  clearNickname: (hubId, userId) => q.clearHubNickname.run(hubId, userId),
  nicknameOf: (hubId, userId) => q.hubNickname.get(hubId, userId)?.name || null,
  nicknames: (hubId) => q.hubNicknames.all(hubId),
  setIcon: (id, icon) => q.setHubIcon.run(icon, id),
  remove: (id) => q.deleteHub.run(id),
  rooms: (hubId) => q.hubRooms.all(hubId),
  members: (hubId) => q.hubMembers.all(hubId),
  isMember: (hubId, userId) => Boolean(q.hubMember.get(hubId, userId)),
  setManager: (hubId, userId, manager) => q.setManager.run(manager ? 1 : 0, hubId, userId),

  /** Старшинство в канале: создатель 3, управляющий 2, участник 1, чужой 0 */
  rankOf(hub, userId) {
    if (hub.owner_id === userId) return 3;
    const member = q.hubMember.get(hub.id, userId);
    if (!member) return 0;
    const role = member.role_id && q.roleById.get(member.role_id);
    return member.manager || role?.perms & (PERMS.manage | PERMS.admin) ? 2 : 1;
  },

  /** Вступить: канал и все его комнаты, кроме тех, где забанен. Возвращает комнаты, куда попал */
  join(hubId, userId) {
    const now = Date.now();
    const joined = [];
    transaction(() => {
      q.addHubMember.run(hubId, userId, now);
      q.removeHubInvite.run(hubId, userId);
      for (const room of q.hubRooms.all(hubId)) {
        if (q.isBanned.get(room.id, userId) || q.isRoomMember.get(room.id, userId)) continue;
        q.addRoomMember.run(room.id, userId, now);
        joined.push(room);
      }
    });
    return joined;
  },

  /** Только запись участника: из комнат его убирает вызывающий (там ещё голос и события) */
  removeMember: (hubId, userId) => q.removeHubMember.run(hubId, userId),
  addMemberOnly: (hubId, userId) => {
    q.addHubMember.run(hubId, userId, Date.now());
    q.removeHubInvite.run(hubId, userId);
  },

  invitesOf: (userId) => q.hubInvitesOf.all(userId),
  invite: (hubId, userId) => q.hubInvite.get(hubId, userId),
  invited: (hubId) => q.hubInvited.all(hubId).map((r) => r.user_id),
  addInvite: (hubId, userId, byId) => q.addHubInvite.run(hubId, userId, byId, Date.now()),
  removeInvite: (hubId, userId) => q.removeHubInvite.run(hubId, userId),

  bans: (hubId) => q.hubBans.all(hubId),
  isBanned: (hubId, userId) => Boolean(q.isHubBanned.get(hubId, userId)),
  ban(hubId, userId, byId) {
    q.addHubBan.run(hubId, userId, byId, Date.now());
    q.removeHubInvite.run(hubId, userId);
  },
  unban: (hubId, userId) => q.removeHubBan.run(hubId, userId),
};

export const events = {
  create(roomId, hubId, title, startsAt, createdBy, repeat = 'none', remind = 0) {
    const id = Number(q.insertEvent.run(roomId, hubId, title, startsAt, createdBy, Date.now(), repeat, remind).lastInsertRowid);
    return q.eventById.get(id);
  },
  byId: (id) => q.eventById.get(id),
  ofRoom: (roomId) => q.eventsOfRoom.all(roomId),
  remove: (id) => q.deleteEvent.run(id),
  responses: (eventId) => q.eventResponses.all(eventId),
  /** Готовность: yes (буду), no (не смогу), maybe (готов в другое время — ready_at) */
  respond: (eventId, userId, status, readyAt = null) => q.setEventResponse.run(eventId, userId, status, readyAt, Date.now()),
  clearResponse: (eventId, userId) => q.clearEventResponse.run(eventId, userId),
  markReminded: (id, at) => q.setEventReminded.run(at, id),
  finish: (id) => q.finishEvent.run(id),
  update: (id, title, startsAt, repeat, remind) => q.updateEvent.run(title, startsAt, repeat, remind, id),
  all: () => q.allEvents.all(),
};

export const roles = {
  of: (hubId) => q.hubRoles.all(hubId),
  byId: (id) => q.roleById.get(id),
  create(hubId, { name, color, perms }) {
    const res = q.insertRole.run(hubId, name, color, perms, Date.now());
    return roles.byId(Number(res.lastInsertRowid));
  },
  update: (id, { name, color, perms }) => q.updateRole.run(name, color, perms, id),
  remove(id) {
    q.clearRole.run(id);
    q.deleteRole.run(id);
  },
};

// Адреса из версий до 1.8 приводим к одному виду (у Яндекса много доменов). Если такой ящик уже у другого профиля, не трогаем
for (const { id, email } of db.prepare('SELECT id, email FROM users WHERE email IS NOT NULL').all()) {
  const canonical = canonicalEmail(email);
  if (canonical !== email && !q.userByEmail.get(canonical)) q.setEmail.run(canonical, email, id);
}

// Комнаты из версий до 2.0 жили сами по себе: у каждого создателя собираем их в канал вместе с участниками
transaction(() => {
  for (const { owner_id } of q.ownersOfLooseRooms.all()) {
    const hub = hubs.defaultFor(q.userById.get(owner_id));
    for (const { id } of q.looseRoomsOf.all(owner_id)) hubs.attachRoom(hub.id, id);
  }
});

// Роли версий до 2.6.3 были у каждой комнаты свои. Одноимённые роли комнат канала становятся одной ролью канала. Человеку
// достаётся роль, которая была у него в большем числе комнат, при равенстве — с меньшими правами: перенос не должен расширять
// права шире необходимого. Права по умолчанию — самые частые среди комнат канала. Старые таблицы остаются для отката
if (!rolesInHubs)
  transaction(() => {
    for (const { id: hubId } of db.prepare('SELECT id FROM hubs').all()) {
      const hubRooms = q.hubRooms.all(hubId);
      const counts = new Map();
      for (const room of hubRooms) counts.set(room.default_perms, (counts.get(room.default_perms) || 0) + 1);
      const [common] = [...counts].sort((a, b) => b[1] - a[1])[0] || [DEFAULT_PERMS];
      q.setHubDefaultPerms.run(common, hubId);

      const byName = new Map(); // название -> роль канала
      const newId = new Map(); // роль комнаты -> роль канала
      const held = new Map(); // человек -> Map(роль канала -> в скольких комнатах)
      for (const room of hubRooms) {
        for (const old of db.prepare('SELECT * FROM room_roles WHERE room_id = ? ORDER BY id').all(room.id)) {
          if (!byName.has(old.name)) byName.set(old.name, roles.create(hubId, old));
          newId.set(old.id, byName.get(old.name));
        }
        for (const m of db.prepare('SELECT user_id, role_id FROM room_members WHERE room_id = ? AND role_id IS NOT NULL').all(room.id)) {
          const role = newId.get(m.role_id);
          if (!role) continue;
          if (!held.has(m.user_id)) held.set(m.user_id, new Map());
          held.get(m.user_id).set(role, (held.get(m.user_id).get(role) || 0) + 1);
        }
      }
      for (const [userId, list] of held) {
        const [best] = [...list].sort((a, b) => b[1] - a[1] || a[0].perms - b[0].perms)[0];
        q.setMemberRole.run(best.id, hubId, userId);
      }
    }
  });

// У канала всегда есть готовая роль администратора, которую можно раздать
for (const { id } of q.hubsWithoutRoles.all()) roles.create(id, ADMIN_ROLE);

// Версия 2.0 называла каналы, созданные из старых комнат, «Сходка <имя>»; с 2.1 это «Канал <имя>»
db.prepare("UPDATE hubs SET name = 'Канал' || substr(name, 7) WHERE substr(name, 1, 7) = 'Сходка '").run();

/** id всех, кому важны обновления пользователя: друзья и соседи по комнатам */
export function relatedUserIds(userId) {
  const ids = new Set(q.listContacts.all(userId).map((u) => u.id));
  for (const row of q.roomNeighbours.all(userId, userId)) ids.add(row.id);
  return ids;
}

export const toRoomMessage = (row) => ({
  id: row.id,
  roomId: row.room_id,
  fromId: row.from_id,
  text: row.text,
  attachments: parseJson(row.attachments, []),
  preview: parseJson(row.preview, null),
  enc: parseJson(row.enc, null),
  replyTo: row.reply_to || null,
  mentionAll: Boolean(row.mention_all),
  threadRoot: row.thread_root || null,
  editedAt: row.edited_at || null,
  createdAt: row.created_at,
});

export const roomMessages = {
  add(roomId, fromId, text, { attachments = [], preview = null, enc = null, replyTo = null, threadRoot = null, mentionAll = false } = {}) {
    const res = q.insertRoomMessage.run(roomId, fromId, text, JSON.stringify(attachments), preview && JSON.stringify(preview), enc && JSON.stringify(enc), replyTo, threadRoot, mentionAll ? 1 : 0, Date.now());
    return q.roomMessageById.get(Number(res.lastInsertRowid));
  },
  /** Правка: новый зашифрованный конверт вместо текста */
  setEnc(id, enc) {
    db.prepare('UPDATE room_messages SET enc = ?, text = ?, edited_at = ? WHERE id = ?').run(enc && JSON.stringify(enc), '', Date.now(), id);
    return q.roomMessageById.get(id);
  },
  list(roomId, beforeId = Number.MAX_SAFE_INTEGER, limit = 50) {
    return q.roomMessages.all(roomId, beforeId, limit).reverse();
  },
  /** Ответы в треде, от старых к новым */
  thread(rootId, limit = 200) {
    return q.roomThread.all(rootId, limit);
  },
  /** Участники треда: автор корня и все, кто ответил */
  participants(rootId) {
    const root = q.roomMessageById.get(rootId);
    const ids = new Set(q.roomThreadAuthors.all(rootId).map((r) => r.from_id));
    if (root) ids.add(root.from_id);
    return [...ids];
  },
  /** Сколько ответов в ветках у сообщений комнаты */
  replyCounts(roomId) {
    const map = new Map();
    for (const row of q.roomReplyCounts.all(roomId)) map.set(row.thread_root, row.count);
    return map;
  },
  /** Время последнего сообщения в комнате: для значка активности */
  lastAt: (roomId) => q.roomLastMessage.get(roomId)?.ts || 0,
  byId: (id) => q.roomMessageById.get(id),
  remove: (id) => q.deleteRoomMessage.run(id),
};

export const uploads = {
  add: ({ id, ownerId, name, mime, size, kind }) => q.insertUpload.run(id, ownerId, name, mime, size, kind, Date.now()),
  byId: (id) => q.uploadById.get(id),
  /** Сколько байт файлов человека лежит на диске */
  usedBy: (ownerId) => q.uploadsSize.get(ownerId).total,

  /** Прикрепляет загрузки к сообщению: все должны быть своими и ещё не прикреплёнными. Иначе — null и ничего не меняется */
  claim(ids, ownerId) {
    const rows = ids.map((id) => q.uploadById.get(id));
    if (rows.some((row) => !row || row.owner_id !== ownerId || row.used)) return null;
    transaction(() => {
      for (const row of rows) q.useUpload.run(row.id);
    });
    return rows;
  },

  /** Загрузки, которые так и не прикрепили, старше времени cutoff */
  stale: (cutoff) => q.staleUploads.all(cutoff).map((row) => row.id),
  remove: (id) => q.deleteUpload.run(id),
};

/** Ключи переписок: версии и копии, запечатанные для каждого участника */
export const convKeys = {
  epoch: (conv) => q.convEpoch.get(conv).epoch || 0,
  mine: (conv, userId) => Object.fromEntries(q.convMine.all(conv, userId).map((r) => [r.epoch, r.sealed])),
  holders: (conv, epoch) => q.convHolders.all(conv, epoch).map((r) => r.user_id),
  has: (conv, epoch, userId) => Boolean(q.convHas.get(conv, epoch, userId)),

  /** Добавить копии; новая версия — целиком или никак (кто-то мог успеть раньше) */
  add(conv, epoch, sealed, byId) {
    const now = Date.now();
    transaction(() => {
      for (const [userId, blob] of Object.entries(sealed)) q.convInsert.run(conv, epoch, Number(userId), blob, byId, now);
    });
  },

  /** Человек сменил ключ — его старые копии никто уже не откроет */
  dropUser: (userId) => q.convDropUser.run(userId),
};

export const setPublicKey = (userId, key) => q.setPublicKey.run(key, userId);

const TRANSFER_TTL = 10 * 60_000;

/** Перенос ключа на новое устройство: забрать можно один раз, своим аккаунтом, за 10 минут */
export const keyTransfers = {
  put: (id, userId, blob) => q.transferPut.run(id, userId, blob, Date.now()),
  take(id, userId) {
    const row = q.transferGet.get(id);
    q.transferDrop.run(row?.user_id === userId ? id : '', Date.now() - TRANSFER_TTL);
    return row && row.user_id === userId && row.created_at > Date.now() - TRANSFER_TTL ? row.blob : null;
  },
};

// ---------- Реакции и закреп (2.4): только id сообщений и смайлики, без текста ----------

const rAdd = db.prepare('INSERT OR IGNORE INTO message_reactions (kind, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)');
const rRemove = db.prepare('DELETE FROM message_reactions WHERE kind = ? AND message_id = ? AND user_id = ? AND emoji = ?');
const rOfMessage = db.prepare('SELECT emoji, user_id FROM message_reactions WHERE kind = ? AND message_id = ? ORDER BY created_at');
const rClear = db.prepare('DELETE FROM message_reactions WHERE kind = ? AND message_id = ?');

export const reactions = {
  /** { messageId: [{ emoji, count, mine }] } для набора сообщений */
  ofMessages(kind, ids, me) {
    const out = {};
    for (const id of ids) {
      const groups = new Map();
      for (const row of rOfMessage.all(kind, id)) {
        const g = groups.get(row.emoji) || { emoji: row.emoji, count: 0, mine: false };
        g.count += 1;
        if (row.user_id === me) g.mine = true;
        groups.set(row.emoji, g);
      }
      if (groups.size) out[id] = [...groups.values()];
    }
    return out;
  },
  /** Ставит или снимает смайлик: true — теперь стоит */
  toggle(kind, messageId, userId, emoji) {
    const has = rOfMessage.all(kind, messageId).some((r) => r.user_id === userId && r.emoji === emoji);
    if (has) rRemove.run(kind, messageId, userId, emoji);
    else rAdd.run(kind, messageId, userId, emoji, Date.now());
    return !has;
  },
  of: (kind, messageId, me) => reactions.ofMessages(kind, [messageId], me)[messageId] || [],
  /** [{ emoji, userIds }] — кто что поставил */
  whoOf(kind, messageId) {
    const groups = new Map();
    for (const row of rOfMessage.all(kind, messageId)) {
      if (!groups.has(row.emoji)) groups.set(row.emoji, []);
      groups.get(row.emoji).push(row.user_id);
    }
    return [...groups].map(([emoji, userIds]) => ({ emoji, userIds }));
  },
  clear: (kind, messageId) => rClear.run(kind, messageId),
};

const pAdd = db.prepare('INSERT OR IGNORE INTO message_pins (kind, chat_id, message_id, by_id, created_at) VALUES (?, ?, ?, ?, ?)');
const pRemove = db.prepare('DELETE FROM message_pins WHERE kind = ? AND message_id = ?');
const pOfChat = db.prepare('SELECT * FROM message_pins WHERE kind = ? AND chat_id = ? ORDER BY created_at DESC');
const pHas = db.prepare('SELECT 1 FROM message_pins WHERE kind = ? AND message_id = ?');
const pClear = db.prepare('DELETE FROM message_pins WHERE kind = ? AND message_id = ?');

// Что человек прочитал: conv — 'dm:<собеседник>' или 'room:<комната>', last_id — последнее прочитанное сообщение
db.exec(`
  CREATE TABLE IF NOT EXISTS read_state (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conv TEXT NOT NULL,
    last_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, conv)
  );
  CREATE INDEX IF NOT EXISTS messages_to ON messages (to_id, id);
  -- Что считать прочитанным там, где человек ещё ничего не отмечал: всё, что было до появления счётчиков
  CREATE TABLE IF NOT EXISTS read_baseline (dm INTEGER NOT NULL, room INTEGER NOT NULL);
  INSERT INTO read_baseline
    SELECT (SELECT COALESCE(MAX(id), 0) FROM messages), (SELECT COALESCE(MAX(id), 0) FROM room_messages)
    WHERE NOT EXISTS (SELECT 1 FROM read_baseline);
`);

const rMark = db.prepare(`
  INSERT INTO read_state (user_id, conv, last_id) VALUES (?, ?, ?)
  ON CONFLICT (user_id, conv) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)
`);
const rDmNewest = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE from_id = ? AND to_id = ?');
const rRoomNewest = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM room_messages WHERE room_id = ?');
const rDmUnread = db.prepare(`
  SELECT m.from_id AS peerId, COUNT(*) AS count, COALESCE(r.last_id, b.dm) AS lastRead
  FROM messages m
  CROSS JOIN read_baseline b
  LEFT JOIN read_state r ON r.user_id = m.to_id AND r.conv = 'dm:' || m.from_id
  WHERE m.to_id = ? AND m.id > COALESCE(r.last_id, b.dm)
  GROUP BY m.from_id
`);
const rRoomUnread = db.prepare(`
  SELECT m.room_id AS roomId, COUNT(*) AS count, COALESCE(r.last_id, b.room) AS lastRead
  FROM room_members rm
  CROSS JOIN read_baseline b
  JOIN room_messages m ON m.room_id = rm.room_id AND m.from_id <> rm.user_id
  LEFT JOIN read_state r ON r.user_id = rm.user_id AND r.conv = 'room:' || rm.room_id
  WHERE rm.user_id = ? AND m.id > COALESCE(r.last_id, b.room)
  GROUP BY m.room_id
`);

// Сессии: каждый вход в профиль (см. sessions.js)
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
`);

const sAdd = db.prepare('INSERT INTO sessions (id, user_id, device, created_at, last_seen) VALUES (?, ?, ?, ?, ?)');
const sById = db.prepare('SELECT * FROM sessions WHERE id = ?');
const sOf = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen DESC');
const sTouch = db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?');
const sRemove = db.prepare('DELETE FROM sessions WHERE id = ?');
const sRemoveAllBut = db.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> COALESCE(?, '')");
const sDropOld = db.prepare('DELETE FROM sessions WHERE created_at < ?');

export const sessions = {
  add(id, userId, device) {
    const now = Date.now();
    sAdd.run(id, userId, device, now, now);
  },
  byId: (id) => sById.get(id),
  of: (userId) => sOf.all(userId),
  touch: (id) => sTouch.run(Date.now(), id),
  remove: (id) => sRemove.run(id),
  removeAllBut: (userId, keepId) => sRemoveAllBut.run(userId, keepId),
  dropOlderThan: (time) => sDropOld.run(time),
};

export const readState = {
  /** Прочитано всё, что уже есть в личной переписке */
  readDm: (userId, peerId) => rMark.run(userId, `dm:${peerId}`, rDmNewest.get(peerId, userId).id),
  readRoom: (userId, roomId) => rMark.run(userId, `room:${roomId}`, rRoomNewest.get(roomId).id),
  unread: (userId) => ({ dm: rDmUnread.all(userId), rooms: rRoomUnread.all(userId) }),
};

export const pins = {
  add: (kind, chatId, messageId, byId) => pAdd.run(kind, chatId, messageId, byId, Date.now()),
  remove: (kind, messageId) => pRemove.run(kind, messageId),
  has: (kind, messageId) => Boolean(pHas.get(kind, messageId)),
  of: (kind, chatId) => pOfChat.all(kind, chatId).map((row) => row.message_id),
  clear: (kind, messageId) => pClear.run(kind, messageId),
};
