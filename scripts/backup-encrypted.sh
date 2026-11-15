#!/bin/sh
# Шифрованный бэкап SQLite. Ключ должен храниться отдельно от сервера.
set -eu
umask 077
db="${SOZVON_DB:-/var/lib/sozvon/sozvon.db}"
out="${SOZVON_BACKUP_DIR:-/var/backups/sozvon}"
key="${SOZVON_BACKUP_KEY:-/etc/sozvon-backup.key}"
test -s "$db"
test -s "$key"
mkdir -p "$out"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
sqlite3 "$db" ".timeout 5000" ".backup '$tmp'"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --passphrase-file "$key" \
  -o "$out/sozvon-$stamp.db.gpg" "$tmp"
find "$out" -type f -name 'sozvon-*.db.gpg' -mtime +30 -delete
echo "backup: $out/sozvon-$stamp.db.gpg"