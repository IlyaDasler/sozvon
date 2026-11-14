-- Один логин не может одновременно ждать подтверждения в двух заявках.
CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_signups_username
  ON phone_signups(username);
