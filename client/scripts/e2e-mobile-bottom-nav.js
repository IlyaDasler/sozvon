// Нижнее меню как в Telegram: видно во всех разделах и не исчезает при переключении.
const { register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

const state = (w) => js(w, `(() => {
  const nav = document.getElementById('mobile-nav');
  const settings = document.getElementById('settings');
  const card = settings.querySelector('.set-card');
  const nr = nav.getBoundingClientRect();
  const cr = card ? card.getBoundingClientRect() : null;
  return JSON.stringify({
    navDisplay: getComputedStyle(nav).display,
    navTop: Math.round(nr.top),
    navH: Math.round(nr.height),
    active: nav.querySelector('button.active')?.dataset.mobile || '',
    settingsHidden: settings.classList.contains('hidden'),
    cardBottom: cr ? Math.round(cr.bottom) : null,
  });
})()`);

runTest(async () => {
  const a = await register('nv' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('nv', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  // Настройки: меню остаётся, карточка заканчивается над ним.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await waitFor(w, `!document.getElementById('settings').classList.contains('hidden')`, 'настройки открылись', 4000);
  await sleep(400);
  let s = JSON.parse(await state(w));
  console.log('settings', JSON.stringify(s));
  if (s.navDisplay === 'none') throw new Error('нижнее меню исчезло в настройках');
  if (s.active !== 'settings') throw new Error('вкладка «Настройки» не активна');
  if (s.cardBottom > s.navTop + 1) throw new Error('карточка настроек заходит под нижнее меню: ' + JSON.stringify(s));

  // Переключение на «Друзья» закрывает настройки, меню остаётся.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="home"]').click(); true`);
  await sleep(400);
  s = JSON.parse(await state(w));
  console.log('home', JSON.stringify(s));
  if (!s.settingsHidden) throw new Error('настройки не закрылись при переходе на «Друзья»');
  if (s.active !== 'home') throw new Error('вкладка «Друзья» не активна');
  if (s.navDisplay === 'none') throw new Error('нижнее меню исчезло после перехода');

  // Каналы.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(400);
  s = JSON.parse(await state(w));
  console.log('channels', JSON.stringify(s));
  if (s.active !== 'channels' || s.navDisplay === 'none') throw new Error('каналы: меню/вкладка сломались: ' + JSON.stringify(s));

  // Уведомления.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(400);
  s = JSON.parse(await state(w));
  console.log('notifications', JSON.stringify(s));
  if (s.navDisplay === 'none') throw new Error('нижнее меню исчезло в уведомлениях');

  // Настройки снова.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(400);
  s = JSON.parse(await state(w));
  console.log('settings-again', JSON.stringify(s));
  if (s.navDisplay === 'none' || s.settingsHidden || s.active !== 'settings') throw new Error('повторный вход в настройки: меню/вкладка сломались');
});
