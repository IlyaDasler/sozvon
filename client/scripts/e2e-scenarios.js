// Обычная переписка глазами людей: всё через интерфейс — поле ввода, Enter, кнопки у сообщения. Каждый шаг проверяется у обоих
// собеседников, в личном чате и в канале, и ещё раз после перезапуска. Тост с ошибкой на любом шаге — провал.
// Запуск (сервер должен работать): npx electron scripts/e2e-scenarios.js [адрес сервера]
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const ready = `e2eeReady() && document.getElementById('conn-dot').classList.contains('ok')`;

// Что делает человек
const typeAndSend = (input, text) => `(() => {
  const area = document.getElementById('${input}');
  area.focus();
  area.value = ${JSON.stringify(text)};
  area.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
  area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return true;
})()`;
const row = (box, text) => `[...document.querySelectorAll('#${box} .msg')].find((r) => r.querySelector('.msg-body')?.textContent.includes(${JSON.stringify(text)}))`;
const tool = (box, text, title) => `(() => { ${row(box, text)}.querySelector('.msg-tool[title^="${title}"]').click(); return true; })()`;
const attach = (composer, name, bytes = 'картинка') => /\.png$/.test(name)
  ? `(async () => { const c = document.createElement('canvas'); c.width = 80; c.height = 60; c.getContext('2d').fillRect(0, 0, 80, 60); const blob = await new Promise((r) => c.toBlob(r, 'image/png')); ${composer}.addFiles([new File([blob], ${JSON.stringify(name)}, { type: 'image/png' })]); return true; })()`
  : `(() => { ${composer}.addFiles([new File([${JSON.stringify(bytes)}], ${JSON.stringify(name)}, { type: 'text/plain' })]); return true; })()`;
const hasImage = (box, text) => `Boolean(${row(box, text)}?.querySelector('.msg-images img')?.naturalWidth)`;
const quoted = (box, text, quote) => `Boolean(${row(box, text)}?.querySelector('.msg-reply')?.textContent.includes(${JSON.stringify(quote)}))`;
// Все тосты за тест: тихая ошибка тоже провал
const watchToasts = `(() => { window.toasts = []; const real = toast; toast = (text, ...rest) => { window.toasts.push(String(text)); return real(text, ...rest); }; return true; })()`;

