-- Фаза 2: аккаунты. Схема 1:1 как в Node-сервере, чтобы база оставалась общей.
CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	display_name TEXT NOT NULL,
	avatar_color TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	avatar TEXT,
	email TEXT,
	legacy_revoked INTEGER NOT NULL DEFAULT 0,
	totp_secret TEXT,
	totp_pending TEXT,
	totp_last_step INTEGER NOT NULL DEFAULT 0,
	totp_recovery TEXT,
	email_shown TEXT,
	bio TEXT NOT NULL DEFAULT '',
	banner_color TEXT,
	name_color TEXT,
	status TEXT NOT NULL DEFAULT 'online',
	public_key TEXT,
	banner TEXT,
	game TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS identities (
	provider TEXT NOT NULL,
	provider_user_id TEXT NOT NULL,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	email TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	PRIMARY KEY (provider, provider_user_id),
	UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	device TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	last_seen INTEGER NOT NULL
);
