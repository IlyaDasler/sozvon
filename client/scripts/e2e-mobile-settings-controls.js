// Живые контролы настроек: темы, уведомления, приватность, 2FA-шаг.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('sc' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('sc', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500);

  // Оформление: выбор темы реально применяется.
  await js(w, `document.querySelector('#set-nav > button[data-tab="look"]').click(); true`);
  await sleep(450);
  const theme = await js(w, `(() => {
    const current = document.documentElement.dataset.themeId || document.documentElement.dataset.theme;
    const card = [...document.querySelectorAll('#theme-grid .theme-card')].find((c) => c.dataset.pick !== current);
    if (!card) return '';
    const id = card.dataset.pick;
    card.click();
    return id;
  })()`);
  await sleep(500);
  const activeTheme = await js(w, `document.documentElement.dataset.themeId || document.documentElement.dataset.theme`);
  console.log('theme', theme, activeTheme);
  if (!theme || activeTheme !== theme) throw new Error('тема не применилась: ' + theme + ' → ' + activeTheme);
  await js(w, `document.getElementById('mobile-settings-back').click(); true`);
  await sleep(300);

  // Уведомления: переключатель сохраняется.
  await js(w, `document.querySelector('#set-nav > button[data-tab="notify"]').click(); true`);
  await sleep(400);
  const beforeNotify = await js(w, `store.get('notify', {}).preview !== false`);
  await js(w, `document.getElementById('set-notify-preview').click(); true`);
  await sleep(300);
  const afterNotify = await js(w, `store.get('notify', {}).preview !== false`);
  console.log('notify', beforeNotify, afterNotify);
  if (beforeNotify === afterNotify) throw new Error('переключатель превью не сработал');
  await js(w, `document.getElementById('mobile-settings-back').click(); true`);
  await sleep(300);

  // Приватность: переключатель уходит на сервер.
  await js(w, `document.querySelector('#set-nav > button[data-tab="privacy"]').click(); true`);
  await sleep(400);
  const beforeTyping = await js(w, `state.me.privacy?.typing !== false`);
  await js(w, `document.querySelector('[data-privacy-toggle="typing"]').click(); true`);
  await sleep(700);
  const afterTyping = await js(w, `state.me.privacy?.typing !== false`);
  console.log('privacy', beforeTyping, afterTyping);
  if (beforeTyping === afterTyping) throw new Error('приватность «печатает» не сохранилась');

  // Back внутри подвкладки возвращает на «Данные», второй back — в корень.
  await js(w, `showPrivacyPage('crypto'); true`);
  await sleep(250);
  await js(w, `window.sozvonBack(); true`);
  await sleep(300);
  const layer = JSON.parse(await js(w, `JSON.stringify({ page: window.privacyPage, section: document.body.classList.contains('mobile-settings-section') })`));
  console.log('privacy-back', JSON.stringify(layer));
  if (layer.page !== 'data' || !layer.section) throw new Error('back не вернул на первую подвкладку приватности');
  await js(w, `window.sozvonBack(); true`);
  await sleep(300);
  if (await js(w, `document.body.classList.contains('mobile-settings-section')`)) throw new Error('второй back не вышел в корень настроек');

  // Аккаунт: кнопка 2FA открывает шаг с паролем, back его закрывает.
  await js(w, `document.querySelector('#set-nav > button[data-tab="account"]').click(); true`);
  await sleep(400);
  const hasTf = await js(w, `Boolean(document.getElementById('tf-start'))`);
  if (hasTf) {
    await js(w, `document.getElementById('tf-start').click(); true`);
    await sleep(400);
    const opened = await js(w, `!document.getElementById('tf-password-step').classList.contains('hidden')`);
    console.log('tf-open', opened);
    if (!opened) throw new Error('2FA не открыла шаг с паролем');
    await js(w, `document.getElementById('mobile-settings-back').click(); true`);
    await sleep(300);
    const closed = await js(w, `document.getElementById('tf-password-step').classList.contains('hidden')`);
    if (!closed) throw new Error('2FA-шаг не закрылся');
  }
});
