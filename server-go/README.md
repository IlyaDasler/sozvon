# Go-сервер «Созвона»

Совместимая замена Node-сервера по плану `docs/adr/0002-go-backend.md`.
Пока работает параллельно: Node остаётся основным, Go догоняет по фазам.

## Что готово

**Фаза 1 — каркас**
- конфиг из тех же переменных окружения (`PORT`, `DATA_DIR`, `INVITE_CODE`, `SMTP_HOST`, `SMTP_USER`, `JWT_SECRET`);
- та же SQLite-база (`DATA_DIR/sozvon.db`): WAL, `busy_timeout`, внешние ключи, одно соединение на запись;
- миграции с `schema_migrations`, идемпотентные;
- `GET /api/health` — ответ 1:1 с Node;
- `log/slog`, таймауты, корректная остановка.

**Фаза 2 — аккаунты**
- `POST /api/register`, `POST /api/login` — scrypt-хеши в формате Node (`scrypt$salt$hash`);
- токены в формате Node (`base64url(payload).base64url(HMAC-SHA256)`, TTL 30 дней), общий `secret.key`;
- серверные сессии: `GET /api/sessions`, `DELETE /api/sessions/{id}`;
- `GET /api/me`, `POST /api/ws-ticket`;
- проверено: пользователь, созданный Node, входит через Go, и наоборот; `me` совпадает.

## Чего ещё нет

Контакты, хабы, комнаты, сообщения, файлы, реакции, звонки, LiveKit, OAuth, полная
проверка TOTP, регистрация по почте. Фазы 3–6.

## Сборка и запуск

Go установлен в `%LOCALAPPDATA%\Programs\Go` и добавлен в PATH пользователя
(нужен новый терминал). Временный PATH для текущей сессии:

```powershell
$env:Path = "$env:LOCALAPPDATA\Programs\Go\bin;$env:Path"
cd sozvon\server-go
go test ./...
go build -o sozvon-server-go.exe .
$env:PORT = "3100"
$env:DATA_DIR = "..\_e2e\data"   # можно указать тот же каталог, что у Node
.\sozvon-server-go.exe
curl.exe http://127.0.0.1:3100/api/health
```

## Сверка с Node

```powershell
$env:CONTRACT_BASE = "http://127.0.0.1:3100/api"
$env:CONTRACT_OUT  = "..\_backup\contract-go"   # каталог
node ..\..\_tools\contract-snapshot.js
node ..\..\_tools\contract-compare.js ..\server\contract\api.json ..\_backup\contract-go\api.json health register-a register-b login me ws-ticket
```

Ожидаемо: `✔ контракт совпал`.
**Фаза 3 — контакты и каналы (ядро)**
- `GET/POST/DELETE /api/contacts`, `POST /api/contacts` (заявка), `GET /api/friend-requests`,
  `POST /api/friend-requests/{id}/accept`, `DELETE /api/friend-requests/{id}`;
- `GET /api/blocks`, `POST/DELETE /api/blocks/{id}`;
- `POST/GET /api/hubs`, `PATCH /api/hubs/{id}`, `GET /api/hub-invites`;
- `POST/GET /api/rooms`, `PATCH /api/rooms/{id}`;
- при создании канала, как в Node, сразу появляются «Голосовая» и «Общий чат», роли и участники;
- проверено: контракт (16 вызовов) совпал; Go видит дружбу, созданную Node, а Node — канал и
  комнату, созданные Go, на одной базе.

Ещё не перенесено: роли (создание/изменение), управление участниками, баны, принятие
приглашений в канал, удаление комнат, группы и эмодзи, права.
**Фаза 4 — сообщения и треды**
- `GET /api/rooms/{id}/messages?before&limit`, `POST /api/rooms/{id}/messages`
  (`text`, `mentionAll`, `threadRootId`, `replyTo`);
- `GET /api/rooms/{id}/messages/{messageId}/thread` — корень и ответы;
- `POST /api/rooms/{id}/read`, `GET /api/unread`;
- ответы 1:1 с Node: в ленте `replies` есть всегда, у ответа — `rootFrom`, в треде «плоская» форма;
- `lastActivity` комнаты теперь считается по последнему сообщению;
- проверено: контракт (22 вызова) совпал; Node видит сообщения и ответы из Go, Go — из Node.

Ещё не перенесено: реакции, пины, вложения и предпросмотр ссылок, правка/удаление, доставка
событий по WebSocket.
**Фаза 5 — реальное время (первый срез)**
- `/ws?ticket=…` (и `?token=…` для старых версий), билет одноразовый, живёт 30 секунд;
- presence: подключение/отключение и смена статуса (`online / idle / dnd / invisible`),
  рассылка друзьям и соседям по каналам как в Node;
- `typing` — только участникам комнаты или другу, событие `{type, userId, conv}`;
- `read` — отметка прочтения и событие `read` другим устройствам;
- `me:status` — смена статуса;
- HTTP-отправка сообщения рассылает `room:message` участникам комнаты,
  ответ в треде — `room:thread:new`;
- пинг каждые 30 секунд, лимит сообщения 64 КБ;
- проверено node-клиентом: presence приходит, typing и статус доходят, сообщение из HTTP
  приходит по сокету.

Ещё не перенесено: звонки и сигналинг (`call:*`, `room:signal`), голосовые комнаты,
LiveKit-токены, TURN, правка/удаление и реакции по сокету.
**Фаза 5 — звонки на двоих**
- `call:invite` → звонящему `call:ringing`, вызываемому `call:incoming` с профилем;
- `call:accept` → звонящему `call:accepted`; проверка дружбы, онлайн и занятости;
- `signal` (SDP/ICE) → второму участнику, с `from` и `data`;
- `call:decline`, `call:hangup`, таймаут 45 с, `call:ended` обоим;
- при обрыве соединения участник выходит, второй получает `call:ended`;
- проверено node-клиентом: ringing, incoming, accepted, signal, ended — все пять.

Ещё не перенесено: групповые звонки (`call:add`, несколько участников), голосовые комнаты
(`room:join`/`room:leave`, кто в голосе), LiveKit-пропуска и TURN.
