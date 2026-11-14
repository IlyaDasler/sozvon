-- Резервная копия ключа шифрования, запечатанная паролем пользователя.
-- Сервер хранит только шифротекст и не может прочитать ключ без пароля.
CREATE TABLE IF NOT EXISTS key_backups (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  salt TEXT NOT NULL,
  iv TEXT NOT NULL,
  ct TEXT NOT NULL,
  iterations INTEGER NOT NULL DEFAULT 310000,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
