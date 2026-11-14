-- Привязка телефона к уже существующему аккаунту через Telegram.
ALTER TABLE phone_signups ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_phone_signups_user ON phone_signups(user_id) WHERE user_id IS NOT NULL;
