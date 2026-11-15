// Настройки → Аккаунт → «Устройства»: где выполнен вход, отключить чужое или забытое устройство, выйти везде.

const seenAgo = (time) => (Date.now() - time < 10 * 60_000 ? 'сейчас в сети' : `был в сети ${formatDay(time).toLowerCase()}, ${formatTime(time)}`);
const REVOKE_OTHERS_MIN_AGE = 24 * 60 * 60_000;
const REVOKE_OTHERS_TOO_EARLY = 'Нельзя завершить другие сессии в течение 24 часов после входа на этом устройстве. Попробуйте позже.';
let revokeOthersAllowedAt = 0;

/** Сервер выдал новый токен (вместо токена версии до сессий) */
function rememberToken(token) {
  if (!token) return;
  Api.token = token;
  store.set('session', { ...store.get('session', {}), token });
}

function deviceRow(session) {
  const row = document.createElement('div');
  row.className = 'identity-row';
  const info = document.createElement('div');
  const name = document.createElement('div');
  // Текущее устройство всегда подписано установленной версией, даже если
  // сессия была создана старой версией и сервер ещё не обновил запись.
  let label = session.device;
  const version = Api.clientVersion || window.sozvonAppVersion || window.desktop?.version || '';
  if (session.current && version) {
    const ua = navigator.userAgent;
    const native = window.Capacitor?.isNativePlatform?.() === true;
    const platform = native ? window.Capacitor.getPlatform?.() : '';
    const os = platform === 'android' ? 'Android'
      : platform === 'ios' ? 'iOS'
      : /Windows/.test(ua) ? 'Windows'
      : /Mac OS/.test(ua) ? 'macOS'
      : /Linux/.test(ua) ? 'Linux' : '';
    label = `Созвон ${version}${os ? ` · ${os}` : ''}`;
  }
  name.textContent = session.current ? `${label} — это устройство` : label;
  const sub = document.createElement('div');
  sub.className = 'muted small ellipsis';
  sub.textContent = session.current ? `вход ${formatDay(session.createdAt).toLowerCase()}` : seenAgo(session.lastSeen);
  info.append(name, sub);
  row.append(info);
  if (!session.current) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn danger-outline';
    button.textContent = 'Отключить';
    button.onclick = async () => {
      if (!(await ask(`Отключить «${session.device}»? Там придётся войти заново.`, { title: 'Отключить устройство?', ok: 'Отключить', danger: true }))) return;
      await Api.del(`/sessions/${session.id}`).catch((err) => toast(err.message));
      renderDevices();
    };
    row.append(button);
  }
  return row;
}

async function renderDevices() {
  const list = await Api.get('/sessions').catch(() => []);
  const current = list.find((session) => session.current);
  const createdAt = Number(current?.createdAt);
  // Mirror Telegram's fresh-login restriction in the UI as well as on the
  // server. The backend remains authoritative if this legacy field is absent.
  revokeOthersAllowedAt = Number.isFinite(createdAt) && createdAt > 0
    ? createdAt + REVOKE_OTHERS_MIN_AGE
    : 0;
  $('device-list').replaceChildren(...list.map(deviceRow));
  $('devices-revoke').classList.toggle('hidden', !list.some((s) => !s.current));
}

$('devices-revoke').onclick = async () => {
  if (revokeOthersAllowedAt && Date.now() < revokeOthersAllowedAt) {
    toast(REVOKE_OTHERS_TOO_EARLY);
    return;
  }
  if (!(await ask('На всех остальных устройствах придётся войти заново.', { title: 'Выйти на других устройствах?', ok: 'Выйти', danger: true }))) return;
  try {
    rememberToken((await Api.post('/sessions/revoke-others')).token);
    renderDevices();
  } catch (err) {
    toast(err.message);
  }
};
