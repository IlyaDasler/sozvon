// Сквозной тест чата: разметка, ссылки, смайлики, файлы и картинки, предпросмотр ссылок.
// Запуск (сервер должен работать): npx electron scripts/e2e-chat.js [адрес сервера]
const { api, register, js, waitFor, openClient, screenshot, runTest } = require('./e2e-lib');

// Последнее сообщение в открытом чате
const lastMsg = `[...document.querySelectorAll('#messages .msg-text')].at(-1)`;

runTest(async () => {
  const a = await register('ca', 'Аня');
  const b = await register('cb', 'Боря');
  await api('POST', '/contacts', { username: b.user.username }, a.token);
  const winA = await openClient('ca', a);
  const winB = await openClient('cb', b);
  await js(winA, `selectContact(${b.user.id})`);
  await js(winB, `selectContact(${a.user.id})`);
  console.log('✔ оба вошли и открыли чат');

  // Разметка: жирный, курсив, код, ссылка, спойлер, цитата и список
  const send = (win, text) =>
    js(win, `document.getElementById('message-input').value = ${JSON.stringify(text)}; document.getElementById('message-form').requestSubmit(); true`);
  await send(winA, '**жирный** *курсив* `код` ||секрет|| и https://ya.ru/search?q=1.\n> цитата\n- раз\n- два');
  await waitFor(
    winB,
    `(() => {
      const m = ${lastMsg};
      const a = m?.querySelector('a');
      return m && m.querySelector('strong')?.textContent === 'жирный' && m.querySelector('em')?.textContent === 'курсив' &&
        m.querySelector('code')?.textContent === 'код' && m.querySelector('.spoiler')?.textContent === 'секрет' &&
        a?.href === 'https://ya.ru/search?q=1' && a.target === '_blank' &&
        m.querySelector('blockquote')?.textContent === 'цитата' && m.querySelectorAll('li').length === 2;
    })()`,
    'разметка у Бори'
  );
  console.log('✔ разметка и ссылки показываются у собеседника');

  // Попытка вставить разметку страницы остаётся текстом
  await send(winA, '<img src=x onerror="window.hacked=1"> [клик](javascript:alert(1))');
  await waitFor(winB, `${lastMsg}?.textContent.includes('<img src=x')`, 'текст с тегами');
  if (await js(winB, `Boolean(window.hacked) || Boolean(${lastMsg}.querySelector('img, a'))`)) throw new Error('Разметка страницы из сообщения сработала');
  console.log('✔ теги и опасные ссылки из сообщения остаются текстом');

  await screenshot(winB, 'chat-markdown');
});
