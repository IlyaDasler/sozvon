CREATE TABLE IF NOT EXISTS moderation_notifications (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	report_id INTEGER NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('report_new', 'report_decision')),
	title TEXT NOT NULL,
	body TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	read_at INTEGER NOT NULL DEFAULT 0,
	UNIQUE(user_id, report_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_moderation_notifications_user ON moderation_notifications(user_id, id DESC);
