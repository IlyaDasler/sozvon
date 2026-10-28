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
if (!columnsOf('users').includes('status')) db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online'");
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email) WHERE email IS NOT NULL');
if (!columnsOf('rooms').includes('default_perms'))
  db.exec(`ALTER TABLE rooms ADD COLUMN default_perms INTEGER NOT NULL DEFAULT ${DEFAULT_PERMS}`);
if (!columnsOf('room_members').includes('role_id')) db.exec('ALTER TABLE room_members ADD COLUMN role_id INTEGER');
// Свой фон комнаты: имя картинки в папке аватарок (как иконка канала)
if (!columnsOf('rooms').includes('background')) db.exec('ALTER TABLE rooms ADD COLUMN background TEXT');
// Кик на время: до этого момента (мс) участник может только читать чат
if (!columnsOf('room_members').includes('timeout_until')) db.exec('ALTER TABLE room_members ADD COLUMN timeout_until INTEGER');
// Канал комнаты (с 2.0); комнаты старых версий переносятся ниже
if (!columnsOf('rooms').includes('hub_id')) db.exec('ALTER TABLE rooms ADD COLUMN hub_id INTEGER REFERENCES hubs(id) ON DELETE CASCADE');
db.exec('CREATE INDEX IF NOT EXISTS rooms_hub ON rooms (hub_id)');
// Сквозное шифрование (2.3): публичный ключ человека и конверт сообщения вместо текста
if (!columnsOf('users').includes('public_key')) db.exec('ALTER TABLE users ADD COLUMN public_key TEXT');
for (const table of ['messages', 'room_messages']) if (!columnsOf(table).includes('enc')) db.exec(`ALTER TABLE ${table} ADD COLUMN enc TEXT`);

/** Выполняет fn целиком или никак */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const ADMIN_ROLE = { name: 'Администратор', color: '#e5484d', perms: PERMS.admin };

export const toPublicUser = (row) =>
  row && {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar ? `/api/avatars/${row.avatar}.webp` : null,
    bio: row.bio || '',
    bannerColor: row.banner_color || null,
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
  createdAt: row.created_at,
});

