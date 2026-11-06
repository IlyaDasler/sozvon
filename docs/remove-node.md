# Когда можно удалить Node-сервер

Node-сервер (`server/`) сейчас — совместимая замена на случай откатa и эталон API.
Удалять его можно, но не раньше, чем Go отработает на проде и будут закрыты пункты ниже.
**Данные при удалении кода не пострадают:** база (`DATA_DIR/sozvon.db`), вложения
(`files/`), аватары/баннеры/обои (`avatars/`, `banners/`, `wallpapers/`) и `secret.key`
лежат вне репозитория и от удаления `server/` не зависят.

## Что уже готово

- [x] API и WS-события Go: паритет проверяется `server-go/contract_test.go` по фикстурам
      `server-go/contract/*.json` — они уже лежат рядом с Go, а не в `server/`;
- [x] события канала, звонки с возвратом после обрыва, лимиты частоты, бэкапы (`cmd/backup`);
- [x] Go раздаёт веб-версию клиента из `WEB_DIR` — так же, как Node (`express.static`);
- [x] `deploy/vps/check.sh` и инструкция [vps-handover.md](vps-handover.md);
- [x] `go-tests`/`go-release` в CI, бинарники под amd64/arm64.

## Что должно быть выполнено до удаления

1. **Go отработал на проде** хотя бы 2–4 недели: `/api/health`, звонки, LiveKit, TURN,
   события, вложения — без откатов. Бэкапы идут, `secret.key` на месте.
2. **Решён встроенный TURN.** Сейчас `TURN_EMBEDDED=1` умеет только Node (`node-turn`),
   в Go — внешний coturn с `TURN_SECRET` (основной путь `deploy/vps`). Если встроенный TURN
   где-то реально используется — либо портировать его в Go, либо задокументировать отказ
   от него и убрать переменную из деплоя/настроек.
3. **`setup.sh` переведён на Go по умолчанию**: `SERVER_IMPL=${SERVER_IMPL:-go}`,
   убраны `npm ci`, установка `nodejs`/`npm` (если не нужны для других задач),
   ветка Node в unit-файле; в `docs/self-hosting.md` и [vps-handover.md](vps-handover.md)
   убраны упоминания установки на Node.
4. **CI**: удалён job `server-tests` и зависимость `needs: server-tests` у сборок клиента;
   `go-tests`/`go-release` остаются.
5. **Фикстуры контракта**: `server-go/contract/` — источник истины; перед удалением снять
   копию `server/contract/` (она уже скопирована, нужно только убедиться, что `server/contract`
   больше никуда не ссылается).
6. **Скрипты деплоя**: `deploy/vps/setup.sh` (node-ветка), `deploy/vps/check.sh`
   (проверка «Go или Node» → только Go), `deploy/vps/backup-offsite.sh` — не зависят от Node.
7. **Документация**: [go-cutover.md](go-cutover.md) остаётся как историческая инструкция
   переключения; [self-hosting.md](self-hosting.md) упрощается до Go-варианта;
   README и [server-go/README.md](../server-go/README.md) обновлены.
8. **Последний релиз с Go-сервером** собран и проверен клиентом (вход, чат, звонок,
   экран, событие, вложение).
9. **Свежий бэкап прода** и проверенный откат (по git-истории можно вернуть `server/`).

## Порядок удаления (после пунктов выше)

```bash
# 1. Убедиться, что Go-сервер активен и это записано в деплое
systemctl cat sozvon | grep -E 'ExecStart|sozvon-go'
sudo bash deploy/vps/check.sh

# 2. Удалить код Node-сервера и его тесты (история остаётся в git)
git rm -r server/
# 3. Убрать server-tests из CI, node-ветку из setup.sh, обновить docs
# 4. Прогнать go test ./... и собрать релиз
# 5. Закоммитить отдельно: «Удалён Node-сервер, Go стал единственным»
```

## Что не удаляется

- `DATA_DIR` на сервере (`/var/lib/sozvon`) — база, файлы, `secret.key`;
- `/etc/sozvon.env` и бэкапы;
- git-история: `git show <старый-коммит>:server/src/index.js` вернёт Node-код, если понадобится;
- клиент (`client/`), LiveKit и coturn.

## Если что-то пошло не так

Откат кода Node — из git, без потери данных: `git revert <коммит удаления>`, затем
`sudo SERVER_IMPL=node bash deploy/vps/setup.sh`, если Node-ветка деплоя ещё сохранена.
Схема базы общая, поэтому переключение в обе стороны безопасно.
