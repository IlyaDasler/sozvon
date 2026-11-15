# Созвон 3.6.10 — CORS для мобильного WebView

- Добавлен точный CORS только для https://localhost, capacitor://localhost и http://localhost.
- OPTIONS preflight обрабатывается до chi и не получает 405.
- Чужие origin не получают CORS-разрешение.
- Добавлены регрессионные тесты.
## Пароль E2EE

- Убран `text-transform: uppercase` с поля пароля: регистр больше не меняется визуально.
- Все password-поля получили `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`.
- Добавлена подсказка «Пароль чувствителен к регистру» и раздельные ошибки «неверный пароль» / «копия не открылась».
