-- Личные сообщения (как в Node): полный набор полей
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attachments TEXT,
  preview TEXT,
  enc TEXT,
  reply_to INTEGER,
  edited_at INTEGER,
  thread_root INTEGER,
  mention_all INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages (from_id, to_id, id);
