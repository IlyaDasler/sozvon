-- Мягкое удаление аккаунта: 30 дней на восстановление, потом каскадное удаление.
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
