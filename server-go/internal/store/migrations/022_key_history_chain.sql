ALTER TABLE user_key_history ADD COLUMN prev_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE user_key_history ADD COLUMN entry_hash TEXT NOT NULL DEFAULT '';
