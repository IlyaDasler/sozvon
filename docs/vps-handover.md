# Передача VPS: развернуть Go-сервер «Созвона»

Короткая инструкция для того, у кого сервер. Всё, что нужно, — Ubuntu VPS и root-доступ.
Подробности по переключению с уже работающего Node-сервера — в [go-cutover.md](go-cutover.md),
общая инструкция по своему серверу — в [self-hosting.md](self-hosting.md).

## Вариант A. Чистый сервер (5 минут)

```bash
# 1. Поставить всё: Go-сервер, LiveKit, coturn, Caddy, HTTPS и ежедневные копии
curl -fsSL https://raw.githubusercontent.com/IlyaDasler/sozvon/main/deploy/vps/setup.sh \
  | sudo SERVER_IMPL=go bash

# 2. Записать из вывода скрипта: адрес (https://…), код приглашения (если нужен)

# 3. Проверить, что всё живо
sudo bash /opt/sozvon/deploy/vps/check.sh
```

Если репозиторий уже склонирован, второй вариант той же команды:

```bash
sudo SERVER_IMPL=go bash /opt/sozvon/deploy/vps/setup.sh
```

Скрипт можно запускать повторно — база, секреты и код приглашения сохраняются, код обновляется.

## Вариант B. Уже работает Node-сервер

Не останавливайте Node. Порядок — в [go-cutover.md](go-cutover.md), коротко:

```bash
# 1. Свежая копия базы
sudo systemctl start sozvon-backup.service

# 2. Поставить Go-сервис рядом (порт 3001), Node продолжает работать
sudo SERVER_IMPL=go bash /opt/sozvon/deploy/vps/setup.sh
#    (скрипт перезапишет sozvon.service на Go — поэтому для «рядом» лучше
#     сначала прогнать проверку на копии базы по чек-листу)

# 3. Проверка на копии базы — по шагу 1 чек-листа

# 4. Переключение и откат — по шагам 3–4 чек-листа
```

Точные команды для «рядом» и откат одной командой — в [go-cutover.md](go-cutover.md).

## Что прислать владельцу после установки

- адрес сервера (`https://…`) и код приглашения, если он включён;
- вывод `sudo bash /opt/sozvon/deploy/vps/check.sh` (должно быть «Всё в порядке»);
- версию из `curl -s https://<адрес>/api/health` (поля `latestVersion`, `minClient`).

## Обновление сервера потом

```bash
cd /opt/sozvon && sudo git fetch origin && sudo git reset --hard origin/main
sudo SERVER_IMPL=go bash deploy/vps/setup.sh   # переустановит бинарник и перезапустит
```

Данные не трогаются: база и файлы лежат в `/var/lib/sozvon`, настройки — в `/etc/sozvon.env`.

## Если что-то не работает

| Симптом | Что смотреть |
|---|---|
| `check.sh` ругается на службу | `systemctl status sozvon`, `journalctl -u sozvon -n 100 --no-pager` |
| Нет HTTPS | `journalctl -u caddy -n 50`; домен должен указывать на IP сервера |
| Не работают звонки | `journalctl -u livekit -n 50`, `journalctl -u coturn -n 50`, порты 3478/5349 и 50000–50200 |
| Нет копий | `systemctl list-timers | grep sozvon`, `systemctl start sozvon-backup.service` |
| «Legacy client» или просит обновиться | `/api/health`: `minClient`/`latestVersion` в `/etc/sozvon.env` |
| После перезапуска все разлогинились | пропал `/var/lib/sozvon/secret.key` — восстановить из копии |

## Если нужно вернуться на Node

```bash
sudo SERVER_IMPL=node bash /opt/sozvon/deploy/vps/setup.sh
```

База, секреты и файлы общие, поэтому данные на месте; клиенты ничего не заметят.

## Для владельца репозитория (до передачи)

- [ ] изменения запушены в `main` (или ветку, с которой ставится сервер);
- [ ] если хотите установку из готовых бинарников — поставьте тег `vX.Y.Z`:
      CI соберёт `sozvon-go`/`sozvon-backup` под `amd64`/`arm64` и прикрепит к релизу;
      без тега `setup.sh` соберёт из исходников на сервере (нужен Go или авто-загрузка тулчейна);
- [ ] в релизе есть `SHA256SUMS-go.txt` — по нему скрипт проверяет бинарники;
- [ ] другу отправлены адрес репозитория/ветки и эта инструкция.
