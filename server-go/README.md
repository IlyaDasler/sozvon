# Go-сервер: фаза 1

Каркас будущего сервера «Созвона» на Go. План и ограничения — `docs/adr/0002-go-backend.md`.

## Что уже есть (фаза 1)

- конфиг из тех же переменных окружения, что у Node (`PORT`, `DATA_DIR`, `INVITE_CODE`,
  `SMTP_HOST`, `SMTP_USER`);
- открытие **той же** SQLite-базы (`DATA_DIR/sozvon.db`): WAL, `busy_timeout`, внешние ключи,
  одно соединение на запись;
- миграции с таблицей `schema_migrations`, идемпотентные при повторном запуске;
- `GET /api/health` с ответом 1:1 как у Node (сверено с `server/contract/api.json`);
- `log/slog`, таймауты, корректная остановка по SIGINT/SIGTERM.

## Чего ещё нет

Маршрутов API, WebSocket, авторизации, файлов, LiveKit. Они добавляются фазами 2–6;
до переключения Node-сервер остаётся рабочим.

## Сборка и запуск

```powershell
cd sozvon\server-go
$env:GOPROXY = "https://goproxy.cn,direct"   # если proxy.golang.org медленно
go build -o sozvon-server-go.exe .
$env:PORT = "3100"
$env:DATA_DIR = "..\_go-data"
.\sozvon-server-go.exe
curl.exe http://127.0.0.1:3100/api/health
```

Ожидаемый ответ:

```json
{"ok":true,"app":"sozvon","inviteRequired":false,"emailCodes":false}
```

Повторный запуск не должен применять миграции второй раз — в логе будет тот же список версий,
а `schema_migrations` не вырастет.

## Сверка с контрактом

Когда появятся маршруты, прогонять тот же сценарий:

```powershell
$env:CONTRACT_BASE = "http://127.0.0.1:3100/api"
node _tools\contract-snapshot.js
```

`api.json` перезапишется; сравнить с эталоном в git по форме и кодам (значения нормализованы).
