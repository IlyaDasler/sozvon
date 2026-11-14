-- Назначение заявки Telegram: регистрация, привязка или сброс пароля.
ALTER TABLE phone_signups ADD COLUMN purpose TEXT NOT NULL DEFAULT 'signup';
