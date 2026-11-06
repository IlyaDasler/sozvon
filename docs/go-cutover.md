# Переключение сервера на Go: чек-лист

Документ — практический план переключения с Node-сервера на Go (ADR 0002, фаза 7).
Пока он не выполнен, Node остаётся основным сервером, Go можно запускать рядом
на копии базы. Ничего в этом файле не требует останавливать прод до последнего шага.

## Что где лежит

| Что | Сейчас (Node) | Go |
|---|---|---|
| Код | `server/src` | `server-go` |
| Сервис systemd | `sozvon.service` → `node src/index.js` | добавляем `sozvon-go.service` |
| Порт | `3000` (Caddy проксирует на него) | предлагается `3001` на время проверки |
| Данные | `DATA_DIR` из `/etc/sozvon.env` | тот же `DATA_DIR` |
| Секрет токенов | `DATA_DIR/secret.key` | тот же файл (обязательно) |
| Бэкапы | `sozvon-backup.timer` → `node src/backup.js` | `sozvon-backup` (`cmd/backup`), можно заменить |
| LiveKit, coturn | отдельные сервисы | не меняются |

## Шаг 0. Предусловия

- [ ] `server-go`: `go vet ./...`, `go test ./...` — зелёные (включая сторожа контракта
      `server-go/contract_test.go` по фикстурам `server/contract/*.json`).
- [ ] CI зелёный на ветке, с которой будет переключение (`go-tests` в `.github/workflows/build.yml`).
- [ ] Свежий бэкап прода: `systemctl start sozvon-backup.service`, файл появился в `BACKUP_DIR`.
- [ ] `/etc/sozvon.env` не менялся: те же `DATA_DIR`, `JWT_SECRET`/`secret.key`, `LIVEKIT_*`,
      `TURN_SECRET`, `STUN_URLS`/`TURN_URLS`, `PUBLIC_URL`, SMTP, `INVITE_CODE`.
- [ ] Бинарник на сервере: либо `cd /opt/sozvon/server-go && go build -o /usr/local/bin/sozvon-go .`,
      либо (предпочтительно) готовый из релиза — `sudo SERVER_IMPL=go bash deploy/vps/setup.sh`
      поставит `sozvon-go`/`sozvon-backup` и проверит sha256; для чистого сервера это же
      заменяет ручную установку сервиса из шага 2.

## Шаг 1. Проверка на копии прод-базы (без риска)

1. Сделать копию базы и файлов (Node-сервер останавливать не нужно):
   ```bash
   sudo -u sozvon BACKUP_DIR=/tmp/sozvon-copy-data /usr/local/bin/sozvon-backup
   ```
   (если `sozvon-backup` ещё не установлен — `BACKUP_DIR=/tmp/... node /opt/sozvon/server/src/backup.js`).
2. Каталог `/tmp/sozvon-copy-data` — это `DATA_DIR` с базой, `files/`, `avatars/` и `secret.key`.
3. Запустить Go на копии, порт 3001:
   ```bash
   sudo -u sozvon env DATA_DIR=/tmp/sozvon-copy-data PORT=3001 \
     /usr/local/bin/sozvon-go
   ```
4. Прогнать по нему клиентские сценарии и сверить API:
   - `curl -s http://127.0.0.1:3001/api/health` — ответ как у Node (`ok`, `app`, версии);
   - вход существующим пользователем (пароль и 2FA), `/api/me`, список чатов;
   - отправка/правка/удаление сообщения, реакции, пины, тред, вложения;
   - событие канала: создание, ответ «готов в другое время», завершение, напоминание;
   - звонок на двоих на двух машинах: приглашение, ответ, обрыв и `call:resume`;
   - голосовая комната через LiveKit (пропуск выдаёт Go), `/api/ice` с TURN;
   - e2e-набор клиента против Go: `E2E_... node_modules/electron/dist/electron.exe scripts/<сценарий>.js http://127.0.0.1:3001`.
5. Сравнить сырые ответы Node и Go на одинаковых запросах (пока Node на проде):
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" https://$DOMAIN/api/me | jq -S . > /tmp/node-me.json
   curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3001/api/me | jq -S . > /tmp/go-me.json
   diff -u /tmp/node-me.json /tmp/go-me.json
   ```
   Так же проверить `/api/rooms`, `/api/contacts`, `/api/hubs`, `/api/sessions`.
   Расхождение в **ключах и кодах** — блокер, в значениях (id, время, токены) — нормально.
6. Копию после проверки удалить: `rm -rf /tmp/sozvon-copy-data`.

## Шаг 2. Установка Go-сервиса рядом (Node продолжает работать)

```ini
# /etc/systemd/system/sozvon-go.service
[Unit]
Description=Sozvon voice chat server (Go)
After=network-online.target
Wants=network-online.target

