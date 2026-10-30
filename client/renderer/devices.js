// Настройки → Аккаунт → «Устройства»: где выполнен вход, отключить чужое или забытое устройство, выйти везде.

const seenAgo = (time) => (Date.now() - time < 10 * 60_000 ? 'сейчас в сети' : `был в сети ${formatDay(time).toLowerCase()}, ${formatTime(time)}`);

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
  name.textContent = session.current ? `${session.device} — это устройство` : session.device;
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
  $('device-list').replaceChildren(...list.map(deviceRow));
  $('devices-revoke').classList.toggle('hidden', !list.some((s) => !s.current));
}

$('devices-revoke').onclick = async () => {
  if (!(await ask('На всех остальных устройствах придётся войти заново.', { title: 'Выйти на других устройствах?', ok: 'Выйти', danger: true }))) return;
  try {
    rememberToken((await Api.post('/sessions/revoke-others')).token);
    renderDevices();
  } catch (err) {
    toast(err.message);
  }
};
