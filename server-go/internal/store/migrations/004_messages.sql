-- Фаза 4: сообщения, треды, реакции, пины, отметки прочтения.
CREATE TABLE IF NOT EXISTS room_messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
	from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS room_messages_room ON room_messages (room_id, id);
CREATE INDEX IF NOT EXISTS room_messages_thread ON room_messages (thread_root, id);

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

CREATE TABLE IF NOT EXISTS message_reactions (
	kind TEXT NOT NULL,
	message_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	emoji TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (kind, message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS message_pins (
	kind TEXT NOT NULL,
	chat_id INTEGER NOT NULL,
	message_id INTEGER NOT NULL,
	by_id INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (kind, message_id)
);

CREATE TABLE IF NOT EXISTS read_state (
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	conv TEXT NOT NULL,
	last_id INTEGER NOT NULL,
	PRIMARY KEY (user_id, conv)
);

CREATE TABLE IF NOT EXISTS read_baseline (
	dm INTEGER NOT NULL,
	room INTEGER NOT NULL
);
