# Чек-лист перед большим релизом

Внутренние материалы, которые не должны попасть в релизную сборку.

## 1. Убрать «План 3.0»

1. В `client/renderer/app.js` поставить `const PLAN_ENABLED = false;` — пункт меню,
   панель и Meter исчезнут из настроек.
2. Удалить разметку: `<button data-tab="plan">` и `<div class="set-pane" data-pane="plan">`
   в `client/renderer/index.html`.
3. Удалить `client/renderer/refactor-status.js` и его `<script>` в `index.html`.
4. Удалить из `glass-controls.js` функции `paintPlanMeter`, `startMeter` и их вызовы,
   из `glass-components.css` — `.meter-row`, `.meter`, `.meter-fill` (или оставить Meter,
   если он нужен в другом месте).
5. Убрать `window.paintPlanMeterNow` из `app.js` и из `openSettings`.
6. Удалить раздел «6. Осталось в 3.0» из `DESIGN-SYSTEM.md`; сам журнал `STATUS.md`
   остаётся в репозитории как история.
7. Прогнать `e2e-spacing` (он открывает «План» — поправить сценарий, если раздел убран)
   и `e2e-look`, `e2e-layout`.

## 1a. Обновить веб-версию

Caddy раздаёт `/` из `/opt/sozvon-web`, а релизные бинарники этот каталог не обновляют.
На сервере включён `sozvon-web-sync.timer`: он раз в 5 минут сверяет
`/opt/sozvon-web/.release` с последним GitHub-релизом и сам раскладывает
`client/renderer` из его тега. Версия ссылки не меняется.

После релиза проверить `https://<домен>/` — там должен быть текущий интерфейс.
Если нужно обновить сразу, не ждать таймер:

```bash
sudo /usr/local/bin/sozvon-web-sync
```

Скрипт сохраняет `web/updates/` с архивами обновлений. Caddy отдаёт HTML/JS
с `Cache-Control: no-cache`, чтобы Safari не показывал старый интерфейс.

## 2. Проверить, что не утекло

- [ ] В приложении нет вкладки «План 3.0» и упоминаний «рефакторинг» в интерфейсе.
- [ ] В релизной сборке нет `_tools`, `_backup`, `_e2e`, `_audit` (electron-builder их и не берёт,
      но проверить `dist/win-unpacked/resources`).
- [ ] В `docs/adr` и `design/` нет секретов и адресов прод-сервера с паролями.
- [ ] Тестовые аккаунты на проде удалены (см. журнал, раздел про чистку).
- [ ] Версия в `package.json` и `client/package.json` поднята, тег релиза — только после согласия.

## 3. Что остаётся внутренним

- `STATUS.md` (журнал работ), `DESIGN-SYSTEM.md`, `design/ui-kit.html`, ADR — не входят в сборку,
  но лежат в репозитории. Если репозиторий публичный, проверить, что там нет приватных деталей.
