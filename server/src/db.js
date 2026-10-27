import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from './config.js';
import { canonicalEmail } from './email-address.js';
import { DEFAULT_PERMS, PERMS } from './perms.js';

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

  CREATE TABLE IF NOT EXISTS room_bans (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    by_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
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
if (!columnsOf('users').includes('status')) db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online'");
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email) WHERE email IS NOT NULL');
if (!columnsOf('rooms').includes('default_perms'))
  db.exec(`ALTER TABLE rooms ADD COLUMN default_perms INTEGER NOT NULL DEFAULT ${DEFAULT_PERMS}`);
if (!columnsOf('room_members').includes('role_id')) db.exec('ALTER TABLE room_members ADD COLUMN role_id INTEGER');

const ADMIN_ROLE = { name: 'Администратор', color: '#e5484d', perms: PERMS.admin };

export const toPublicUser = (row) =>
  row && {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar ? `/api/avatars/${row.avatar}.webp` : null,
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
  updateProfile: db.prepare('UPDATE users SET display_name = ?, avatar_color = ? WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  updateAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),

  listContacts: db.prepare(`
    SELECT u.* FROM contacts c JOIN users u ON u.id = c.contact_id
    WHERE c.user_id = ? ORDER BY u.display_name COLLATE NOCASE
  `),
  hasContact: db.prepare('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?'),
  addContact: db.prepare('INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)'),
  removeContact: db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?'),

  findIdentity: db.prepare('SELECT * FROM identities WHERE provider = ? AND provider_user_id = ?'),
  identitiesOf: db.prepare('SELECT provider, email FROM identities WHERE user_id = ? ORDER BY provider'),
  addIdentity: db.prepare(
    'INSERT INTO identities (provider, provider_user_id, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  removeIdentity: db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?'),

  insertMessage: db.prepare('INSERT INTO messages (from_id, to_id, text, attachments, preview, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  messageById: db.prepare('SELECT * FROM messages WHERE id = ?'),
  messagesBetween: db.prepare(`
    SELECT * FROM messages
    WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id < ?
    ORDER BY id DESC LIMIT ?
  `),

  insertRoom: db.prepare('INSERT INTO rooms (name, kind, owner_id, created_at) VALUES (?, ?, ?, ?)'),
  roomById: db.prepare('SELECT * FROM rooms WHERE id = ?'),
  roomsOf: db.prepare(`
    SELECT r.* FROM room_members m JOIN rooms r ON r.id = m.room_id
    WHERE m.user_id = ? ORDER BY r.kind DESC, r.name COLLATE NOCASE
  `),
  ownedRooms: db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE owner_id = ?'),
  renameRoom: db.prepare('UPDATE rooms SET name = ? WHERE id = ?'),
  deleteRoom: db.prepare('DELETE FROM rooms WHERE id = ?'),
  setDefaultPerms: db.prepare('UPDATE rooms SET default_perms = ? WHERE id = ?'),
  roomMembers: db.prepare(`
    SELECT u.*, m.role_id FROM room_members m JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ? ORDER BY m.created_at, u.id
  `),
  roomMember: db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'),
  isRoomMember: db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'),
  setMemberRole: db.prepare('UPDATE room_members SET role_id = ? WHERE room_id = ? AND user_id = ?'),
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
  // Все, с кем человек в одной комнате: им тоже нужны его статус «в сети» и новый профиль
  roomNeighbours: db.prepare(`
    SELECT DISTINCT b.user_id AS id FROM room_members a JOIN room_members b ON a.room_id = b.room_id
    WHERE a.user_id = ? AND b.user_id != a.user_id
  `),

  insertRoomMessage: db.prepare(
    'INSERT INTO room_messages (room_id, from_id, text, attachments, preview, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),

  insertUpload: db.prepare('INSERT INTO uploads (id, owner_id, name, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  uploadById: db.prepare('SELECT * FROM uploads WHERE id = ?'),
  useUpload: db.prepare('UPDATE uploads SET used = 1 WHERE id = ?'),
  staleUploads: db.prepare('SELECT id FROM uploads WHERE used = 0 AND created_at < ?'),
  deleteUpload: db.prepare('DELETE FROM uploads WHERE id = ?'),
  roomMessageById: db.prepare('SELECT * FROM room_messages WHERE id = ?'),
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
  updateProfile: (id, displayName, avatarColor) => q.updateProfile.run(displayName, avatarColor, id),
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
  },
  remove(a, b) {
    q.removeContact.run(a, b);
    q.removeContact.run(b, a);
  },
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
  add(fromId, toId, text, { attachments = [], preview = null } = {}) {
    const res = q.insertMessage.run(fromId, toId, text, JSON.stringify(attachments), preview && JSON.stringify(preview), Date.now());
    return q.messageById.get(Number(res.lastInsertRowid));
  },
  between(a, b, beforeId = Number.MAX_SAFE_INTEGER, limit = 50) {
    return q.messagesBetween.all(a, b, b, a, beforeId, limit).reverse();
  },
};

export const rooms = {
  byId: (id) => q.roomById.get(id),
  of: (userId) => q.roomsOf.all(userId),
  ownedCount: (userId) => q.ownedRooms.get(userId).n,
  create(ownerId, name, kind) {
    const now = Date.now();
    const id = Number(q.insertRoom.run(name, kind, ownerId, now).lastInsertRowid);
    q.addRoomMember.run(id, ownerId, now);
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

  /** Права участника (без учёта того, что создатель может всё) */
  permsOf(room, userId) {
    const member = q.roomMember.get(room.id, userId);
    if (!member) return 0;
    const role = member.role_id && q.roleById.get(member.role_id);
    return role ? role.perms : room.default_perms;
  },

  bans: (roomId) => q.roomBans.all(roomId),
  isBanned: (roomId, userId) => Boolean(q.isBanned.get(roomId, userId)),
  ban: (roomId, userId, byId) => q.addBan.run(roomId, userId, byId, Date.now()),
  unban: (roomId, userId) => q.removeBan.run(roomId, userId),
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

// В комнатах из версий без ролей создатель получает готовую роль администратора, которую можно раздать
for (const { id } of q.roomsWithoutRoles.all()) roles.create(id, ADMIN_ROLE);

/** id всех, кому важны обновления пользователя: друзья и соседи по комнатам */
export function relatedUserIds(userId) {
  const ids = new Set(q.listContacts.all(userId).map((u) => u.id));
  for (const row of q.roomNeighbours.all(userId)) ids.add(row.id);
  return ids;
}

export const toRoomMessage = (row) => ({
  id: row.id,
  roomId: row.room_id,
  fromId: row.from_id,
  text: row.text,
  attachments: parseJson(row.attachments, []),
  preview: parseJson(row.preview, null),
  createdAt: row.created_at,
});

export const roomMessages = {
  add(roomId, fromId, text, { attachments = [], preview = null } = {}) {
    const res = q.insertRoomMessage.run(roomId, fromId, text, JSON.stringify(attachments), preview && JSON.stringify(preview), Date.now());
    return q.roomMessageById.get(Number(res.lastInsertRowid));
  },
  list(roomId, beforeId = Number.MAX_SAFE_INTEGER, limit = 50) {
    return q.roomMessages.all(roomId, beforeId, limit).reverse();
  },
};

export const uploads = {
  add: ({ id, ownerId, name, mime, size, kind }) => q.insertUpload.run(id, ownerId, name, mime, size, kind, Date.now()),
  byId: (id) => q.uploadById.get(id),

  /** Прикрепляет загрузки к сообщению: все должны быть своими и ещё не прикреплёнными. Иначе — null и ничего не меняется */
  claim(ids, ownerId) {
    const rows = ids.map((id) => q.uploadById.get(id));
    if (rows.some((row) => !row || row.owner_id !== ownerId || row.used)) return null;
    db.exec('BEGIN');
    try {
      for (const row of rows) q.useUpload.run(row.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return rows;
  },

  /** Загрузки, которые так и не прикрепили, старше времени cutoff */
  stale: (cutoff) => q.staleUploads.all(cutoff).map((row) => row.id),
  remove: (id) => q.deleteUpload.run(id),
};
