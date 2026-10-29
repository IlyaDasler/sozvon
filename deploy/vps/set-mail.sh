#!/usr/bin/env bash
# Почтовый ящик для писем с кодами (регистрация по почте, сброс пароля, привязка почты).
# Спрашивает адрес и пароль приложения и отправляет на этот же ящик пробное письмо с кодом. Ушло — записывает
# в /etc/sozvon.env и перезапускает сервер; не ушло — почту на сервере выключает, чтобы люди видели «почта
# не настроена», а не «письмо не отправлено». Пароль вводится только здесь и не показывается.
#
#   ssh -t root@сервер 'bash /opt/sozvon/deploy/vps/set-mail.sh'
set -euo pipefail

ENV_FILE=/etc/sozvon.env
APP_DIR=/opt/sozvon

[ "$(id -u)" = 0 ] || { echo 'Запустите от root'; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE — сначала установите сервер (deploy/vps/setup.sh)"; exit 1; }

read -rp 'Почта, с которой слать письма (например, sozvon.noreply@yandex.ru): ' SMTP_USER
[[ "$SMTP_USER" =~ ^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo 'Это не похоже на адрес почты'; exit 1; }

# Для Яндекса сервер известен; для другой почты — спросим
case "${SMTP_USER##*@}" in
  yandex.ru | ya.ru | yandex.com) SMTP_HOST=smtp.yandex.ru ;;
  *) read -rp 'Адрес SMTP-сервера этой почты (например, smtp.mail.ru): ' SMTP_HOST ;;
esac
[[ "$SMTP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo 'Неверный адрес SMTP-сервера'; exit 1; }

read -rsp 'Пароль приложения (при вводе не видно): ' SMTP_PASS
echo
# Пароль попадает в файл настроек как есть — без пробелов, кавычек и других знаков, которые его испортят
[[ -n "$SMTP_PASS" && "$SMTP_PASS" =~ ^[A-Za-z0-9._@%+=:,/-]+$ ]] || { echo 'Пароль пустой или с пробелами и кавычками — создайте пароль приложения заново'; exit 1; }

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
grep -v '^SMTP_' "$ENV_FILE" > "$tmp" || true
without_mail=$(cat "$tmp")
printf 'SMTP_HOST=%s\nSMTP_PORT=465\nSMTP_USER=%s\nSMTP_PASS=%s\nSMTP_FROM=%s\n' "$SMTP_HOST" "$SMTP_USER" "$SMTP_PASS" "$SMTP_USER" >> "$tmp"
unset SMTP_PASS

# Пробное письмо — тем же кодом, которым сервер шлёт коды людям, и с новыми настройками, ещё до записи
echo "Отправляю пробное письмо на $SMTP_USER…"
cd "$APP_DIR/server"
if sudo -u sozvon env $(grep -v '^#' "$tmp" | xargs) node --input-type=module -e "
  const { mailEnabled, sendCode } = await import('./src/mail.js');
  if (!mailEnabled) throw new Error('почта не включилась');
  await sendCode('register', process.env.SMTP_USER);
" 2>&1 | grep -E 'Письмо не отправлено|почта не включилась' ; [ "${PIPESTATUS[0]}" = 0 ]; then
  install -m 640 -o root -g sozvon "$tmp" "$ENV_FILE"
  systemctl restart sozvon
  echo "Готово: на $SMTP_USER пришло письмо «Код для регистрации в Созвоне». Настройки записаны, сервер перезапущен — регистрация по почте работает."
else
  printf '%s\n' "$without_mail" > "$tmp"
  install -m 640 -o root -g sozvon "$tmp" "$ENV_FILE"
  systemctl restart sozvon
  echo
  echo 'Письмо не ушло — почту на сервере пока выключил. Проверьте и запустите скрипт снова:'
  echo '  1) адрес — ваш настоящий ящик;'
  echo '  2) пароль — пароль приложения типа «Почта» (id.yandex.ru → Безопасность → Пароли приложений), не пароль от аккаунта;'
  echo '  3) в Яндекс Почте: Все настройки → Почтовые программы → включён IMAP и «Пароли приложений и OAuth-токены».'
  exit 1
fi
