// Сквозной тест чата: разметка, ссылки, смайлики, файлы и картинки, предпросмотр ссылок.
// Запуск (сервер должен работать, для превью — с LINK_PREVIEW_ALLOW_PRIVATE=1): npx electron scripts/e2e-chat.js [адрес сервера]
const http = require('node:http');
const { api, befriend, register, js, waitFor, openClient, screenshot, runTest } = require('./e2e-lib');

// Последнее сообщение в открытом чате
const lastMsg = `[...document.querySelectorAll('#messages .msg-text')].at(-1)`;

runTest(async () => {
  const a = await register('ca', 'Аня');
  const b = await register('cb', 'Боря');
  await befriend(a, b);
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

  // Смайлик из панели: попадает в поле, сообщение из одного смайлика — крупно
  await js(winA, `document.querySelector('#message-form .composer-btn.emoji').click(); true`);
  await waitFor(winA, `!document.querySelector('.emoji-popover').classList.contains('hidden')`, 'панель смайликов');
  await js(winA, `document.querySelector('.emoji-tab[data-group="Смайлы"]').click(); [...document.querySelectorAll('.emoji-popover .emoji')].find((b) => b.textContent === '😂').click(); true`);
  if ((await js(winA, `document.getElementById('message-input').value`)) !== '😂') throw new Error('Смайлик не вставился');
  await js(winA, `document.getElementById('message-form').requestSubmit(); true`);
  await waitFor(winB, `${lastMsg}?.classList.contains('emoji-only') && ${lastMsg}.textContent === '😂'`, 'крупный смайлик у Бори');
  console.log('✔ смайлики из панели, сообщение из смайлика — крупно');

  // Картинка и файл: загрузка с ходом, отправка вместе с текстом, у собеседника — картинка и карточка файла
  await js(
    winA,
    `(async () => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 200;
      const g = c.getContext('2d'); g.fillStyle = '#5865f2'; g.fillRect(0, 0, 320, 200);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      dmComposer.addFiles([new File([blob], 'картинка.png', { type: 'image/png' }), new File(['привет из файла'], 'заметки.txt', { type: 'text/plain' })]);
      return true;
    })()`
  );
  await waitFor(winA, `dmComposer.files.length === 2 && dmComposer.files.every((f) => f.attachment)`, 'загрузка файлов');
  await screenshot(winA, 'chat-files-pending');
  await send(winA, 'Смотри, что нашёл');
  await waitFor(
    winB,
    `(() => {
      const m = [...document.querySelectorAll('#messages .msg-content')].at(-1);
      const img = m?.querySelector('.msg-images img');
      return img?.complete && img.naturalWidth === 320 && m.querySelector('.file-card')?.textContent.includes('заметки.txt') &&
        m.querySelector('.msg-text')?.textContent === 'Смотри, что нашёл';
    })()`,
    'картинка и файл у Бори'
  );
  if (await js(winA, `dmComposer.files.length !== 0`)) throw new Error('Вложения не убрались из поля после отправки');
  const fileText = await js(winB, `fetch([...document.querySelectorAll('#messages .file-card a')].at(-1).href).then((r) => r.text())`);
  if (fileText !== 'привет из файла') throw new Error('Файл скачивается не тот');
  await js(winB, `[...document.querySelectorAll('#messages .msg-images img')].at(-1).click(); true`);
  await waitFor(winB, `!document.getElementById('image-viewer').classList.contains('hidden')`, 'картинка крупно');
  await screenshot(winB, 'chat-files');
  await js(winB, `document.getElementById('image-viewer').click(); true`);
  console.log('✔ картинки и файлы отправляются, картинка открывается крупно, файл скачивается');

  // Превью ссылки: появляется в поле ввода, уходит с сообщением; крестик убирает его — уходит только ссылка
  const site = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>Тестовая страница</title><meta property="og:description" content="Описание для превью">');
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const page = `http://127.0.0.1:${site.address().port}/page`;
  const typeText = (text) =>
    js(winA, `(() => { const a = document.getElementById('message-input'); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new Event('input')); return true; })()`);
  await typeText(`глянь ${page}`);
  await waitFor(winA, `document.querySelector('#message-form .composer-preview .link-card-title')?.textContent === 'Тестовая страница'`, 'превью в поле ввода');
  await screenshot(winA, 'chat-preview-composer');
  await js(winA, `document.getElementById('message-form').requestSubmit(); true`);
  await waitFor(winB, `[...document.querySelectorAll('#messages .msg-content')].at(-1)?.querySelector('.link-card-desc')?.textContent === 'Описание для превью'`, 'превью у Бори');
  await typeText(`ещё раз ${page}`);
  await waitFor(winA, `Boolean(document.querySelector('#message-form .composer-preview .link-card'))`, 'превью снова');
  await js(winA, `document.querySelector('#message-form .composer-preview .file-remove').click(); true`);
  await waitFor(winA, `document.querySelector('#message-form .composer-preview').classList.contains('hidden')`, 'превью убрано');
  await js(winA, `document.getElementById('message-form').requestSubmit(); true`);
  await waitFor(winB, `[...document.querySelectorAll('#messages .msg-content')].at(-1)?.textContent.startsWith('ещё раз')`, 'сообщение без превью');
  if (await js(winB, `Boolean([...document.querySelectorAll('#messages .msg-content')].at(-1).querySelector('.link-card'))`))
    throw new Error('Превью ушло, хотя его убрали');
  site.close();
  console.log('✔ превью ссылки показывается и отправляется, крестик убирает его');

  // Профиль: Аня пишет «О себе» и выбирает баннер в настройках, Боря видит это в карточке по щелчку на аватарку
  await js(winA, `openSettings()`);
  await js(
    winA,
    `(() => {
      document.getElementById('set-bio').value = 'Играю в **CS2** по вечерам';
      document.querySelectorAll('#banner-picker .color')[3].click();
      document.getElementById('settings-form').requestSubmit();
      return true;
    })()`
  );
  await waitFor(winA, `state.me.bio === 'Играю в **CS2** по вечерам' && Boolean(state.me.bannerColor)`, 'профиль сохранён');
  await waitFor(winB, `state.contacts.get(${a.user.id})?.bio === 'Играю в **CS2** по вечерам'`, 'профиль Ани дошёл до Бори без перезахода');
  await js(winB, `[...document.querySelectorAll('#messages .msg:not(.cont) .avatar[data-profile]')].at(-1).click(); true`);
  await waitFor(
    winB,
    `(() => {
      const card = document.getElementById('profile-card');
      return !card.classList.contains('hidden') && card.querySelector('.pc-name')?.textContent === 'Аня' &&
        card.querySelector('.pc-bio strong')?.textContent === 'CS2' && Boolean(card.querySelector('.pc-banner').style.getPropertyValue('--banner')) &&
        [...card.querySelectorAll('.pc-actions .btn')].map((b) => b.textContent).join() === 'Написать,Позвонить';
    })()`,
    'карточка Ани у Бори'
  );
  await js(winB, `(() => { const n = document.querySelector('.pc-note'); n.value = 'знакомы с универа'; n.dispatchEvent(new Event('input')); return true; })()`);
  await screenshot(winB, 'profile-card');
  await js(winB, `document.body.click(); true`);
  await waitFor(winB, `document.getElementById('profile-card').classList.contains('hidden')`, 'карточка закрылась');
  await js(winB, `document.getElementById('me-info').click(); true`);
  await waitFor(winB, `document.querySelector('#profile-card .pc-edit') && document.querySelector('#profile-card .pc-name').textContent === 'Боря'`, 'своя карточка');
  await js(winB, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); document.getElementById('peer-avatar').click(); true`);
  await waitFor(winB, `document.querySelector('#profile-card .pc-note')?.value === 'знакомы с универа'`, 'заметка сохранилась');
  console.log('✔ карточка профиля: «О себе» с разметкой, баннер, заметка, своя карточка');
});