runTest(async () => {
  const a = await register('sca', 'Аня');
  const b = await register('scb', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Компания' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const winA = await openClient('sca', a);
  const winB = await openClient('scb', b);
  for (const w of [winA, winB]) {
    await waitFor(w, `e2eeReady() && Boolean(roomById(${room.id}))`, 'ключ');
    await js(w, watchToasts);
  }

  async function checkToasts(step) {
    for (const w of [winA, winB]) {
      const bad = (await js(w, 'window.toasts.splice(0)')).filter((t) => !/скопирован|обновлен|Закреплено/i.test(t));
      if (bad.length) throw new Error(`${step}: ошибка на экране — ${bad.join('; ')}`);
    }
  }

  async function scenario(name, open, { box, input, composer }) {
    const both = (expr, what) => Promise.all([winA, winB].map((w) => waitFor(w, expr, `${name}: ${what}`, 8000)));
    const send = async (win, text) => {
      await js(win, typeAndSend(input, text));
      await both(`Boolean(${row(box, text)})`, `«${text}» дошло`);
    };
    const edit = async (text, next) => {
      await js(winA, tool(box, text, 'Изменить'));
      await waitFor(winA, `document.getElementById('${input}').value === ${JSON.stringify(text)}`, `${name}: текст в поле правки`);
      await js(winA, typeAndSend(input, next));
    };
    const sendWithFile = async (file, text) => {
      await js(winA, attach(composer, file));
      await waitFor(winA, `${composer}.files.length === 1 && ${composer}.files.every((f) => f.attachment)`, `${name}: загрузка`);
      await js(winA, typeAndSend(input, text));
      await both(`Boolean(${row(box, text)})`, `«${text}» дошло`);
    };

    await js(winA, open);
    await js(winB, open);
    await sleep(300);

    await send(winA, `${name}: привет`);
    await js(winB, tool(box, `${name}: привет`, 'Ответить'));
    await send(winB, `${name}: и тебе`);
    await both(quoted(box, `${name}: и тебе`, `${name}: привет`), 'цитата в ответе');
    await js(winA, tool(box, `${name}: привет`, 'Ответить'));
    await send(winA, `${name}: сам себе`);
    await both(quoted(box, `${name}: сам себе`, `${name}: привет`), 'ответ на своё');
    await checkToasts(`${name}: ответы`);
    console.log(`✔ ${name}: ответ на чужое и своё сообщение`);

    await sendWithFile('кот.png', `${name}: смотри`);
    await both(hasImage(box, `${name}: смотри`), 'картинка дошла');
    await js(winB, tool(box, `${name}: смотри`, 'Ответить'));
    await send(winB, `${name}: милый`);
    await both(quoted(box, `${name}: милый`, `${name}: смотри`), 'ответ на картинку');
    await checkToasts(`${name}: картинка`);
    console.log(`✔ ${name}: картинка и ответ на неё`);

    await edit(`${name}: смотри`, `${name}: смотри какой`);
    await both(`${hasImage(box, `${name}: смотри какой`)} && Boolean(${row(box, `${name}: смотри какой`)}.querySelector('.msg-edited'))`, 'правка подписи, картинка на месте');
    await edit(`${name}: сам себе`, `${name}: сам себе исправил`);
    await both(quoted(box, `${name}: сам себе исправил`, `${name}: привет`), 'правка не убрала цитату');
    await sendWithFile('заметки.txt', `${name}: файл`);
    await edit(`${name}: файл`, `${name}: файл новый`);
    await both(`${row(box, `${name}: файл новый`)}?.textContent.includes('заметки.txt')`, 'правка не убрала файл');
    await checkToasts(`${name}: правка`);
    console.log(`✔ ${name}: правка сохраняет картинку, файл и цитату`);

    // Черновик не теряется, пока правишь другое сообщение
    await js(winA, `(() => { const i = document.getElementById('${input}'); i.value = 'мой черновик'; i.dispatchEvent(new InputEvent('input', { inputType: 'insertText' })); return true; })()`);
    await edit(`${name}: файл новый`, `${name}: файл новее`);
    await both(`Boolean(${row(box, `${name}: файл новее`)})`, 'правка при черновике');
    await waitFor(winA, `document.getElementById('${input}').value === 'мой черновик'`, `${name}: черновик вернулся после правки`);
    await js(winA, `(() => { const i = document.getElementById('${input}'); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()`);

    // Подпись можно убрать совсем — картинка остаётся
    await sendWithFile('второй.png', `${name}: без подписи`);
    await js(winA, tool(box, `${name}: без подписи`, 'Изменить'));
    await js(winA, typeAndSend(input, ''));
    await sleep(600);
    await both(`!${row(box, `${name}: без подписи`)} && [...document.querySelectorAll('#${box} .msg-images img')].filter((i) => i.alt === 'второй.png' && i.naturalWidth).length === 1`, 'подпись убрана, картинка осталась');
    await checkToasts(`${name}: без подписи`);

    // Реакция и закреп
    await js(winB, `(() => { ${row(box, `${name}: привет`)}.querySelector('.msg-tool[title="Реакция"]').click(); return true; })()`);
    await waitFor(winB, `Boolean(document.querySelector('.reaction-pop button'))`, `${name}: окно реакций`);
    await js(winB, `document.querySelector('.reaction-pop button').click(); true`);
    await both(`Boolean(${row(box, `${name}: привет`)}.querySelector('.reaction-chip'))`, 'реакция видна обоим');
    await js(winA, tool(box, `${name}: привет`, 'Закрепить'));
    await both(`Boolean(${row(box, `${name}: привет`)}.querySelector('.msg-tool[title="Открепить"]'))`, 'закреп виден обоим');
    await checkToasts(`${name}: реакция и закреп`);

    // Удаление своего
    await send(winA, `${name}: удалю`);
    await js(winA, `(() => { ${row(box, `${name}: удалю`)}.querySelector('.msg-tool.danger').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); return true; })()`);
    await both(`!${row(box, `${name}: удалю`)}`, 'удалённое исчезло');
    console.log(`✔ ${name}: удаление, реакция, закреп`);

    // После перезапуска всё то же самое: сообщения приходят с сервера, а не из памяти
    for (const w of [winA, winB]) {
      await js(w, 'location.reload()').catch(() => {});
    }
    await sleep(1500);
    for (const w of [winA, winB]) {
      await waitFor(w, ready, `${name}: перезапуск`);
      await js(w, watchToasts);
    }
    await js(winA, open);
    await js(winB, open);
    await both(hasImage(box, `${name}: смотри какой`), 'картинка после перезапуска');
    await both(quoted(box, `${name}: сам себе исправил`, `${name}: привет`), 'цитата после перезапуска');
    await both(`${row(box, `${name}: файл новее`)}?.textContent.includes('заметки.txt')`, 'файл после перезапуска');
    await checkToasts(`${name}: перезапуск`);
    console.log(`✔ ${name}: всё на месте после перезапуска`);
  }

  // В личном чате открываем собеседника: у каждого свой id
  await scenario('личный чат', `(state.me.id === ${a.user.id} ? selectContact(${b.user.id}) : selectContact(${a.user.id})).then(() => true)`, {
    box: 'messages',
    input: 'message-input',
    composer: 'dmComposer',
  });
  await scenario('канал', `selectRoom(${room.id}); true`, { box: 'room-messages', input: 'room-message-input', composer: 'roomComposer' });
});
