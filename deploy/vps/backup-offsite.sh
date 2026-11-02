#!/bin/bash
# Выгрузка резервной копии базы в объектное хранилище (S3-совместимое).
# Ключи доступа лежат НЕ здесь, а в /root/.config/rclone/rclone.conf (его заполняет владелец сервера).
# Пока конфигурации нет — просто выходим: сервер не должен ругаться из-за ненастроенной копии.
set -uo pipefail

REMOTE="${OFFSITE_REMOTE:-sozvon:sozvon-backup}"
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-14}"
DB=/var/lib/sozvon/sozvon.db
CONF=/root/.config/rclone/rclone.conf

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

if ! command -v rclone >/dev/null 2>&1; then
  log "rclone не установлен — выгрузка пропущена"
  exit 0
fi
if [ ! -f "$CONF" ]; then
  log "нет $CONF — выгрузка не настроена, пропускаем"
  exit 0
fi

STAMP=$(date +%Y-%m-%d-%H%M%S)
BK="/root/sozvon-offsite-$STAMP.db"

# Свежая копия через VACUUM INTO: обычное копирование WAL-базы даёт битый файл
umask 077
if ! sqlite3 "$DB" "VACUUM INTO '$BK'"; then
  log "не удалось сделать копию базы"
  exit 1
fi

if ! rclone copy --config "$CONF" --no-traverse "$BK" "$REMOTE/"; then
  log "выгрузка не удалась: $BK остался на диске"
  rm -f "$BK"
  exit 1
fi
log "выгружено: $(basename "$BK") ($(stat -c%s "$BK") байт)"

# На сервере копия больше не нужна — она уже в хранилище
rm -f "$BK"

# Старые копии в хранилище чистим, чтобы не рос счёт
rclone delete --config "$CONF" --min-age "${KEEP_DAYS}d" "$REMOTE/" || log "не удалось почистить старые копии"
log "готово"
