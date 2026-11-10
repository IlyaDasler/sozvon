// Мобильная навигация без дублей ПК: колокольчик убран, на фолде —
// утилиты в рейле, белая полоска активного хаба не показывается.
const { api, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('util' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Мобильный' }, a.token);
  await api('POST', '/rooms', { hubId: hub.id, name: 'Общий чат', kind: 'text' }, a.token);
  const w = await openClient('util', a);
  w.show();
  w.focus();
  await sleep(700);

  await js(w, `setTheme('glass'); openHub(${hub.id}); refreshRooms(); true`);
  await sleep(500);

  // Телефон: уведомления — нижняя вкладка, верхнего колокольчика нет.
  w.setSize(390, 844);
  await sleep(400);
  const phone = JSON.parse(
    await js(w, `(() => {
      const css = (s) => getComputedStyle(document.querySelector(s)).display;
      return JSON.stringify({
        bell: css('#notif-btn'),
        settings: css('#settings-btn'),
        railUtility: css('#mobile-rail-utility'),
        bottom: css('#mobile-nav'),
      });
    })()`)
  );
  if (phone.bell !== 'none' || phone.settings !== 'none') throw new Error(`на телефоне остались верхние дубли: ${JSON.stringify(phone)}`);
  if (phone.railUtility !== 'none') throw new Error('утилиты рейла показаны на телефоне');
  if (phone.bottom === 'none') throw new Error('на телефоне пропала нижняя навигация');

  // Фолд: нижней панели нет, зато в рейле есть уведомления и настройки.
  w.setSize(673, 841);
  await sleep(500);
  const fold = JSON.parse(
    await js(w, `(() => {
      const css = (s) => getComputedStyle(document.querySelector(s)).display;
      const active = document.querySelector('#rail .rail-item.active');
      return JSON.stringify({
        bell: css('#notif-btn'),
        settings: css('#settings-btn'),
        railUtility: css('#mobile-rail-utility'),
        bottom: css('#mobile-nav'),
        whiteStrip: active ? getComputedStyle(active, '::before').display : null,
        roomTools: css('#room-list .room-tools'),
        utilityButtons: document.querySelectorAll('#mobile-rail-utility button').length,
      });
    })()`)
  );
  if (fold.bell !== 'none' || fold.settings !== 'none') throw new Error(`на фолде остались верхние дубли: ${JSON.stringify(fold)}`);
  if (fold.railUtility === 'none') throw new Error('на фолде нет утилит в рейле');
  if (fold.bottom !== 'none') throw new Error('на фолде показана нижняя панель телефона');
  if (fold.whiteStrip !== 'none') throw new Error(`белая полоска активного хаба осталась: ${JSON.stringify(fold)}`);
  if (fold.roomTools !== 'none') throw new Error('на фолде видны десктопные инструменты комнаты');
  if (fold.utilityButtons !== 2) throw new Error(`в рейле должно быть 2 утилиты, найдено ${fold.utilityButtons}`);

  await js(w, `document.querySelector('#mobile-rail-notifs').click(); true`);
  await waitFor(w, `document.body.classList.contains('mobile-notifications')`, 'уведомления с рейла');
  await sleep(300);
  const panel = await js(w, `(() => { const p=document.getElementById('notif-panel').getBoundingClientRect(); return JSON.stringify({top:p.top,left:p.left,width:p.width,height:p.height,close:Boolean(document.getElementById('notif-close'))}); })()`);
  const p = JSON.parse(panel);
  if (!p.close || p.top > 2 || p.left > 2) throw new Error(`уведомления на фолде не полноэкранные: ${panel}`);
  await js(w, `document.getElementById('notif-close').click(); true`);
  await waitFor(w, `!document.body.classList.contains('mobile-notifications')`, 'уведомления закрылись');

  await js(w, `document.querySelector('#mobile-rail-settings').click(); true`);
  await waitFor(w, `!document.getElementById('settings').classList.contains('hidden')`, 'настройки с рейла');
  await js(w, `document.getElementById('settings-close').click(); true`);

  // Заголовок хаба — статичный, действия открываются долгим нажатием иконки.
  const hubChrome = JSON.parse(await js(w, `(() => {
    const b=document.getElementById('hub-menu-btn');
    const chev=b.querySelector(':scope > svg');
    return JSON.stringify({pointer:getComputedStyle(b).pointerEvents, chevron:chev?getComputedStyle(chev).display:null});
  })()`));
  if (hubChrome.pointer !== 'none' || hubChrome.chevron !== 'none') throw new Error(`название хаба всё ещё выглядит селектом: ${JSON.stringify(hubChrome)}`);

  await js(w, `(() => {
    const tile=document.querySelector('#rail .rail-item[data-hub]');
    tile.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 2, clientX: 100, clientY: 240 }));
    return true;
  })()`);
  await waitFor(w, `!document.getElementById('popup-menu').classList.contains('hidden')`, 'меню хаба по долгому нажатию');
  const hubActions = await js(w, `document.querySelectorAll('#popup-menu button').length`);
  if (!hubActions) throw new Error('меню хаба пустое');
  await js(w, `document.getElementById('popup-menu').classList.add('hidden'); true`);

  // Долгое нажатие на комнату открывает мобильный лист действий,
  // а не оставляет десктопные иконки в каждой строке.
  await js(w, `openHub(${hub.id}); refreshRooms(); true`);
  await sleep(400);
  const roomRow = await js(w, `Boolean(document.querySelector('#room-list .room-row'))`);
  if (!roomRow) throw new Error('в списке нет комнаты для долгого нажатия');
  await js(w, `(() => {
    const row = document.querySelector('#room-list .room-row');
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 1, clientX: 120, clientY: 200 }));
    return true;
  })()`);
  await waitFor(w, `document.body.classList.contains('mobile-room-sheet')`, 'лист действий комнаты');
  const actions = await js(w, `document.querySelectorAll('#mobile-room-sheet button').length`);
  if (actions < 3) throw new Error(`в листе комнаты только ${actions} действий`);
  await js(w, `document.getElementById('mobile-room-backdrop').click(); true`);

  console.log('✔ мобильные утилиты без дублей ПК и белой полоски');
});
