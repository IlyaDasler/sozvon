-- Ключи сквозного шифрования: версия переписки и запечатанные для каждого участника ключи
CREATE TABLE IF NOT EXISTS conv_keys (
  conv      TEXT    NOT NULL,
  epoch     INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  sealed    TEXT    NOT NULL,
  by_id     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (conv, epoch, user_id)
);
