#!/usr/bin/env bash
# Выкладывает текущий веб-клиент из репозитория в Caddy root.
# Запускать на сервере после обновления кода/перед релизом:
#   sudo /opt/sozvon/deploy/vps/sync-web.sh
# или с явным путём к renderer:
#   sudo ./sync-web.sh ./client/renderer
set -euo pipefail

SOURCE=${1:-"$(cd "$(dirname "$0")/../.." && pwd)/client/renderer"}
WEB_ROOT=${WEB_ROOT:-/opt/sozvon-web}

if [ ! -f "$SOURCE/index.html" ]; then
  echo "Нет $SOURCE/index.html — укажи каталог client/renderer" >&2
  exit 1
fi
command -v rsync >/dev/null || { echo 'Нужен rsync' >&2; exit 1; }

mkdir -p "$WEB_ROOT/updates"
# updates/ — большие архивы обновлений, их этот скрипт не трогает
rsync -a --delete --exclude 'updates/' "$SOURCE/" "$WEB_ROOT/"
echo "Веб-клиент обновлён: $SOURCE → $WEB_ROOT"
