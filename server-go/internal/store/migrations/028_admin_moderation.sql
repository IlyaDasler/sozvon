-- Глобальная модерация: роли, аудит, чёрный список, жалобы и приватность каналов.
-- Сообщения и ключи сюда не попадают: сервер работает только с метаданными и шифртекстом.

ALTER TABLE users ADD COLUMN last_login_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN banned_at INTEGER;
ALTER TABLE users ADD COLUMN banned_by INTEGER;
ALTER TABLE users ADD COLUMN ban_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN suspended_at INTEGER;
ALTER TABLE users ADD COLUMN suspended_by INTEGER;
ALTER TABLE users ADD COLUMN suspended_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN restored_at INTEGER;
ALTER TABLE sessions ADD COLUMN ip_hash TEXT NOT NULL DEFAULT '';

ALTER TABLE hubs ADD COLUMN privacy TEXT NOT NULL DEFAULT 'public';
ALTER TABLE rooms ADD COLUMN privacy TEXT NOT NULL DEFAULT 'public';

-- private уже existed for rooms; сохраняем его как источник для старых записей
UPDATE rooms SET privacy = CASE WHEN private = 1 THEN 'hidden' ELSE 'public' END;

CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);
UPDATE users SET last_login_at = COALESCE((SELECT MAX(created_at) FROM sessions s WHERE s.user_id = users.id), 0) WHERE last_login_at = 0;
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(banned_at);
CREATE INDEX IF NOT EXISTS idx_hubs_privacy ON hubs(privacy);
CREATE INDEX IF NOT EXISTS idx_rooms_privacy ON rooms(privacy);

-- История выдач ролей. Активная роль — та, у которой revoked_at IS NULL и срок не истёк.
CREATE TABLE IF NOT EXISTS admin_role_grants (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('super_admin', 'moderator')),
	permissions INTEGER NOT NULL DEFAULT 0,
	granted_by INTEGER NOT NULL,
	granted_at INTEGER NOT NULL,
	expires_at INTEGER,
	revoked_at INTEGER,
	revoked_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_admin_role_active ON admin_role_grants(user_id, revoked_at, expires_at);

-- Отдельные сессии админки: не пересекаются с обычными сессиями приложения.
CREATE TABLE IF NOT EXISTS admin_sessions (
	token_hash TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	last_seen INTEGER NOT NULL,
	ip_hash TEXT NOT NULL DEFAULT '',
	csrf_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);

-- Append-only аудит с hash-chain. Записи не редактируются и не удаляются API.
CREATE TABLE IF NOT EXISTS admin_audit (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	actor_id INTEGER NOT NULL,
	action TEXT NOT NULL,
	target_type TEXT NOT NULL DEFAULT '',
	target_id INTEGER NOT NULL DEFAULT 0,
	reason TEXT NOT NULL DEFAULT '',
	details TEXT NOT NULL DEFAULT '',
	ip_hash TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	prev_hash TEXT NOT NULL DEFAULT '',
	hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_id);

-- Значения только в виде HMAC. Сырые логины, телефоны, email и IP сюда не пишем.
CREATE TABLE IF NOT EXISTS admin_blacklist (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	kind TEXT NOT NULL CHECK (kind IN ('username', 'email', 'phone', 'oauth', 'device', 'ip')),
	value_hmac TEXT NOT NULL,
	user_id INTEGER,
	reason TEXT NOT NULL DEFAULT '',
	created_by INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	restored_at INTEGER,
	restored_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_blacklist_active
	ON admin_blacklist(kind, value_hmac) WHERE restored_at IS NULL;

-- Необратимые действия модератора ждут подтверждения super admin.
CREATE TABLE IF NOT EXISTS admin_approvals (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	action TEXT NOT NULL CHECK (action IN ('ban_user', 'delete_channel')),
	target_type TEXT NOT NULL,
	target_id INTEGER NOT NULL,
	payload TEXT NOT NULL DEFAULT '',
	reason TEXT NOT NULL,
	requested_by INTEGER NOT NULL,
	requested_at INTEGER NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
	approved_by INTEGER,
	approved_at INTEGER,
	resolution TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_admin_approvals_pending ON admin_approvals(status, requested_at);

CREATE TABLE IF NOT EXISTS moderation_reports (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	reporter_id INTEGER,
	target_type TEXT NOT NULL CHECK (target_type IN ('user', 'channel')),
	target_id INTEGER NOT NULL,
	category TEXT NOT NULL,
	reason TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
	created_at INTEGER NOT NULL,
	resolved_by INTEGER,
	resolved_at INTEGER,
	resolution TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_status ON moderation_reports(status, created_at);

-- Апелляции доступны без входа в забаненный аккаунт.
CREATE TABLE IF NOT EXISTS moderation_appeals (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username TEXT NOT NULL DEFAULT '',
	contact TEXT NOT NULL DEFAULT '',
	reason TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
	created_at INTEGER NOT NULL,
	resolved_by INTEGER,
	resolved_at INTEGER,
	resolution TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_moderation_appeals_status ON moderation_appeals(status, created_at);
