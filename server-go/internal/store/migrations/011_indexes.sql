-- Индексы под реальные запросы: сессии, заявки, членство, пины,
-- непрочитанные ЛС и приглашения. Все IF NOT EXISTS — миграция безопасна
-- и для свежей базы, и для базы, пришедшей от Node-сервера.
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests (to_id);
CREATE INDEX IF NOT EXISTS room_members_user ON room_members (user_id);
CREATE INDEX IF NOT EXISTS room_members_room_user ON room_members (room_id, user_id);
CREATE INDEX IF NOT EXISTS hub_members_user ON hub_members (user_id);
CREATE INDEX IF NOT EXISTS hub_invites_user ON hub_invites (user_id);
CREATE INDEX IF NOT EXISTS message_pins_chat ON message_pins (kind, chat_id);
CREATE INDEX IF NOT EXISTS messages_to ON messages (to_id, from_id, id);
CREATE INDEX IF NOT EXISTS uploads_owner ON uploads (owner_id);
CREATE INDEX IF NOT EXISTS events_hub ON events (hub_id);
