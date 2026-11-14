-- Телефон как необязательный идентификатор входа.
-- В базе только HMAC номера: сам номер не хранится.
ALTER TABLE users ADD COLUMN phone_hmac TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_hmac
  ON users(phone_hmac) WHERE phone_hmac IS NOT NULL AND phone_hmac <> '';

-- Одноразовая регистрация: телефон + пароль, подтверждение через Telegram Contact Share.
CREATE TABLE IF NOT EXISTS phone_signups (
  id TEXT PRIMARY KEY,
  phone_hmac TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  poll_hash TEXT NOT NULL,
  telegram_chat_id INTEGER,
  verified_at INTEGER,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phone_signups_chat
  ON phone_signups(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_phone_signups_expires
  ON phone_signups(expires_at);
