CREATE TABLE IF NOT EXISTS prekey_bundles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  signed_prekey_public TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
