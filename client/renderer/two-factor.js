// Настройки → Аккаунт → «Двухфакторный вход»: шаги включения (пароль, QR-код, код из приложения, резервные коды) и отключение.

const TWO_FACTOR_STEPS = ['tf-password-step', 'tf-scan-step', 'tf-codes-step', 'tf-off-step'];

function showTwoFactorStep(step) {
  for (const id of TWO_FACTOR_STEPS) $(id).classList.toggle('hidden', id !== step);
  $('tf-error').textContent = '';
}

function renderTwoFactor() {
  const on = state.me.twoFactor;
  $('tf-state').textContent = on
    ? 'Включён: при входе по паролю нужен код из приложения-аутентификатора. Вход через Яндекс защищён самим Яндексом.'
    : 'При входе по паролю Созвон спросит ещё и код из приложения-аутентификатора. Подойдёт Google Authenticator, Яндекс Ключ и другие.';
  $('tf-start').classList.toggle('hidden', on);
  $('tf-stop').classList.toggle('hidden', !on);
  showTwoFactorStep(null);
}

/** Шаг выполняет запрос к серверу; ошибка показывается рядом с полем */
const twoFactorAction = (run) => async () => {
  $('tf-error').textContent = '';
  try {
    await run();
  } catch (err) {
    $('tf-error').textContent = err.message;
  }
};

$('tf-start').onclick = () => {
  $('tf-password').value = '';
  $('tf-password-row').classList.toggle('hidden', !state.me.hasPassword);
  showTwoFactorStep('tf-password-step');
};

$('tf-next').onclick = twoFactorAction(async () => {
  const { secret, uri } = await Api.post('/me/2fa/setup', { password: $('tf-password').value });
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  $('tf-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
  $('tf-secret').textContent = secret;
  $('tf-code').value = '';
  showTwoFactorStep('tf-scan-step');
  $('tf-code').focus();
});

$('tf-confirm').onclick = twoFactorAction(async () => {
  const { recoveryCodes, user } = await Api.post('/me/2fa/enable', { code: $('tf-code').value.trim() });
  state.me = user;
  $('tf-recovery').textContent = recoveryCodes.join('\n');
  renderDevices();
  $('tf-start').classList.add('hidden');
  $('tf-stop').classList.remove('hidden');
  showTwoFactorStep('tf-codes-step');
});

$('tf-copy').onclick = () => copyText($('tf-recovery').textContent);
$('tf-done').onclick = renderTwoFactor;

$('tf-stop').onclick = () => {
  $('tf-off-code').value = '';
  showTwoFactorStep('tf-off-step');
  $('tf-off-code').focus();
};

$('tf-off').onclick = twoFactorAction(async () => {
  state.me = await Api.post('/me/2fa/disable', { code: $('tf-off-code').value.trim() });
  renderTwoFactor();
  toast('Двухфакторный вход отключён');
});
