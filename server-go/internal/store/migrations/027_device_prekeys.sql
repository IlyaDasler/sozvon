CREATE TABLE IF NOT EXISTS device_prekeys (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  signed_prekey_public TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_hash)
);
