// Реальный вход в голосовую комнату из карточки канала и выход.
const { api, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('vl' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Голос' }, a.token);
  const voice = await api('POST', '/rooms', { name: 'Разговорная', kind: 'voice', hubId: hub.id }, a.token);
  const w = await openClient('vl', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(600);

  await js(w, `(() => {
    const r = [...document.querySelectorAll('#mobile-hubs .mobile-hub-room')].find((x) => Number(x.dataset.room) === ${voice.id});
    r.querySelector('.mobile-hub-room__name').click();
    return true;
  })()`);
  await waitFor(w, `state.room?.roomId === ${voice.id}`, 'вход в голосовую', 10000);
  const d = JSON.parse(await js(w, `JSON.stringify({
    panel: getComputedStyle(document.getElementById('voice-panel')).display,
    leave: Boolean(document.getElementById('voice-leave')),
    nav: getComputedStyle(document.getElementById('mobile-nav')).display,
    body: document.body.className,
  })`));
  console.log('voice-live', JSON.stringify(d));
  if (d.panel === 'none') throw new Error('панель голоса не появилась');
  if (!d.leave) throw new Error('нет кнопки выхода из голоса');
  if (d.nav === 'none') throw new Error('нижнее меню пропало в голосе');

  await js(w, `document.getElementById('voice-leave').click(); true`);
  await waitFor(w, `!state.room`, 'выход из голоса', 8000);
  await sleep(400);
  const after = await js(w, `document.getElementById('voice-panel').classList.contains('hidden')`);
  console.log('voice-left', after);
  if (!after) throw new Error('панель голоса осталась после выхода');
});
