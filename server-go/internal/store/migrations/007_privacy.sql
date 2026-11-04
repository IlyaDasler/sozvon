-- 3.0: приватность. Все значения по умолчанию сохраняют прежнее поведение.
ALTER TABLE users ADD COLUMN privacy_typing INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN privacy_read INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN privacy_game INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN friend_requests INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN invite_policy TEXT NOT NULL DEFAULT 'all';