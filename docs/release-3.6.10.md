# Созвон 3.6.10 — CORS для мобильного WebView

- Добавлен точный CORS только для https://localhost, capacitor://localhost и http://localhost.
- OPTIONS preflight обрабатывается до chi и не получает 405.
- Чужие origin не получают CORS-разрешение.
- Добавлены регрессионные тесты.