// Живые действия чата: отправка, ответ, реакция, тред, закрытие поповеров.
const { api, befriend, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('ch' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('chb' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Чат' }, a.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  await api('POST', `/rooms/${room.id}/messages`, { text: 'корень' }, a.token);

  const w = await openClient('ch', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  // Личный чат: отправка через форму.
  await js(w, `selectContact(${b.user.id}); true`);
  await sleep(700);
  const text = 'сообщение ' + Date.now();
  await js(w, `(() => {
    const input = document.getElementById('message-input');
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('message-form').requestSubmit();
    return true;
  })()`);
  await waitFor(w, `document.getElementById('messages').textContent.includes(${JSON.stringify(text)})`, 'отправка сообщения', 6000);
  console.log('dm-sent');

  // Смайлики, GIF и тема чата открываются и закрываются системным back.
  for (const [title, selector, label] of [['Смайлики', '.emoji-popover', 'emoji'], ['Мои гифки', '.gif-popover', 'gif']]) {
    await js(w, `document.querySelector('#chat .composer [title="${title}"]')?.click(); true`);
    await sleep(300);
    const open = await js(w, `Boolean(document.querySelector('${selector}:not(.hidden)'))`);
    console.log(label + '-pop', open);
    if (!open) throw new Error(label + ': поповер не открылся');
    await js(w, `window.sozvonBack(); true`);
    await sleep(200);
  }
  await js(w, `document.getElementById('chat-theme-btn').click(); true`);
  await sleep(300);
  const themePop = await js(w, `!document.getElementById('chat-theme-pop').classList.contains('hidden')`);
  console.log('theme-pop', themePop);
  if (!themePop) throw new Error('поповер темы чата не открылся');
  await js(w, `window.sozvonBack(); true`);
  await sleep(200);

  // Ответ на последнее сообщение.
  await js(w, `(() => {
    const rows = [...document.querySelectorAll('#messages .msg')];
    const last = rows[rows.length - 1];
    last.querySelector('[title="Ответить"]').click();
    return true;
  })()`);
  await sleep(300);
  if (await js(w, `document.getElementById('chat-reply').classList.contains('hidden')`)) throw new Error('ответ не открыл панель');
  console.log('reply-open');
  await js(w, `window.sozvonBack(); true`);
  await sleep(300);

  // Реакция открывает поповер, закрывается back.
  await js(w, `(() => {
    const rows = [...document.querySelectorAll('#messages .msg')];
    rows[rows.length - 1].querySelector('[title="Реакция"]').click();
    return true;
  })()`);
  await sleep(300);
  const pop = await js(w, `Boolean(document.querySelector('.emoji-popover:not(.hidden), .reaction-pop:not(.hidden), .reactions-pop:not(.hidden)'))`);
  console.log('reaction-pop', pop);
  await js(w, `window.sozvonBack(); true`);
  await sleep(250);

  // Комната и тред.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500);
  await js(w, `selectRoom(${room.id}); true`);
  await sleep(700);
  await js(w, `(() => {
    const rows = [...document.querySelectorAll('#room-messages .msg')];
    const last = rows[rows.length - 1];
    last.querySelector('[title="Обсудить сообщение"]').click();
    return true;
  })()`);
  await waitFor(w, `!document.getElementById('thread-panel').classList.contains('hidden')`, 'тред', 5000);
  await sleep(400);
  const threadText = 'в треде ' + Date.now();
  await js(w, `(() => {
    const input = document.getElementById('thread-input');
    input.value = ${JSON.stringify(threadText)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('thread-form').requestSubmit();
    return true;
  })()`);
  await waitFor(w, `document.getElementById('thread-list').textContent.includes(${JSON.stringify(threadText)})`, 'сообщение в треде', 6000);
  console.log('thread-sent');
  await js(w, `window.sozvonBack(); true`);
  await sleep(300);
  if (!(await js(w, `document.getElementById('thread-panel').classList.contains('hidden')`))) throw new Error('тред не закрылся back');
});
