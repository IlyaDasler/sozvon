-- События канала: «собираемся играть в 21:00».
-- Готовность участников («буду», «не смогу», «готов в 21:30») живёт в event_responses.
-- Таблицы те же, что в Node-сервере (db.js), поэтому база остаётся совместимой.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  hub_id INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  repeat TEXT NOT NULL DEFAULT 'none',
  remind INTEGER NOT NULL DEFAULT 0,
  last_remind INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS event_responses (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  ready_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS events_room ON events (room_id);
CREATE INDEX IF NOT EXISTS event_responses_event ON event_responses (event_id);
