#!/usr/bin/env bash
# Почтовый ящик для писем с кодами (регистрация по почте, сброс пароля, привязка почты).
# Спрашивает адрес и пароль приложения, записывает их в /etc/sozvon.env, перезапускает сервер
# и отправляет на этот же ящик пробное письмо с кодом. Пароль вводится только здесь и не показывается.
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
printf 'SMTP_HOST=%s\nSMTP_PORT=465\nSMTP_USER=%s\nSMTP_PASS=%s\nSMTP_FROM=%s\n' "$SMTP_HOST" "$SMTP_USER" "$SMTP_PASS" "$SMTP_USER" >> "$tmp"
install -m 640 -o root -g sozvon "$tmp" "$ENV_FILE"
unset SMTP_PASS
echo 'Записал в настройки сервера.'

systemctl restart sozvon
echo 'Сервер перезапущен.'

# Пробное письмо — тем же кодом, которым сервер шлёт коды людям
echo "Отправляю пробное письмо на $SMTP_USER…"
cd "$APP_DIR/server"
if sudo -u sozvon env $(grep -v '^#' "$ENV_FILE" | xargs) node --input-type=module -e "
  const { mailEnabled, sendCode } = await import('./src/mail.js');
  if (!mailEnabled) throw new Error('почта не включилась');
  await sendCode('register', process.env.SMTP_USER);
" ; then
  echo "Готово: на $SMTP_USER пришло письмо «Код для регистрации в Созвоне». Регистрация по почте работает."
else
  echo 'Письмо не ушло. Проверьте адрес и пароль приложения (и что в почте включён доступ почтовым программам) и запустите снова.'
  exit 1
fi
