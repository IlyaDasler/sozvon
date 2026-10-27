#!/usr/bin/env bash
# Установка сервера «Созвон» на VPS с Ubuntu без Docker: Node.js + coturn + systemd.
# Docker Hub ограничивает доступ с российских IP, поэтому всё ставится из репозиториев Ubuntu.
#
#   curl -fsSL https://raw.githubusercontent.com/IlyaDasler/sozvon/main/deploy/vps/setup.sh | sudo bash
#   или: sudo INVITE_CODE=код bash deploy/vps/setup.sh
#
# Повторный запуск обновляет код и сохраняет базу, код приглашения и секреты.
set -euo pipefail

REPO=https://github.com/IlyaDasler/sozvon.git
APP_DIR=/opt/sozvon
DATA_DIR=/var/lib/sozvon
ENV_FILE=/etc/sozvon.env
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

# На 1 ГБ памяти npm может не хватить без подкачки
if ! swapon --show | grep -q /swapfile; then
  log 'Добавляю файл подкачки 1 ГБ'
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log 'Ставлю пакеты'
apt-get update -qq
apt-get install -y -qq nodejs npm coturn git ufw caddy >/dev/null

node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<13)) { console.error("Нужен Node.js 22.13+, а стоит "+process.version); process.exit(1) }'

log 'Скачиваю код'
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin main && git -C "$APP_DIR" reset -q --hard origin/main
else
  git clone -q "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

id sozvon >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin sozvon
mkdir -p "$DATA_DIR" && chown sozvon:sozvon "$DATA_DIR" && chmod 700 "$DATA_DIR"

# Настройки: сохраняем прежние значения при повторном запуске
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
PUBLIC_IP=${PUBLIC_IP_OVERRIDE:-$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')}
TURN_SECRET=${TURN_SECRET:-$(openssl rand -hex 32)}
# Пустой INVITE_CODE= в настройках означает «регистрация без кода» — его не перезаписываем
INVITE_CODE=${INVITE_CODE-$(tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 8)}
# Домен для HTTPS. Если своего нет — бесплатный адрес sslip.io, который сам указывает на IP сервера
DOMAIN=${DOMAIN:-${PUBLIC_IP//./-}.sslip.io}

log 'Записываю настройки'
umask 077
cat > "$ENV_FILE" <<EOF
PORT=3000
DATA_DIR=$DATA_DIR
WEB_DIR=$APP_DIR/client/renderer
PUBLIC_IP=$PUBLIC_IP
DOMAIN=$DOMAIN
INVITE_CODE=$INVITE_CODE
TURN_SECRET=$TURN_SECRET
STUN_URLS=stun:$PUBLIC_IP:3478
TURN_URLS=turn:$PUBLIC_IP:3478?transport=udp,turn:$PUBLIC_IP:3478?transport=tcp
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-}
YANDEX_CLIENT_ID=${YANDEX_CLIENT_ID:-}
YANDEX_CLIENT_SECRET=${YANDEX_CLIENT_SECRET:-}
VK_CLIENT_ID=${VK_CLIENT_ID:-}
EOF
chmod 640 "$ENV_FILE" && chgrp sozvon "$ENV_FILE"
umask 022

log 'Настраиваю TURN (coturn)'
cat > /etc/turnserver.conf <<EOF
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=$TURN_SECRET
realm=sozvon
external-ip=$PUBLIC_IP
min-port=49160
max-port=49200
no-cli
no-tls
no-dtls
no-multicast-peers
simple-log
syslog
# Не даём использовать TURN для доступа во внутренние сети
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
EOF
chmod 640 /etc/turnserver.conf && chgrp turnserver /etc/turnserver.conf 2>/dev/null || true
[ -f /etc/default/coturn ] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable -q coturn && systemctl restart coturn

log 'Настраиваю сервис «Созвон»'
cat > /etc/systemd/system/sozvon.service <<EOF
[Unit]
Description=Sozvon voice chat server
After=network-online.target
Wants=network-online.target

[Service]
User=sozvon
Group=sozvon
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR/server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q sozvon && systemctl restart sozvon

log "Настраиваю HTTPS для $DOMAIN (Caddy сам получит и будет продлевать сертификат Let's Encrypt)"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy localhost:3000
}
EOF
systemctl enable -q caddy && systemctl reload-or-restart caddy

log 'Настраиваю брандмауэр'
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
# 3000 оставлен для приложений до версии 1.4.0, которые ходят напрямую по http
ufw allow 3000/tcp >/dev/null
ufw allow 3478 >/dev/null
ufw allow 49160:49200/udp >/dev/null
ufw --force enable >/dev/null

for i in $(seq 1 20); do
  curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS http://localhost:3000/api/health >/dev/null || { journalctl -u sozvon -n 30 --no-pager; exit 1; }

for i in $(seq 1 60); do
  curl -fsS "https://$DOMAIN/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "https://$DOMAIN/api/health" >/dev/null || { echo 'HTTPS не поднялся:'; journalctl -u caddy -n 20 --no-pager; exit 1; }

log 'Готово'
echo "  Адрес сервера:     https://$DOMAIN"
echo "  Код приглашения:   ${INVITE_CODE:-не нужен (регистрация открыта)}"
echo "  Настройки и ключи: $ENV_FILE (после правки: systemctl restart sozvon)"
echo "  Журнал:            journalctl -u sozvon -f"
