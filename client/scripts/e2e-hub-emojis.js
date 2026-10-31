// Свои смайлики канала: участник добавляет в настройках, все видят в окне смайликов и в сообщениях.
// Запуск (сервер должен работать): node_modules/electron/dist/electron.exe scripts/e2e-hub-emojis.js
const fs = require('fs');
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const fill = (id, value) => `(() => { const i = document.getElementById('${id}'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const send = (id, text) => `(() => { const a = document.getElementById('${id}'); a.focus(); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new Event('input', { bubbles: true })); a.form.requestSubmit(); return true; })()`;
const image = `document.querySelector('#room-messages .msg:last-child img.hub-emoji')`;

// Настоящий файл: зелёный квадрат, как если бы его выбрали на диске
const pick = `(async () => {
  const c = document.createElement('canvas'); c.width = c.height = 300;
  const g = c.getContext('2d'); g.fillStyle = '#2ecc71'; g.fillRect(0, 0, 300, 300);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await addHubEmoji(new File([blob], 'кот.png', { type: 'image/png' }));
  return true;
})()`;

runTest(async () => {
  const a = await register('hea', 'Аня');
  const b = await register('heb', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Смайлы' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { name: 'чат', kind: 'text', hubId: hub.id }, a.token);
  const winA = await openClient('hea', a);
  const winB = await openClient('heb', b);
  for (const w of [winA, winB]) await waitFor(w, 'e2eeReady()', 'ключ');
  for (const w of [winA, winB]) await js(w, `openHub(${hub.id}); selectRoom(${room.id}); true`);

  // Обычный участник добавляет смайлик в настройках канала
  await js(winB, `openHubSettings(${hub.id}); true`);
  await waitFor(winB, `!document.querySelector('#hs-nav [data-tab="emojis"]').classList.contains('hidden')`, 'вкладка у участника', 3000);
  await js(winB, `document.querySelector('#hs-nav [data-tab="emojis"]').click(); true`);
  await waitFor(winB, `Boolean(document.getElementById('hs-emoji-name'))`, 'поле имени', 2000);
  await js(winB, fill('hs-emoji-name', 'кот'));
  await js(winB, pick);
  await waitFor(winA, `hubById(${hub.id}).emojis.some((e) => e.name === 'кот')`, 'смайлик дошёл до Ани', 4000);
  await waitFor(winB, `document.querySelector('.hs-emoji')?.textContent.includes(':кот:')`, 'смайлик в списке', 3000);
  console.log('✔ участник добавил смайлик');

  // Занятое имя: понятная ошибка
  await js(winB, fill('hs-emoji-name', 'кот'));
  await js(winB, pick);
  await waitFor(winB, `document.getElementById('hs-error').textContent.includes('уже есть')`, 'ошибка занятого имени', 3000);
  await js(winB, 'closeHubSettings(); true');
  console.log('✔ занятое имя отклоняется');

  // Выбор из окна смайликов
  await js(winA, `roomComposer.emojiBtn.click(); true`);
  await waitFor(winA, `document.querySelector('.emoji-tab.active')?.dataset.group === 'Канал'`, 'вкладка канала', 2000);
  await js(winA, `document.querySelector('.emoji-grid .emoji img.hub-emoji').closest('button').click(); true`);
  await waitFor(winA, `document.getElementById('room-message-input').value === ':кот: '`, 'смайлик в черновике', 2000);
  await js(winA, `document.getElementById('room-message-form').requestSubmit(); true`);
  await waitFor(winB, `Boolean(${image}?.naturalWidth)`, 'смайлик в сообщении у Бори', 5000);
  if ((await js(winB, `${image}.naturalWidth`)) !== 128) throw new Error('Картинка не приведена к 128×128');
  console.log('✔ смайлик выбирается и виден в сообщении');

  // Текстом, рядом со словами, а в коде остаётся текстом
  await js(winB, send('room-message-input', 'смотри :кот: кот и :нет_такого:'));
  await waitFor(winA, `[...document.querySelectorAll('#room-messages .msg')].at(-1)?.textContent.includes('смотри')`, 'сообщение у Ани', 4000);
  await sleep(200);
  const last = `[...document.querySelectorAll('#room-messages .msg')].at(-1)`;
  if (!(await js(winA, `Boolean(${last}.querySelector('img.hub-emoji'))`))) throw new Error(':кот: в тексте не стал картинкой');
  if (!(await js(winA, `${last}.textContent.includes(':нет_такого:')`))) throw new Error('Неизвестное имя пропало');
  await js(winB, send('room-message-input', '`:кот:`'));
  await waitFor(winA, `${last}?.querySelector('code')?.textContent === ':кот:'`, 'код у Ани', 4000);
  if (await js(winA, `Boolean(${last}.querySelector('img.hub-emoji'))`)) throw new Error('В коде появилась картинка');
  console.log('✔ в тексте — картинка, в коде — текст, неизвестное имя не трогаем');

  if (process.env.E2E_SHOTS) {
    winA.show();
    winA.setAlwaysOnTop(true, 'screen-saver');
    await js(winA, `openHubSettings(${hub.id}); document.querySelector('#hs-nav [data-tab="emojis"]').click(); true`);
    await sleep(600);
    winA.webContents.invalidate();
    await sleep(300);
    fs.writeFileSync(`${process.env.E2E_SHOTS}/emojis.png`, (await winA.webContents.capturePage()).toPNG());
    await js(winA, 'closeHubSettings(); true');
    await sleep(300);
    winA.webContents.invalidate();
    await sleep(300);
    fs.writeFileSync(`${process.env.E2E_SHOTS}/emojis-chat.png`, (await winA.webContents.capturePage()).toPNG());
    winA.setAlwaysOnTop(false);
  }

  // В личном чате вкладки канала нет
  await js(winA, `selectContact(${b.user.id}).then(() => true)`);
  await js(winA, `dmComposer.emojiBtn.click(); true`);
  await sleep(200);
  if (!(await js(winA, `document.querySelector('.emoji-tab[data-group="Канал"]').classList.contains('hidden')`))) throw new Error('Вкладка канала в личном чате');
  await js(winA, `document.body.click(); true`);
  console.log('✔ в личном чате вкладки канала нет');

  // Чужой смайлик удаляет управляющий
  const emoji = await js(winA, `hubById(${hub.id}).emojis[0].id`);
  await api('DELETE', `/hubs/${hub.id}/emojis/${emoji}`, null, a.token);
  await waitFor(winB, `hubById(${hub.id}).emojis.length === 0`, 'смайлик удалён у Бори', 4000);
  console.log('✔ управляющий удалил смайлик');
});
