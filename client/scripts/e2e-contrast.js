// Читаемость темы «Стекло» на светлых фазах: подписи не должны сливаться с фоном.
const fs = require('node:fs');
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('ctr' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Контраст' }, a.token);
  const room = await api('POST', '/rooms', { hubId: hub.id, name: 'Перепись населения', kind: 'text' }, a.token);
  const w = await openClient('ctr', a);
  await sleep(1200);
  await js(w, `document.documentElement.dataset.theme='glass'; applyGlass(); openHub(${hub.id}); refreshRooms().then(()=>openRoom(${room.id})); sozvonDaypart.show('day'); true`);
  await sleep(900);
  await js(w, `(() => { const a=document.getElementById('room-message-input'); a.value='Проверка читаемости'; a.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('room-message-form').requestSubmit(); return true; })()`);
  await sleep(1200);
  await js(w, `(async () => { const m=[...state.roomHistory.get(${room.id})].at(-1); await toggleReaction(m,{kind:'room',roomId:${room.id}},'👍'); return true; })()`);
  await sleep(700);
  const info = JSON.parse(await js(w, `(() => {
    const get = (sel, prop='color') => { const e=document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
    return JSON.stringify({
      theme: document.documentElement.dataset.theme,
      daypart: document.documentElement.dataset.daypart,
      text: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
      muted: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(),
      roomName: get('.room-row .name'),
      msgText: get('.msg-text'),
      reaction: get('.reaction-chip'),
      sidebar: get('.sidebar','backgroundColor'),
    });
  })()`));
  fs.writeFileSync('C:/Users/solom/Documents/deepseek-harness/default-workspace/_backup/ui33/contrast.json', JSON.stringify(info));
  if (info.theme !== 'glass' || info.daypart !== 'day') throw new Error(`не та тема/фаза: ${info.theme}/${info.daypart}`);
  if (info.roomName === 'rgb(154, 162, 196)') throw new Error('имя комнаты всё ещё сливается с фоном');
  if (!info.msgText || !info.msgText.startsWith('rgb(244, 246, 255')) throw new Error(`текст сообщения: ${info.msgText}`);
  if (!info.reaction || !info.reaction.startsWith('rgb(244, 246, 255')) throw new Error(`текст реакции: ${info.reaction}`);
  if (info.muted === '#9aa2c4') throw new Error('приглушённый текст не адаптирован к дневному фону');

  for (const phase of ['dawn', 'sunset']) {
    await js(w, `sozvonDaypart.show('${phase}'); true`);
    await sleep(350);
    const muted = await js(w, `getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()`);
    if (muted === '#9aa2c4') throw new Error(`приглушённый текст не адаптирован к фазе ${phase}`);
  }
});
