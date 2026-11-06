# Go-сервер «Созвона»

Единственный сервер приложения с версии 3.4: REST API, WebSocket-события, звонки,
голосовые комнаты, вложения, события каналов и SQLite-база.

## Запуск

```bash
cd server-go
go test ./...
go run .            # http://localhost:3000
```

Переменные окружения — в `deploy/.env.example`; основные:
`PORT`, `DATA_DIR`, `WEB_DIR`, `PUBLIC_URL`, `INVITE_CODE`, `LIVEKIT_*`,
`TURN_SECRET`, `STUN_URLS`, `TURN_URLS`, `MIN_CLIENT_VERSION`, `LATEST_CLIENT_VERSION`.

## Проверки

- `go vet ./...`
- `go test ./...` — API, WebSocket-события, сторожа контракта `contract/*.json`,
  лимиты частоты, миграции, резервные копии.
- `go build -o sozvon .`
- `go build -o sozvon-backup ./cmd/backup`
- `go build -o sozvon-mailtest ./cmd/mailtest` — проверка SMTP тем же кодом, что у сервера.

## Установка

На Ubuntu VPS:

```bash
sudo bash deploy/vps/setup.sh
```

Скрипт ставит Go-бинарники `sozvon-go`, `sozvon-backup`, `sozvon-mailtest`, LiveKit,
coturn, Caddy и systemd-службы. База и файлы лежат в `DATA_DIR` (`/var/lib/sozvon`),
секреты — в `/etc/sozvon.env`, резервные копии — в `/var/backups/sozvon`.

Проверка: `sudo bash deploy/vps/check.sh`.

## Docker

```bash
cd deploy
cp .env.example .env
docker compose up -d
```
