// Мобильная оболочка: телефон, фолд и список каналов.
const { api, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('mob' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Мобильный' }, a.token);
  const room = await api('POST', '/rooms', { hubId: hub.id, name: 'Общий чат', kind: 'text' }, a.token);
  const w = await openClient('mob', a);
  w.setSize(390, 844);
  w.show();
  w.focus();
  w.webContents.setBackgroundThrottling(false);
  await sleep(700);

  if (!(await js(w, `getComputedStyle(document.getElementById('mobile-nav')).display !== 'none'`))) {
    throw new Error('мобильная навигация скрыта на телефоне');
  }

  if (await js(w, `getComputedStyle(document.getElementById('nav-back')).display !== 'none'`)) {
    throw new Error('верхняя кнопка «назад» осталась на телефоне');
  }

  // Отдельный экран уведомлений, без колокольчика
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await waitFor(w, `document.body.classList.contains('mobile-notifications')`, 'экран уведомлений');
  await sleep(260);
  const notifs = await js(w, `(() => { const p=document.getElementById('notif-panel').getBoundingClientRect(); return JSON.stringify({top:p.top,left:p.left,width:p.width,viewport:innerWidth,bell:getComputedStyle(document.getElementById('notif-btn')).display}); })()`);
  const nn = JSON.parse(notifs);
  if (nn.top > 2 || nn.left > 2 || nn.width < nn.viewport - 2 || nn.bell !== 'none') {
    throw new Error(`уведомления не на весь экран: ${notifs}`);
  }
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await waitFor(w, `!document.body.classList.contains('mobile-notifications')`, 'экран уведомлений закрылся');

  // Жест от левого края открывает каналы, обратный свайп закрывает
  const swipe = (x1, x2, y) => js(w, `(() => {
    const t1 = new Touch({ identifier: 1, target: document.body, clientX: ${x1}, clientY: ${y} });
    const t2 = new Touch({ identifier: 1, target: document.body, clientX: ${x2}, clientY: ${y} });
    document.body.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], changedTouches: [t1], bubbles: true }));
    document.body.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t2], bubbles: true }));
    return true;
  })()`);
  await swipe(8, 170, 500);
  await waitFor(w, `document.body.classList.contains('mobile-list')`, 'свайп от левого края открыл каналы');
  await swipe(360, 180, 500);
  await waitFor(w, `!document.body.classList.contains('mobile-list')`, 'свайп влево закрыл каналы');
  await swipe(382, 250, 500);
  await waitFor(w, `document.body.classList.contains('mobile-notifications')`, 'свайп от правого края открыл события');
  await js(w, `document.querySelector('#mobile-nav [data-mobile="home"]').click(); true`);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await waitFor(w, `document.body.classList.contains('mobile-list')`, 'список каналов открылся');
  if (!(await js(w, `getComputedStyle(document.querySelector('.sidebar')).display !== 'none'`))) {
    throw new Error('сайдбар не показался поверх чата');
  }

  await js(w, `openHub(${hub.id}); refreshRooms().then(() => new Promise(r => setTimeout(r, 200))); true`);
  await sleep(400);
  await js(w, `document.querySelector('#room-list .room-row').click(); true`);
  await waitFor(w, `!document.body.classList.contains('mobile-list')`, 'список закрылся после выбора комнаты');

  const channel = JSON.parse(await js(w, `(() => {
    const av = document.getElementById('room-hub-avatar');
    const r = av?.getBoundingClientRect();
    return JSON.stringify({
      display: av ? getComputedStyle(av).display : 'none',
      w: r?.width || 0,
      h: r?.height || 0,
      focused: document.activeElement?.id || '',
      hasBack: [...document.querySelectorAll('.mobile-chat-back')].some(b=>b.getClientRects().length),
    });
  })()`));
  if (channel.display === 'none' || channel.w < 20 || channel.h < 20) throw new Error(`аватар канала пропал: ${JSON.stringify(channel)}`);
  if (channel.focused === 'room-message-input') throw new Error('клавиатура открылась сама при входе в комнату');

  const back = channel.hasBack;
  if (!back) throw new Error('в комнате нет кнопки «назад» на телефоне');

  await js(w, `document.querySelector('.mobile-chat-back')?.click(); true`);
  await waitFor(w, `document.body.classList.contains('mobile-list')`, 'кнопка «назад» открыла список');

  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await waitFor(w, `!document.getElementById('settings').classList.contains('hidden')`, 'настройки на телефоне');
  const modal = await js(w, `(() => { const r=document.querySelector('#settings .set-card').getBoundingClientRect(); return JSON.stringify({left:r.left,right:r.right,width:innerWidth,view:innerHeight}); })()`);
  const md = JSON.parse(modal);
  if (md.left < -1 || md.right > md.width + 1) throw new Error(`настройки шире телефона: ${modal}`);
  await js(w, `document.getElementById('settings-close').click(); true`);
  await sleep(250);

  // Складываем фолд: на широкой внутренней панели должна быть двухколоночная раскладка
  w.setSize(673, 841);
  await sleep(500);
  const fold = await js(w, `JSON.stringify({nav:getComputedStyle(document.getElementById('mobile-nav')).display, sidebar:getComputedStyle(document.querySelector('.sidebar')).display, rail:getComputedStyle(document.getElementById('rail')).display})`);
  const f = JSON.parse(fold);
  if (f.nav !== 'none' || f.sidebar === 'none') throw new Error(`фолд не перешёл в две колонки: ${fold}`);
  if (f.rail === 'none') throw new Error(`на раскрытом фолде нет рабочего рейла: ${fold}`);

  // Экран входа на телефоне не должен разъезжаться
  const auth = await openClient('mob-auth', null, undefined, { waitReady: false });
  auth.setSize(390, 844);
  await sleep(400);
  const authBox = await js(auth, `(() => { const c=document.querySelector('.auth-card').getBoundingClientRect(); return JSON.stringify({left:c.left,right:c.right,width:c.width,viewport:innerWidth,overflow:document.documentElement.scrollWidth > innerWidth}); })()`);
  const ab = JSON.parse(authBox);
  if (ab.left < 0 || ab.right > ab.viewport + 1 || ab.overflow) throw new Error(`экран входа шире телефона: ${authBox}`);
  console.log('✔ телефон: навигация, список, назад, фолд и вход адаптированы');
});
