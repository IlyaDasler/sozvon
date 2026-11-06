#!/usr/bin/env bash
# Проверка сервера «Созвона» после установки или переключения.
# Запуск на VPS:  sudo bash deploy/vps/check.sh
# Ничего не меняет — только читает настройки, службы и файлы.
set -uo pipefail

ENV_FILE=${ENV_FILE:-/etc/sozvon.env}
OK=0
FAIL=0
ok() { echo "  ✔ $*"; OK=$((OK + 1)); }
bad() { echo "  ✖ $*"; FAIL=$((FAIL + 1)); }
step() { printf '\n==> %s\n' "$*"; }

if [ ! -f "$ENV_FILE" ]; then
  echo "Нет файла настроек $ENV_FILE — сервер не установлен?"
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

step 'Служба'
if systemctl is-active --quiet sozvon; then
  ok 'sozvon запущен'
else
  bad 'sozvon не работает (journalctl -u sozvon -n 50)'
fi
if systemctl cat sozvon 2>/dev/null | grep -q 'sozvon-go'; then
  ok 'реализация: Go (sozvon-go)'
else
  bad 'sozvon запускает не sozvon-go — посмотрите systemctl cat sozvon'
fi
for unit in livekit coturn caddy; do
  if systemctl is-active --quiet "$unit"; then ok "$unit запущен"; else bad "$unit не работает"; fi
done

step 'HTTP'
port=${PORT:-3000}
if curl -fsS --max-time 5 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
  ok "health на localhost:$port"
else
  bad "health на localhost:$port не отвечает"
fi
if [ -n "${DOMAIN:-}" ] && curl -fsS --max-time 10 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
  ok "health по https://$DOMAIN"
else
  [ -n "${DOMAIN:-}" ] && bad "https://$DOMAIN/api/health не отвечает (journalctl -u caddy -n 30)"
fi
if [ -n "${DOMAIN:-}" ] && curl -fsS --max-time 10 "https://$DOMAIN/livekit/" >/dev/null 2>&1; then
  ok "LiveKit через Caddy"
else
  [ -n "${DOMAIN:-}" ] && bad "LiveKit через Caddy не отвечает"
fi

step 'Данные и настройки'
data=${DATA_DIR:-/var/lib/sozvon}
if [ -d "$data" ]; then ok "каталог данных $data"; else bad "нет каталога данных $data"; fi
if [ -f "$data/sozvon.db" ]; then ok 'база sozvon.db на месте'; else bad "нет базы $data/sozvon.db"; fi
if [ -f "$data/secret.key" ]; then
  ok 'secret.key на месте (сессии и токены переживут перезапуск)'
else
  bad 'нет secret.key — после перезапуска все сессии станут недействительными'
fi
mode=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')
if [ "$mode" = '640' ] || [ "$mode" = '600' ]; then ok "права на $ENV_FILE: $mode"; else bad "у $ENV_FILE права $mode, ждали 640"; fi

step 'Порты'
if ss -lnt 2>/dev/null | grep -q ":$port "; then ok "порт $port слушает localhost"; else bad "порт $port не слушает"; fi
if ss -lnt 2>/dev/null | grep -q ':7880 '; then ok 'порт 7880 (LiveKit) слушает'; else bad 'порт 7880 (LiveKit) не слушает'; fi
if ss -lun 2>/dev/null | grep -q ':3478 '; then ok 'порт 3478/UDP (coturn) слушает'; else bad 'порт 3478/UDP (coturn) не слушает'; fi

step 'Резервные копии'
backups=${BACKUP_DIR:-/var/backups/sozvon}
latest=$(find "$backups" -maxdepth 1 -name 'sozvon-*.db' -mmin -2880 2>/dev/null | sort | tail -1)
if [ -n "$latest" ]; then
  ok "свежая копия: $latest"
else
  bad "за двое суток нет копий в $backups (systemctl start sozvon-backup.service)"
fi

step 'Итог'
if [ "$FAIL" -eq 0 ]; then
  echo "  Всё в порядке: $OK проверок прошли."
  exit 0
fi
echo "  Проблем: $FAIL, успешных проверок: $OK."
echo '  Журналы: journalctl -u sozvon -n 100 --no-pager'
exit 1
