// Каналы сразу с комнатами: карточка канала, чат и настройки комнаты без входа в голос.
const { api, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('cc' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Discord-канал' }, a.token);
  const text = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const voice = await api('POST', '/rooms', { name: 'Голосовая', kind: 'voice', hubId: hub.id }, a.token);

  const w = await openClient('cc', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(700);

  const d = JSON.parse(await js(w, `(() => {
    const card = document.querySelector('#mobile-hubs .mobile-hub-card');
    const rows = [...document.querySelectorAll('#mobile-hubs .mobile-hub-room')];
    return JSON.stringify({
      cards: document.querySelectorAll('#mobile-hubs .mobile-hub-card').length,
      rows: rows.length,
      names: rows.map((r) => r.querySelector('.mobile-hub-room__name')?.textContent.trim()),
      actions: rows.map((r) => r.querySelectorAll('.mobile-hub-room__action').length),
      cardH: card ? Math.round(card.getBoundingClientRect().height) : 0,
      gear: Boolean(document.querySelector('#mobile-hubs .mobile-hub-card__settings')),
    });
  })()`));
  console.log('channel-cards', JSON.stringify(d));
  if (d.cards < 1 || d.rows < 2) throw new Error('канал не показывает комнаты: ' + JSON.stringify(d));
  if (!d.names.some((n) => n.includes('общий')) || !d.names.some((n) => n.includes('Голосовая'))) throw new Error('нет комнат в карточке: ' + JSON.stringify(d.names));
  if (!d.actions.every((n) => n === 2)) throw new Error('у комнат нет чата/настроек: ' + JSON.stringify(d.actions));
  if (!d.gear) throw new Error('нет шестерёнки канала');

  // Настройки канала из карточки.
  await js(w, `document.querySelector('#mobile-hubs .mobile-hub-card__settings').click(); true`);
  await sleep(400);
  if (await js(w, `document.getElementById('hub-settings').classList.contains('hidden')`)) throw new Error('шестерёнка не открыла настройки канала');
  await js(w, `closeHubSettings(); true`);
  await sleep(200);

  // Чат голосовой комнаты без входа в голос.
  const voiceRow = await js(w, `(() => { const r = [...document.querySelectorAll('#mobile-hubs .mobile-hub-room')].find((x) => x.textContent.includes('Голосовая')); if (!r) return 0; r.querySelector('.mobile-hub-room__action').click(); return Number(r.dataset.room); })()`);
  await sleep(600);
  if (await js(w, `state.selectedRoomId !== ${voiceRow}`)) throw new Error('чат голосовой не открылся: ' + voiceRow);
  if (await js(w, `Boolean(state.room)`)) throw new Error('открылся голосовой звонок вместо чата');

  // Настройки комнаты из карточки.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500);
  await js(w, `[...document.querySelectorAll('#mobile-hubs .mobile-hub-room')].find((r) => r.textContent.includes('общий')).querySelectorAll('.mobile-hub-room__action')[1].click(); true`);
  await sleep(400);
  if (await js(w, `document.getElementById('room-manage').classList.contains('hidden')`)) throw new Error('не открылись настройки комнаты');
});
