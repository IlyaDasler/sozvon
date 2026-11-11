// Переход «Настройки → Уведомления» не должен оставлять модалку настроек сверху.
const { register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('sn' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('sn', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await waitFor(w, `!document.getElementById('settings').classList.contains('hidden')`, 'настройки', 4000);
  await sleep(300);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(500);
  const d = JSON.parse(await js(w, `JSON.stringify({
    settingsHidden: document.getElementById('settings').classList.contains('hidden'),
    notifHidden: document.getElementById('notif-panel').classList.contains('hidden'),
    body: document.body.className,
    active: document.querySelector('#mobile-nav button.active')?.dataset.mobile || '',
  })`));
  console.log('settings-notifs', JSON.stringify(d));
  if (!d.settingsHidden) throw new Error('меню настроек осталось на экране уведомлений');
  if (d.notifHidden) throw new Error('уведомления не открылись');
  if (d.body.includes('mobile-settings')) throw new Error('body всё ещё mobile-settings');
  if (d.active !== 'notifications') throw new Error('вкладка уведомлений не активна: ' + d.active);

  // Обратно в настройки — уведомления закрываются.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500);
  const back = JSON.parse(await js(w, `JSON.stringify({
    settingsHidden: document.getElementById('settings').classList.contains('hidden'),
    notifHidden: document.getElementById('notif-panel').classList.contains('hidden'),
    body: document.body.className,
  })`));
  console.log('notifs-settings', JSON.stringify(back));
  if (back.settingsHidden) throw new Error('настройки не открылись из уведомлений');
  if (!back.notifHidden) throw new Error('уведомления остались поверх настроек');

  // И из настроек в каналы.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500);
  if (!(await js(w, `document.getElementById('settings').classList.contains('hidden')`))) throw new Error('настройки остались поверх каналов');
});
