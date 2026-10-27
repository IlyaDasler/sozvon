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
`);

export const toPublicUser = (row) =>
  row && { id: row.id, username: row.username, displayName: row.display_name, avatarColor: row.avatar_color };

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

  listContacts: db.prepare(`
    SELECT u.* FROM contacts c JOIN users u ON u.id = c.contact_id
    WHERE c.user_id = ? ORDER BY u.display_name COLLATE NOCASE
  `),
  hasContact: db.prepare('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?'),
  addContact: db.prepare('INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)'),
  removeContact: db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?'),

  insertMessage: db.prepare('INSERT INTO messages (from_id, to_id, text, created_at) VALUES (?, ?, ?, ?)'),
  messageById: db.prepare('SELECT * FROM messages WHERE id = ?'),
  messagesBetween: db.prepare(`
    SELECT * FROM messages
    WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id < ?
    ORDER BY id DESC LIMIT ?
  `),
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

export const messages = {
  add(fromId, toId, text) {
    const res = q.insertMessage.run(fromId, toId, text, Date.now());
    return q.messageById.get(Number(res.lastInsertRowid));
  },
  between(a, b, beforeId = Number.MAX_SAFE_INTEGER, limit = 50) {
    return q.messagesBetween.all(a, b, b, a, beforeId, limit).reverse();
  },
};