const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  setEmail: db.prepare('UPDATE users SET email = ? WHERE id = ?'),
  setStatus: db.prepare('UPDATE users SET status = ? WHERE id = ?'),
  insertUser: db.prepare(
    'INSERT INTO users (username, password_hash, display_name, avatar_color, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  updateProfile: db.prepare('UPDATE users SET display_name = ?, avatar_color = ?, bio = ?, banner_color = ? WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  updateAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),

  listContacts: db.prepare(`
    SELECT u.* FROM contacts c JOIN users u ON u.id = c.contact_id
    WHERE c.user_id = ? ORDER BY u.display_name COLLATE NOCASE
  `),
  hasContact: db.prepare('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?'),
  addContact: db.prepare('INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)'),
  removeContact: db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?'),
  incomingRequests: db.prepare(`
    SELECT u.*, r.created_at AS requested_at FROM friend_requests r JOIN users u ON u.id = r.from_id
    WHERE r.to_id = ? ORDER BY r.created_at DESC
  `),
  outgoingRequests: db.prepare(`
    SELECT u.*, r.created_at AS requested_at FROM friend_requests r JOIN users u ON u.id = r.to_id
    WHERE r.from_id = ? ORDER BY r.created_at DESC
  `),
  hasRequest: db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?'),
  addRequest: db.prepare('INSERT OR IGNORE INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)'),
  removeRequest: db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?'),
  blockedBy: db.prepare(`
    SELECT u.*, b.created_at AS blocked_at FROM blocks b JOIN users u ON u.id = b.blocked_id
    WHERE b.user_id = ? ORDER BY b.created_at DESC
  `),
  isBlocked: db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?'),
  addBlock: db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)'),
  removeBlock: db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?'),

  findIdentity: db.prepare('SELECT * FROM identities WHERE provider = ? AND provider_user_id = ?'),
  identitiesOf: db.prepare('SELECT provider, email FROM identities WHERE user_id = ? ORDER BY provider'),
  addIdentity: db.prepare(
    'INSERT INTO identities (provider, provider_user_id, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  removeIdentity: db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?'),

  insertMessage: db.prepare('INSERT INTO messages (from_id, to_id, text, attachments, preview, enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  setPublicKey: db.prepare('UPDATE users SET public_key = ? WHERE id = ?'),
  convEpoch: db.prepare('SELECT MAX(epoch) AS epoch FROM conv_keys WHERE conv = ?'),
  convMine: db.prepare('SELECT epoch, sealed FROM conv_keys WHERE conv = ? AND user_id = ? ORDER BY epoch'),
  convHolders: db.prepare('SELECT user_id FROM conv_keys WHERE conv = ? AND epoch = ?'),
  convHas: db.prepare('SELECT 1 FROM conv_keys WHERE conv = ? AND epoch = ? AND user_id = ?'),
  convInsert: db.prepare('INSERT OR IGNORE INTO conv_keys (conv, epoch, user_id, sealed, by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  convDropUser: db.prepare('DELETE FROM conv_keys WHERE user_id = ?'),
  transferPut: db.prepare('INSERT OR REPLACE INTO key_transfers (id, user_id, blob, created_at) VALUES (?, ?, ?, ?)'),
  transferGet: db.prepare('SELECT * FROM key_transfers WHERE id = ?'),
  transferDrop: db.prepare('DELETE FROM key_transfers WHERE id = ? OR created_at < ?'),
  messageById: db.prepare('SELECT * FROM messages WHERE id = ?'),
  deleteMessage: db.prepare('DELETE FROM messages WHERE id = ?'),
  messagesBetween: db.prepare(`
    SELECT * FROM messages
    WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id < ?
    ORDER BY id DESC LIMIT ?
  `),

  insertRoom: db.prepare('INSERT INTO rooms (name, kind, owner_id, hub_id, created_at) VALUES (?, ?, ?, ?, ?)'),
  roomById: db.prepare('SELECT * FROM rooms WHERE id = ?'),
  roomsOf: db.prepare(`
    SELECT r.* FROM room_members m JOIN rooms r ON r.id = m.room_id
    WHERE m.user_id = ? ORDER BY r.kind DESC, r.name COLLATE NOCASE
  `),
  renameRoom: db.prepare('UPDATE rooms SET name = ? WHERE id = ?'),
  deleteRoom: db.prepare('DELETE FROM rooms WHERE id = ?'),
  setDefaultPerms: db.prepare('UPDATE rooms SET default_perms = ? WHERE id = ?'),
  roomMembers: db.prepare(`
    SELECT u.*, m.role_id, m.timeout_until FROM room_members m JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ? ORDER BY m.created_at, u.id
  `),
  roomMember: db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'),
  isRoomMember: db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'),
  setMemberRole: db.prepare('UPDATE room_members SET role_id = ? WHERE room_id = ? AND user_id = ?'),
  setMemberTimeout: db.prepare('UPDATE room_members SET timeout_until = ? WHERE room_id = ? AND user_id = ?'),
  clearRole: db.prepare('UPDATE room_members SET role_id = NULL WHERE role_id = ?'),

  roomRoles: db.prepare('SELECT * FROM room_roles WHERE room_id = ? ORDER BY id'),
  roleById: db.prepare('SELECT * FROM room_roles WHERE id = ?'),
  insertRole: db.prepare('INSERT INTO room_roles (room_id, name, color, perms, created_at) VALUES (?, ?, ?, ?, ?)'),
  updateRole: db.prepare('UPDATE room_roles SET name = ?, color = ?, perms = ? WHERE id = ?'),
  deleteRole: db.prepare('DELETE FROM room_roles WHERE id = ?'),
  roomsWithoutRoles: db.prepare('SELECT id FROM rooms WHERE id NOT IN (SELECT room_id FROM room_roles)'),

  roomBans: db.prepare(`
    SELECT u.*, b.created_at AS banned_at FROM room_bans b JOIN users u ON u.id = b.user_id
    WHERE b.room_id = ? ORDER BY b.created_at
  `),
  isBanned: db.prepare('SELECT 1 FROM room_bans WHERE room_id = ? AND user_id = ?'),
  addBan: db.prepare('INSERT OR IGNORE INTO room_bans (room_id, user_id, by_id, created_at) VALUES (?, ?, ?, ?)'),
  removeBan: db.prepare('DELETE FROM room_bans WHERE room_id = ? AND user_id = ?'),
  addRoomMember: db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, created_at) VALUES (?, ?, ?)'),
  removeRoomMember: db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?'),
  // Все, с кем человек в одной комнате или канале: им тоже нужны его статус «в сети» и новый профиль
  roomNeighbours: db.prepare(`
    SELECT b.user_id AS id FROM room_members a JOIN room_members b ON a.room_id = b.room_id
    WHERE a.user_id = ? AND b.user_id != a.user_id
    UNION
    SELECT b.user_id FROM hub_members a JOIN hub_members b ON a.hub_id = b.hub_id
    WHERE a.user_id = ? AND b.user_id != a.user_id
  `),

  hubById: db.prepare('SELECT * FROM hubs WHERE id = ?'),
  hubsOf: db.prepare(`
    SELECT h.* FROM hub_members m JOIN hubs h ON h.id = m.hub_id WHERE m.user_id = ? ORDER BY m.created_at, h.id
  `),
  insertHub: db.prepare('INSERT INTO hubs (name, owner_id, icon_color, created_at) VALUES (?, ?, ?, ?)'),
  updateHub: db.prepare('UPDATE hubs SET name = ?, icon_color = ? WHERE id = ?'),
  setHubIcon: db.prepare('UPDATE hubs SET icon = ? WHERE id = ?'),
  setRoomBackground: db.prepare('UPDATE rooms SET background = ? WHERE id = ?'),
  deleteHub: db.prepare('DELETE FROM hubs WHERE id = ?'),
  ownedHubs: db.prepare('SELECT COUNT(*) AS n FROM hubs WHERE owner_id = ?'),
  firstOwnedHub: db.prepare('SELECT * FROM hubs WHERE owner_id = ? ORDER BY id LIMIT 1'),
  hubMembers: db.prepare(`
    SELECT u.*, m.manager, m.created_at AS joined_at FROM hub_members m JOIN users u ON u.id = m.user_id
    WHERE m.hub_id = ? ORDER BY m.created_at, u.id
  `),
  hubMember: db.prepare('SELECT * FROM hub_members WHERE hub_id = ? AND user_id = ?'),
  addHubMember: db.prepare('INSERT OR IGNORE INTO hub_members (hub_id, user_id, created_at) VALUES (?, ?, ?)'),
  removeHubMember: db.prepare('DELETE FROM hub_members WHERE hub_id = ? AND user_id = ?'),
  setManager: db.prepare('UPDATE hub_members SET manager = ? WHERE hub_id = ? AND user_id = ?'),
  hubRooms: db.prepare('SELECT * FROM rooms WHERE hub_id = ? ORDER BY id'),
  // Участники комнаты становятся участниками её канала (перенос старых комнат, приглашения из старых версий)
  roomMembersToHub: db.prepare(`
    INSERT OR IGNORE INTO hub_members (hub_id, user_id, created_at) SELECT ?, user_id, created_at FROM room_members WHERE room_id = ?
  `),
  setRoomHub: db.prepare('UPDATE rooms SET hub_id = ? WHERE id = ?'),
  ownersOfLooseRooms: db.prepare('SELECT DISTINCT owner_id FROM rooms WHERE hub_id IS NULL'),
  looseRoomsOf: db.prepare('SELECT id FROM rooms WHERE hub_id IS NULL AND owner_id = ? ORDER BY id'),
  hubInvitesOf: db.prepare(`
    SELECT i.hub_id, i.created_at, i.by_id FROM hub_invites i WHERE i.user_id = ? ORDER BY i.created_at DESC
  `),
  hubInvite: db.prepare('SELECT * FROM hub_invites WHERE hub_id = ? AND user_id = ?'),
  hubInvited: db.prepare('SELECT user_id FROM hub_invites WHERE hub_id = ? ORDER BY created_at, user_id'),
  addHubInvite: db.prepare('INSERT OR REPLACE INTO hub_invites (hub_id, user_id, by_id, created_at) VALUES (?, ?, ?, ?)'),
  removeHubInvite: db.prepare('DELETE FROM hub_invites WHERE hub_id = ? AND user_id = ?'),
  hubBans: db.prepare(`
    SELECT u.*, b.created_at AS banned_at FROM hub_bans b JOIN users u ON u.id = b.user_id
    WHERE b.hub_id = ? ORDER BY b.created_at
  `),
  isHubBanned: db.prepare('SELECT 1 FROM hub_bans WHERE hub_id = ? AND user_id = ?'),
  addHubBan: db.prepare('INSERT OR IGNORE INTO hub_bans (hub_id, user_id, by_id, created_at) VALUES (?, ?, ?, ?)'),
  removeHubBan: db.prepare('DELETE FROM hub_bans WHERE hub_id = ? AND user_id = ?'),

  insertRoomMessage: db.prepare(
    'INSERT INTO room_messages (room_id, from_id, text, attachments, preview, enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),

  insertUpload: db.prepare('INSERT INTO uploads (id, owner_id, name, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  uploadById: db.prepare('SELECT * FROM uploads WHERE id = ?'),
  useUpload: db.prepare('UPDATE uploads SET used = 1 WHERE id = ?'),
  staleUploads: db.prepare('SELECT id FROM uploads WHERE used = 0 AND created_at < ?'),
  deleteUpload: db.prepare('DELETE FROM uploads WHERE id = ?'),
  roomMessageById: db.prepare('SELECT * FROM room_messages WHERE id = ?'),
  deleteRoomMessage: db.prepare('DELETE FROM room_messages WHERE id = ?'),
  roomMessages: db.prepare('SELECT * FROM room_messages WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
};

export const users = {
  byId: (id) => q.userById.get(id),
  byUsername: (username) => q.userByName.get(username),
  byEmail: (email) => q.userByEmail.get(email),
  setEmail: (id, email) => q.setEmail.run(email, id),
  setStatus: (id, status) => q.setStatus.run(status, id),
  create({ username, passwordHash, displayName, avatarColor, email }) {
    const res = q.insertUser.run(username, passwordHash, displayName, avatarColor, Date.now());
    if (email) q.setEmail.run(email, Number(res.lastInsertRowid));
    return users.byId(Number(res.lastInsertRowid));
  },
  updateProfile: (id, { displayName, avatarColor, bio, bannerColor }) => q.updateProfile.run(displayName, avatarColor, bio, bannerColor, id),
  updatePassword: (id, passwordHash) => q.updatePassword.run(passwordHash, id),
  updateAvatar: (id, avatar) => q.updateAvatar.run(avatar, id),
};

// Дружба взаимная: при добавлении записываем обе стороны
export const contacts = {
  list: (userId) => q.listContacts.all(userId),
  has: (userId, contactId) => Boolean(q.hasContact.get(userId, contactId)),
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
  email: row.email || null,
  status: row.status || 'online',
  hasPassword: Boolean(row.password_hash),
  identities: identities.of(row.id).map((i) => ({ provider: i.provider, email: i.email })),
});

export const messages = {
  add(fromId, toId, text, { attachments = [], preview = null, enc = null } = {}) {
    const res = q.insertMessage.run(fromId, toId, text, JSON.stringify(attachments), preview && JSON.stringify(preview), enc && JSON.stringify(enc), Date.now());
    return q.messageById.get(Number(res.lastInsertRowid));
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
  create(ownerId, name, kind, hubId, { everyone = true } = {}) {
    const now = Date.now();
    const id = Number(q.insertRoom.run(name, kind, ownerId, hubId, now).lastInsertRowid);
    q.addRoomMember.run(id, ownerId, now);
    if (everyone) for (const m of q.hubMembers.all(hubId)) q.addRoomMember.run(id, m.id, now);
    roles.create(id, ADMIN_ROLE);
    return rooms.byId(id);
  },
  rename: (id, name) => q.renameRoom.run(name, id),
  setDefaultPerms: (id, perms) => q.setDefaultPerms.run(perms, id),
  remove: (id) => q.deleteRoom.run(id),
  members: (roomId) => q.roomMembers.all(roomId),
  member: (roomId, userId) => q.roomMember.get(roomId, userId),
  isMember: (roomId, userId) => Boolean(q.isRoomMember.get(roomId, userId)),
  addMember: (roomId, userId) => q.addRoomMember.run(roomId, userId, Date.now()),
  removeMember: (roomId, userId) => q.removeRoomMember.run(roomId, userId),
  setRole: (roomId, userId, roleId) => q.setMemberRole.run(roleId, roomId, userId),

  /** Права участника по роли (без учёта того, что создатель может всё); кик на время на них не влияет */
  rolePermsOf(room, userId) {
    const member = q.roomMember.get(room.id, userId);
    if (!member) return 0;
    const role = member.role_id && q.roleById.get(member.role_id);
    return role ? role.perms : room.default_perms;
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
    return member ? (member.manager ? 2 : 1) : 0;
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

export const roles = {
  of: (roomId) => q.roomRoles.all(roomId),
  byId: (id) => q.roleById.get(id),
  create(roomId, { name, color, perms }) {
    const res = q.insertRole.run(roomId, name, color, perms, Date.now());
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
  if (canonical !== email && !q.userByEmail.get(canonical)) q.setEmail.run(canonical, id);
}

// Комнаты из версий до 2.0 жили сами по себе: у каждого создателя собираем их в канал вместе с участниками
transaction(() => {
  for (const { owner_id } of q.ownersOfLooseRooms.all()) {
    const hub = hubs.defaultFor(q.userById.get(owner_id));
    for (const { id } of q.looseRoomsOf.all(owner_id)) hubs.attachRoom(hub.id, id);
  }
});

// В комнатах из версий без ролей создатель получает готовую роль администратора, которую можно раздать
for (const { id } of q.roomsWithoutRoles.all()) roles.create(id, ADMIN_ROLE);

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
  createdAt: row.created_at,
});

export const roomMessages = {
  add(roomId, fromId, text, { attachments = [], preview = null, enc = null } = {}) {
    const res = q.insertRoomMessage.run(roomId, fromId, text, JSON.stringify(attachments), preview && JSON.stringify(preview), enc && JSON.stringify(enc), Date.now());
    return q.roomMessageById.get(Number(res.lastInsertRowid));
  },
  list(roomId, beforeId = Number.MAX_SAFE_INTEGER, limit = 50) {
    return q.roomMessages.all(roomId, beforeId, limit).reverse();
  },
  byId: (id) => q.roomMessageById.get(id),
  remove: (id) => q.deleteRoomMessage.run(id),
};

export const uploads = {
  add: ({ id, ownerId, name, mime, size, kind }) => q.insertUpload.run(id, ownerId, name, mime, size, kind, Date.now()),
  byId: (id) => q.uploadById.get(id),

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
