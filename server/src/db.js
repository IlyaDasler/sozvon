import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from './config.js';

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

  -- Аккаунты Google / Яндекс / VK, через которые можно войти в профиль
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
`);

// Миграции для баз, созданных старыми версиями
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');

export const toPublicUser = (row) =>
  row && {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar ? `/api/avatars/${row.avatar}.webp` : null,
  };

export const toMessage = (row) => ({
  id: row.id,
  fromId: row.from_id,
  toId: row.to_id,
  text: row.text,
  createdAt: row.created_at,
});

const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
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

  insertMessage: db.prepare('INSERT INTO messages (from_id, to_id, text, created_at) VALUES (?, ?, ?, ?)'),
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
  roomMembers: db.prepare(`
    SELECT u.* FROM room_members m JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ? ORDER BY m.created_at, u.id
  `),
  isRoomMember: db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'),
  addRoomMember: db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, created_at) VALUES (?, ?, ?)'),
  removeRoomMember: db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?'),
  // Все, с кем человек в одной комнате: им тоже нужны его статус «в сети» и новый профиль
  roomNeighbours: db.prepare(`
    SELECT DISTINCT b.user_id AS id FROM room_members a JOIN room_members b ON a.room_id = b.room_id
    WHERE a.user_id = ? AND b.user_id != a.user_id
  `),

  insertRoomMessage: db.prepare('INSERT INTO room_messages (room_id, from_id, text, created_at) VALUES (?, ?, ?, ?)'),
  roomMessageById: db.prepare('SELECT * FROM room_messages WHERE id = ?'),
  roomMessages: db.prepare('SELECT * FROM room_messages WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
};

export const users = {
  byId: (id) => q.userById.get(id),
  byUsername: (username) => q.userByName.get(username),
  create({ username, passwordHash, displayName, avatarColor }) {
    const res = q.insertUser.run(username, passwordHash, displayName, avatarColor, Date.now());
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
  hasPassword: Boolean(row.password_hash),
  identities: identities.of(row.id).map((i) => ({ provider: i.provider, email: i.email })),
});

export const messages = {
  add(fromId, toId, text) {
    const res = q.insertMessage.run(fromId, toId, text, Date.now());
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
    return rooms.byId(id);
  },
  rename: (id, name) => q.renameRoom.run(name, id),
  remove: (id) => q.deleteRoom.run(id),
  members: (roomId) => q.roomMembers.all(roomId),
  isMember: (roomId, userId) => Boolean(q.isRoomMember.get(roomId, userId)),
  addMember: (roomId, userId) => q.addRoomMember.run(roomId, userId, Date.now()),
  removeMember: (roomId, userId) => q.removeRoomMember.run(roomId, userId),
};

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
  createdAt: row.created_at,
});

export const roomMessages = {
  add(roomId, fromId, text) {
    const res = q.insertRoomMessage.run(roomId, fromId, text, Date.now());
    return q.roomMessageById.get(Number(res.lastInsertRowid));
  },
  list(roomId, beforeId = Number.MAX_SAFE_INTEGER, limit = 50) {
    return q.roomMessages.all(roomId, beforeId, limit).reverse();
  },
};
