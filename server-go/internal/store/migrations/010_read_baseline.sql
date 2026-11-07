-- Что считать прочитанным там, где человек ещё ничего не отмечал: всё, что было до
-- появления счётчиков. Таблица уже существует на базах, переехавших с Node.
CREATE TABLE IF NOT EXISTS read_baseline (dm INTEGER NOT NULL, room INTEGER NOT NULL);
INSERT INTO read_baseline
  SELECT (SELECT COALESCE(MAX(id), 0) FROM messages), (SELECT COALESCE(MAX(id), 0) FROM room_messages)
  WHERE NOT EXISTS (SELECT 1 FROM read_baseline);