[Service]
User=sozvon
Group=sozvon
EnvironmentFile=/etc/sozvon.env
Environment=PORT=3001
ExecStart=/usr/local/bin/sozvon-go
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/sozvon

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sozvon-go
sudo systemctl status sozvon-go --no-pager
curl -fsS http://127.0.0.1:3001/api/health && echo ok
```

Таймер бэкапа можно перевести на Go-утилиту (проверив на копии, что копия читается):

```ini
# /etc/systemd/system/sozvon-backup.service — заменить ExecStart
ExecStart=/usr/local/bin/sozvon-backup
# EnvironmentFile=/etc/sozvon.env остаётся, BACKUP_DIR/BACKUP_KEEP_DAYS — из него же
```

## Шаг 3. Окно переключения (5–10 минут)

1. Объявить окно (если есть пользователи) и не выкатывать в это время релизы клиента.
2. Свежий бэкап: `systemctl start sozvon-backup.service`.
3. Остановить Node и запустить Go на порту 3000:
   ```bash
   sudo systemctl stop sozvon
   sudo systemctl set-environment PORT=3000        # или правка EnvironmentFile
   sudo systemctl restart sozvon-go
   ```
   Вариант без смены порта: оставить Go на 3001 и переключить Caddy на него одной строкой.
4. Caddy (одна строка — точка переключения и отката):
   ```caddyfile
   handle {
       reverse_proxy 127.0.0.1:3001
   }
   ```
   ```bash
   sudo systemctl reload caddy
   ```
5. Проверка «дыма» через прод-домен:
   ```bash
   curl -fsS https://$DOMAIN/api/health
   ```
6. Отменить старый таймер Node-бэкапа, если перевели на `sozvon-backup`:
   `sudo systemctl disable --now sozvon-backup.timer` (или оставить Node-версию до стабилизации).

## Шаг 4. Проверка после переключения

- [ ] Вход существующим пользователем, `/api/me`, список чатов и участников.
- [ ] Новый пользователь регистрируется (инвайт-код, почта если настроена).
- [ ] Сообщение в комнату и в личку: отправка, правка, удаление, реакции, пин, тред.
- [ ] Вложение и аватар загружаются и открываются.
- [ ] Событие канала: создать, ответить, дождаться, что другие видят обновление.
- [ ] Голосовая комната: вход, звук, экран (LiveKit-пропуск от Go).
- [ ] Звонок на двоих: приглашение/ответ/отбой, обрыв сети и возврат (`call:resume`).
- [ ] 2FA: вход с кодом, отзыв других устройств (`/api/sessions`, revoke-others).
- [ ] Клиент не «ругается» на версию (`minClient`/`latestVersion` в `/api/health`).
- [ ] В логах `journalctl -u sozvon-go -n 200` нет 500 и паники.
- [ ] Бэкап-таймер отработал после переключения и копия читается.

## Откат (одна команда + одна строка)

```bash
sudo systemctl stop sozvon-go
sudo systemctl start sozvon          # Node снова на 3000
sudo systemctl reload caddy          # если Caddy переключали на 3001
```

Почему откат безопасен:

- схема БД общая: Go применяет только `008_events.sql` (`CREATE TABLE IF NOT EXISTS`),
  остальные таблицы не меняет; Node запускается на той же базе и сам добавляет
  недостающие колонки событий;
- `secret.key` общий — выданные Go токены и сессии действительны и в Node;
- файлы (`files/`, `avatars/`, `banners/`, `wallpapers/`) и их пути не менялись;
- LiveKit и coturn не затрагиваются, пропуска и TURN-данные формируются одинаково.

## Риски и как их снимаем

| Риск | Мера |
|---|---|
| Скрытые договорённости API (порядок полей, коды 404/403) | сторожа контракта в `go test`, сравнение ответов на шаге 1 |
| Двойная запись при случайном запуске двух серверов на одной базе | порт 3001 только для копии `DATA_DIR`; прод-база — только у одного процесса |
| Разные часовые пояса для `nextAt` событий | сервис Go запускать с той же `TZ`, что Node (по умолчанию системная) |
| E2EE: сервер не должен видеть текст | контракт не менялся: Go хранит и передаёт только конверты |
| Потеря файлов при переключении | `DATA_DIR` общий, перед окном — свежий бэкап |
| Забытые env-переменные | `EnvironmentFile=/etc/sozvon.env` один и тот же у обоих сервисов |

## Что ещё не сделано и не блокирует переключение

- Встроенный TURN (`TURN_EMBEDDED=1`) не перенесён: деплой использует внешний coturn
  с `TURN_SECRET` — этот путь в Go работает.
- Живой теневой прогон «два сервера на одном потоке запросов» не делаем: он рискует
  гонками WebSocket/presence. Вместо него — копия базы + сверка ответов (шаг 1).
