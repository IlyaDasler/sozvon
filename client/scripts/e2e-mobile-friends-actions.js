// Друзья: добавление по логину, поиск, заявка; уведомления: очистка.
const { api, befriend, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('fa' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('fb' + Date.now().toString(36).slice(-4), 'Боря');
  const w = await openClient('fa', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  // Добавление по логину.
  await js(w, `document.querySelector('#friend-tabs [data-tab="add"]').click(); true`);
  await sleep(300);
  await js(w, `(() => {
    const input = document.getElementById('friend-add-input');
    input.value = ${JSON.stringify(b.user.username)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('friend-add-submit').click();
    return true;
  })()`);
  await waitFor(w, `document.getElementById('friend-add-result').textContent.trim().length > 0`, 'результат заявки', 6000);
  const result = await js(w, `document.getElementById('friend-add-result').textContent.trim()`);
  console.log('friend-add', result);
  if (!/отправ|заявк|уже|добав/i.test(result)) throw new Error('заявка не отправилась: ' + result);

  await api('POST', `/friend-requests/${a.user.id}/accept`, null, b.token);

  // Поиск по друзьям.
  await js(w, `document.querySelector('#friend-tabs [data-tab="all"]').click(); true`);
  await sleep(400);
  await js(w, `(() => { const s=document.getElementById('friend-search'); s.value='Боря'; s.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await sleep(300);
  const found = await js(w, `document.getElementById('friends-list').textContent.includes('Боря')`);
  console.log('friend-search', found);
  if (!found) throw new Error('поиск не нашёл друга');

  // Уведомление и очистка.
  await api('POST', `/messages/${a.user.id}`, { text: 'для уведомления' }, b.token);
  await sleep(500);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(500);
  if (await js(w, `document.getElementById('notif-panel').classList.contains('hidden')`)) throw new Error('уведомления не открылись');
  const hasClear = await js(w, `!document.getElementById('notif-clear').classList.contains('hidden')`);
  if (!hasClear) throw new Error('нет кнопки очистки уведомлений');
  await js(w, `document.getElementById('notif-clear').click(); true`);
  await sleep(300);
  const empty = await js(w, `!document.getElementById('notif-empty').classList.contains('hidden')`);
  const count = await js(w, `document.querySelectorAll('#notif-list .notif-item').length`);
  console.log('notif-clear', empty, count);
  if (!empty || count !== 0) throw new Error('уведомления не очистились');
});
