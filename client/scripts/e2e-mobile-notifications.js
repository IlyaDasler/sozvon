// Мобильные уведомления: личное сообщение должно попасть в центр уведомлений
// и в бейдж нижнего меню, а не только в скрытый бейдж рейла.
const { api, befriend, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('nt' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('ntb' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const w = await openClient('nt', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  await api('POST', `/messages/${a.user.id}`, { text: 'привет из мобильного теста' }, b.token);
  await waitFor(w, `loadNotifs().some((n) => n.kind === 'message' && n.body.includes('привет из мобильного теста'))`, 'сообщение в уведомлениях', 8000);

  const st = JSON.parse(await js(w, `(() => {
    const badge = document.getElementById('notif-badge');
    const mobile = document.querySelector('#mobile-nav .mobile-badge');
    return JSON.stringify({
      bell: bellNotifs().map((n) => n.kind),
      badgeHidden: badge.classList.contains('hidden'),
      badgeText: badge.textContent,
      mobileHidden: mobile ? mobile.classList.contains('hidden') : null,
      mobileText: mobile ? mobile.textContent : null,
    });
  })()`));
  console.log('notif-state', JSON.stringify(st));
  if (!st.bell.includes('message')) throw new Error('личное сообщение не попало в bellNotifs: ' + JSON.stringify(st.bell));
  if (st.badgeHidden || !st.badgeText) throw new Error('бейдж уведомлений не показан');
  if (st.mobileHidden || !st.mobileText) throw new Error('бейдж нижнего меню не показан');

  // Открытый тред не должен оставаться поверх чата, открытого из уведомления.
  await js(w, `openThread({ id: 999, roomId: 1, threadRoot: 999 }, { roomId: 1 }); true`);
  await sleep(150);
  if (await js(w, `document.getElementById('thread-panel').classList.contains('hidden')`)) throw new Error('тред не открылся для проверки');
  await js(w, `openNotifTarget({ contact: ${b.user.id} }); true`);
  await sleep(200);
  if (!(await js(w, `document.getElementById('thread-panel').classList.contains('hidden')`))) throw new Error('при переходе по уведомлению остался открытый тред');
  console.log('ok notification closes thread');

  // Вкладка «Уведомления» показывает сообщение и ведёт в чат.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(500);
  if (await js(w, `document.getElementById('notif-panel').classList.contains('hidden')`)) throw new Error('центр уведомлений не открылся');
  const hasText = await js(w, `document.getElementById('notif-panel').textContent.includes('привет из мобильного теста')`);
  if (!hasText) throw new Error('сообщения нет в списке уведомлений');
  await js(w, `document.querySelector('#notif-list .notif-item')?.click(); true`);
  await sleep(600);
  if (await js(w, `state.selectedId !== ${b.user.id}`)) throw new Error('уведомление не открыло чат с автором');
  console.log('ok message notification + open chat');
});
