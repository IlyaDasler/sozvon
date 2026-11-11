// Переходы нижнего меню: шторка, отсутствие остатков старого экрана, очередь быстрых тапов.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('ttr' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Переходы' }, a.token);
  await api('POST', '/rooms', { name: 'чат', kind: 'text', hubId: hub.id }, a.token);
  const w = await openClient('ttr', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  const state = () => js(w, `(() => {
    const fade = document.getElementById('mobile-tab-fade');
    return JSON.stringify({
      active: document.querySelector('#mobile-nav button.active')?.dataset.mobile || '',
      fade: fade ? Number(getComputedStyle(fade).opacity) : -1,
      fading: fade?.classList.contains('on') || false,
      body: document.body.className,
      settings: !document.getElementById('settings').classList.contains('hidden'),
      notifications: !document.getElementById('notif-panel').classList.contains('hidden'),
      list: document.body.classList.contains('mobile-list'),
      hubs: document.querySelectorAll('#mobile-hubs .mobile-hub-card').length,
    });
  })()`);

  // Друзья → Каналы: шторка появляется сразу, активная вкладка сразу меняется.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(30);
  let d = JSON.parse(await state());
  const anim = await js(w, `(() => { const e = document.getElementById('mobile-hubs'); const c = getComputedStyle(e); return JSON.stringify({ name: c.animationName, dur: c.animationDuration, transform: c.transform, cls: document.body.className }); })()`);
  console.log('switch-early', JSON.stringify(d), anim);
  if (d.active !== 'channels') throw new Error('активная вкладка не переключилась сразу');
  if (await js(w, `getComputedStyle(document.getElementById('empty-state')).display !== 'none'`)) {
    throw new Error('экран друзей остался видимым при переходе в каналы');
  }
  if (!d.list) throw new Error('каналы не открылись сразу');
  await sleep(350);
  d = JSON.parse(await state());
  console.log('channels-final', JSON.stringify(d));
  if (!d.list || !d.hubs) throw new Error('каналы не открылись');

  // Каналы → Уведомления.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(500);
  d = JSON.parse(await state());
  console.log('notifications', JSON.stringify(d));
  if (d.active !== 'notifications' || !d.notifications) throw new Error('уведомления не открылись');
  if (d.body.includes('mobile-channels')) throw new Error('каналы остались под уведомлениями: ' + d.body);

  // Уведомления → Настройки.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(600);
  d = JSON.parse(await state());
  console.log('settings', JSON.stringify(d));
  if (d.active !== 'settings' || !d.settings) throw new Error('настройки не открылись');
  if (d.notifications) throw new Error('уведомления остались поверх настроек');

  // Настройки → Друзья: старые классы канала/комнаты не должны остаться.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="home"]').click(); true`);
  await sleep(600);
  d = JSON.parse(await state());
  console.log('home', JSON.stringify(d));
  if (d.active !== 'home' || d.settings) throw new Error('возврат на друзей не очистил настройки');
  if (d.list || d.body.includes('mobile-hub-open') || d.body.includes('mobile-room-open')) throw new Error('остались классы старого раздела: ' + d.body);

  // Быстрые тапы: последняя цель должна победить без наложений.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(900);
  d = JSON.parse(await state());
  console.log('rapid', JSON.stringify(d));
  if (d.active !== 'settings' || !d.settings) throw new Error('быстрый переход не дошёл до настроек');
  if (d.list) throw new Error('после быстрого перехода остался старый слой');
});
