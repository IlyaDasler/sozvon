// Кто поставил реакцию: навели мышь на реакцию — видно имена; в настройках канала это можно выключить.
// Запуск (сервер должен работать): node_modules/electron/dist/electron.exe scripts/e2e-reaction-who.js
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const who = `document.getElementById('reaction-who')`;
const whoHidden = `${who}.classList.contains('hidden')`;
const whoText = `${who}.textContent`;

/** Настоящая мышь: движения за окном и на реакцию */
async function hoverChip(win, feed) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 60 });
  await sleep(150);
  const at = await js(win, `(() => { const r = document.querySelector('#${feed} .reaction-chip').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...at });
}

runTest(async () => {
  const a = await register('rwa', 'Аня');
  const b = await register('rwb', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Реакции' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { name: 'чат', kind: 'text', hubId: hub.id }, a.token);
  const winA = await openClient('rwa', a);
  const winB = await openClient('rwb', b);
  for (const w of [winA, winB]) {
    w.show();
    await js(w, `openHub(${hub.id}); selectRoom(${room.id}); true`);
  }

  await waitFor(winA, 'e2eeReady()', 'ключ');
  await js(winA, `(() => { const i = document.getElementById('room-message-input'); i.focus(); i.value = 'реакции сюда'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()`);
  await waitFor(winB, `document.querySelector('#room-messages .msg')?.textContent.includes('реакции сюда')`, 'сообщение у Бори');
  const id = await js(winB, `state.roomHistory?.get(${room.id})?.at(-1)?.id ?? document.querySelector('#room-messages .msg').message.id`);
  const path = `/rooms/${room.id}/messages/${id}/reactions`;
  await api('POST', path, { emoji: '👍' }, a.token);
  await api('POST', path, { emoji: '👍' }, b.token);
  await waitFor(winB, `document.querySelector('#room-messages .reaction-chip')?.textContent.includes('2')`, 'реакция у Бори');

  // По умолчанию видно, кто поставил
  await hoverChip(winB, 'room-messages');
  await waitFor(winB, `!${whoHidden} && ${whoText}.includes('Аня') && ${whoText}.includes('Боря')`, 'имена на реакции', 3000);
  console.log('✔ наведение показывает, кто поставил:', await js(winB, whoText));

  // Увели мышь — закрылось
  winB.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 60 });
  await waitFor(winB, whoHidden, 'подсказка закрылась', 2000);
  console.log('✔ подсказка закрывается');

  // Создатель выключает в настройках канала
  await js(winA, `openHubSettings(${hub.id}); true`);
  await waitFor(winA, `Boolean(document.getElementById('hs-reactions-visible'))`, 'переключатель', 3000);
  if (!(await js(winA, `document.getElementById('hs-reactions-visible').checked`))) throw new Error('По умолчанию выключено');
  await js(winA, `document.getElementById('hs-reactions-visible').click(); document.querySelector('.hs-overview').requestSubmit(); true`);
  await waitFor(winB, `hubById(${hub.id}).reactionsVisible === false`, 'настройка дошла до Бори', 4000);

  await hoverChip(winB, 'room-messages');
  await sleep(700);
  if (!(await js(winB, whoHidden))) throw new Error('Имена видны при выключенной настройке');
  if ((await api('GET', path, null, b.token).catch((e) => e.status)) !== 403 && !String(await api('GET', path, null, b.token).catch((e) => e.message)).includes('скрыто')) throw new Error('Сервер отдал имена');
  console.log('✔ выключено: имена скрыты и в приложении, и на сервере');

  // Реакции при этом работают: счётчик виден
  if (!(await js(winB, `document.querySelector('#room-messages .reaction-chip').textContent.includes('2')`))) throw new Error('Счётчик пропал');

  // Включаем обратно: настройка сохранилась и снова действует
  await waitFor(winA, `!document.getElementById('hs-reactions-visible').checked`, 'переключатель выключен', 3000);
  await js(winA, `document.getElementById('hs-reactions-visible').click(); document.querySelector('.hs-overview').requestSubmit(); true`);
  await waitFor(winB, `hubById(${hub.id}).reactionsVisible === true`, 'включено у Бори', 4000);
  await hoverChip(winB, 'room-messages');
  await waitFor(winB, `!${whoHidden}`, 'имена снова видны', 3000);
  console.log('✔ включили обратно — имена снова видны');
  if (process.env.E2E_SHOTS) {
    winB.setAlwaysOnTop(true, 'screen-saver');
    await sleep(300);
    await hoverChip(winB, 'room-messages');
    await sleep(800);
    winB.webContents.invalidate();
    await sleep(300);
    require('fs').writeFileSync(`${process.env.E2E_SHOTS}/reaction-who.png`, (await winB.webContents.capturePage()).toPNG());
    winB.setAlwaysOnTop(false);
  }
  winB.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 60 });

  // Личный чат: видно всегда
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await js(winA, `closeHubSettings(); selectContact(${b.user.id}).then(() => true)`);
  await js(winA, `(async () => { const { body, plain } = await encryptOutgoing(dmConvOf(${b.user.id}), { text: 'в личке' }); addMessage({ ...(await Api.post('/messages/${b.user.id}', body)), plain }); return true; })()`);
  await waitFor(winB, `document.querySelector('#messages .msg')?.textContent.includes('в личке')`, 'личное у Бори');
  const dmId = await js(winB, `document.querySelector('#messages .msg').message.id`);
  await api('POST', `/messages/${a.user.id}/${dmId}/reactions`, { emoji: '🔥' }, b.token);
  await waitFor(winB, `Boolean(document.querySelector('#messages .reaction-chip'))`, 'реакция в личке');
  await hoverChip(winB, 'messages');
  await waitFor(winB, `!${whoHidden} && ${whoText}.includes('Боря')`, 'имя в личном чате', 3000);
  console.log('✔ в личном чате видно, кто поставил');
});
