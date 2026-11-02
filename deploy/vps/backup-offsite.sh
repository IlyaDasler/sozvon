#!/bin/bash
# Выгрузка резервной копии базы в объектное хранилище (S3-совместимое).
# Ключи доступа лежат НЕ здесь, а в /root/.config/rclone/rclone.conf (его заполняет владелец сервера).
# Пока конфигурации нет — просто выходим: сервер не должен ругаться из-за ненастроенной копии.
#
# Пример конфигурации для Selectel (панель: my.selectel.ru/storage → Продукты → S3 → Бакеты):
#
#   [sozvon]
#   type = s3
#   provider = Selectel
#   access_key_id = ...
#   secret_access_key = ...
#   region = ru-1
#   endpoint = https://s3.ru-1.storage.selcloud.ru
#
# Пул и адрес S3 API зависят от пула: ru-1 → s3.ru-1.storage.selcloud.ru,
# ru-3 → s3.ru-3.storage.selcloud.ru (docs.selectel.ru/s3/manage/domains/).
# Для Selectel нужен rclone 1.69 или новее и включённая Virtual-Hosted адресация в бакете.
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

# Бакета может не быть: rclone mkdir для S3 создаёт его, если он ещё не заведён
REMOTE_NAME=${REMOTE%%:*}
BUCKET=${REMOTE#*:}
BUCKET=${BUCKET%%/*}
rclone mkdir --config "$CONF" "$REMOTE_NAME:$BUCKET" >/dev/null 2>&1 || true

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
