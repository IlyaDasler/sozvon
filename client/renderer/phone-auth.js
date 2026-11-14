// Регистрация «телефон + пароль» с подтверждением через Telegram Contact Share.
// Никаких SMS: бот получает номер только после нажатия «Отправить номер».
(() => {
  const modal = document.getElementById('phone-signup');
  if (!modal) return;
  const byId = (id) => document.getElementById(id);
  const error = byId('phone-error');
  const submit = byId('phone-submit');
  const cancel = byId('phone-cancel');
  const pendingBox = byId('phone-pending');
  const statusLine = byId('phone-status');
  const deeplink = byId('phone-deeplink');
  let timer = null;
  let current = null;

  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    current = null;
    error.textContent = '';
    pendingBox.classList.add('hidden');
    submit.disabled = false;
    submit.classList.remove('hidden');
    for (const id of ['phone-input', 'phone-username', 'phone-display', 'phone-password', 'phone-invite']) {
      const field = byId(id);
      if (field) field.disabled = false;
    }
  };
  const close = () => {
    reset();
    byId('phone-password').value = '';
    modal.classList.add('hidden');
  };
  const fail = (message) => {
    console.error('Телефонная регистрация:', message);
    statusLine.textContent = 'Не удалось подтвердить номер. Попробуйте ещё раз.';
    submit.disabled = false;
    submit.classList.remove('hidden');
    error.textContent = message;
  };

  const poll = async () => {
    if (!current) return;
    try {
      const result = await Api.post('/phone/signup/status', { id: current.id, secret: current.secret });
      if (result.status === 'ready') {
        const password = current.password;
        reset();
        modal.classList.add('hidden');
        finishLogin(Api.base, result, password);
        return;
      }
      if (result.status === 'expired') return fail('Срок подтверждения истёк. Начните заново.');
      if (result.status === 'used') return fail('Эта регистрация уже завершена. Войдите по телефону и паролю.');
      statusLine.textContent = 'Ожидаем подтверждение в Telegram…';
      timer = setTimeout(poll, 2000);
    } catch (err) {
      fail(err.message || 'Сервер не ответил');
    }
  };

  byId('phone-open').onclick = () => {
    reset();
    byId('phone-invite-field').classList.toggle('hidden', !state.inviteRequired);
    modal.classList.remove('hidden');
    byId('phone-input').focus();
  };
  cancel.onclick = close;
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  submit.onclick = async () => {
    error.textContent = '';
    const phone = byId('phone-input').value.trim();
    const username = byId('phone-username').value.trim();
    const displayName = byId('phone-display').value.trim();
    const password = byId('phone-password').value;
    const inviteCode = byId('phone-invite').value.trim();
    if (!phone || !username || !displayName || !password) {
      error.textContent = 'Заполните телефон, логин, имя и пароль';
      return;
    }
    submit.disabled = true;
    try {
      const result = await Api.post('/phone/signup/start', {
        phone, username, displayName, password, inviteCode,
      });
      current = { ...result, password };
      pendingBox.classList.remove('hidden');
      deeplink.href = result.deepLink;
      statusLine.textContent = `Код подтверждения ждёт в Telegram @${result.botUsername}`;
      for (const id of ['phone-input', 'phone-username', 'phone-display', 'phone-password', 'phone-invite']) {
        const field = byId(id);
        if (field) field.disabled = true;
      }
      submit.classList.add('hidden');
      window.open(result.deepLink, '_blank', 'noopener');
      timer = setTimeout(poll, 1500);
    } catch (err) {
      submit.disabled = false;
      error.textContent = err.message || 'Не удалось начать регистрацию';
    }
  };
})();
