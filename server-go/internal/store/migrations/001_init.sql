-- Первая миграция Go-сервера: служебная таблица.
-- Схема приложения переносится следующими миграциями; до этого файл базы
-- остаётся совместимым с Node-сервером (он не знает про эту таблицу).
CREATE TABLE IF NOT EXISTS app_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

INSERT INTO app_meta (key, value) VALUES ('engine', 'go')
	ON CONFLICT (key) DO NOTHING;
