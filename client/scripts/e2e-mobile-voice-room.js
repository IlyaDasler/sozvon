// Голосовая комната: имя = вход в голос, кнопка чата = чат без голоса.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('vr' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Голос' }, a.token);
  const voice = await api('POST', '/rooms', { name: 'Разговорная', kind: 'voice', hubId: hub.id }, a.token);
  const w = await openClient('vr', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(700);

  const row = await js(w, `(() => {
    const r = [...document.querySelectorAll('#mobile-hubs .mobile-hub-room')].find((x) => x.dataset.kind === 'voice');
    return r ? Number(r.dataset.room) : 0;
  })()`);
  console.log('voice-row', row);
  if (!row) throw new Error('нет голосовой комнаты в карточке');

  // Имя голосовой комнаты должно звать joinRoomVoice.
  await js(w, `window.__joined = null; window.joinRoomVoice = (id) => { window.__joined = id; }; true`);
  await js(w, `[...document.querySelectorAll('#mobile-hubs .mobile-hub-room')].find((x) => Number(x.dataset.room) === ${row}).querySelector('.mobile-hub-room__name').click(); true`);
  await sleep(500);
  const joined = await js(w, `window.__joined`);
  console.log('joined', joined);
  if (joined !== row) throw new Error('нажатие на голосовую не входит в голос: ' + joined);

  // Кнопка чата открывает чат без голоса, звонок не стартует.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500);
  await js(w, `[...document.querySelectorAll('#mobile-hubs .mobile-hub-room')].find((x) => Number(x.dataset.room) === ${row}).querySelector('.mobile-hub-room__action').click(); true`);
  await sleep(600);
  if (await js(w, `Boolean(state.room)`)) throw new Error('кнопка чата запустила голосовой звонок');
  if (!(await js(w, `state.selectedRoomId === ${row}`))) throw new Error('кнопка чата не открыла чат комнаты');
});
