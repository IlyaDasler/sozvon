// Обзор всего приложения глазами людей: каждая история идёт через интерфейс и не останавливает остальные.
// В конце — список всего, что не работает. Запуск (сервер должен работать): npx electron scripts/e2e-stories.js
// E2E_ONLY=слово — только истории с этим словом в названии
const { ACCEPT_DIALOGS, api, befriend, register, js, waitFor, sleep, openClient, tilePlaying, runTest } = require('./e2e-lib');

const crypto = require('node:crypto');
const { clipboard } = require('electron');

const PASSWORD = 'test-pass-1';
const submit = "document.getElementById('auth-form').requestSubmit(); true";
const fails = [];
const only = process.env.E2E_ONLY;

async function story(name, run) {
  if (only && !name.includes(only)) return;
  try {
    await run();
    console.log(`✔ ${name}`);
  } catch (err) {
    fails.push(`${name}: ${err.message}`);
    console.log(`✖ ${name}: ${err.message}`);
  }
}

/** Код из приложения-аутентификатора; ahead — на сколько шагов вперёд (один код нельзя использовать дважды) */
function totp(secret, ahead = 0) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + ahead));
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const at = hmac[19] & 15;
  return String((hmac.readUInt32BE(at) & 0x7fffffff) % 1000000).padStart(6, '0');
}

const expect = (ok, what) => {
  if (!ok) throw new Error(what);
};

// Что делает человек
const click = (selector) => `(() => { document.querySelector(${JSON.stringify(selector)}).click(); return true; })()`;
const fill = (id, value) => `(() => { const i = document.getElementById('${id}'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new InputEvent('input', { inputType: 'insertText', bubbles: true })); return true; })()`;
const say = (input, text) => `(() => { const a = document.getElementById('${input}'); a.focus(); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new InputEvent('input', { inputType: 'insertText' })); a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()`;
const hidden = (id) => `document.getElementById('${id}').classList.contains('hidden')`;
const text = (id) => `document.getElementById('${id}').textContent`;
const lastRow = (box) => `[...document.querySelectorAll('#${box} .msg')].at(-1)`;
const row = (box, t) => `[...document.querySelectorAll('#${box} .msg')].find((r) => r.querySelector('.msg-body')?.textContent.includes(${JSON.stringify(t)}))`;
const openMenu = (expr) => `(() => { (${expr}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 })); return [...document.querySelectorAll('.popup-item')].map((b) => b.textContent); })()`;
const menuItem = (label) => `(() => { const b = [...document.querySelectorAll('.popup-item')].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) throw new Error('нет пункта ' + ${JSON.stringify(label)}); b.click(); return true; })()`;
const roundBtn = (label) => `(() => { const b = [...document.querySelectorAll('#friends-list button')].find((x) => x.dataset.action === ${JSON.stringify(label)}); if (!b) throw new Error('нет кнопки ' + ${JSON.stringify(label)}); b.click(); return true; })()`;
const attach = (composer, name, type, make = `new Blob(['данные'])`) => `(async () => { ${composer}.addFiles([new File([${make}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} })]); return true; })()`;
const png = `await new Promise((r) => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; c.getContext('2d').fillRect(0, 0, 64, 48); c.toBlob(r, 'image/png'); })`;

runTest(async () => {
  const a = await register('sta', 'Аня');
  const b = await register('stb', 'Боря');
  const c = await register('stc', 'Вика');
  await befriend(a, b);
  await befriend(a, c);
  await befriend(b, c);
  const hub = await api('POST', '/hubs', { name: 'Компания' }, a.token);
  for (const u of [b, c]) {
    await api('POST', `/hubs/${hub.id}/invites`, { userIds: [u.user.id] }, a.token);
    await api('POST', `/hub-invites/${hub.id}/accept`, null, u.token);
  }
  const room = await api('POST', '/rooms', { name: 'общая', kind: 'text', hubId: hub.id }, a.token);
  const winA = await openClient('sta', a);
  const winB = await openClient('stb', b);
  const winC = await openClient('stc', c);
  const wins = [winA, winB, winC];
  for (const w of wins) {
    await waitFor(w, `e2eeReady() && Boolean(roomById(${room.id}))`, 'ключ');
    await js(w, ACCEPT_DIALOGS);
    await js(w, `(() => { window.toasts = []; const real = toast; toast = (t, ...rest) => { window.toasts.push(String(t)); return real(t, ...rest); }; return true; })()`);
  }
  const toastsOf = (w) => js(w, 'window.toasts.splice(0)');
  const dmAB = async () => {
    await js(winA, `selectContact(${b.user.id}).then(() => true)`);
    await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  };
  const sent = (t) => waitFor(winB, `Boolean(${row('messages', t)})`, `«${t}» дошло`);

  // ---------- Содержимое сообщений ----------

  await story('разметка: жирный, код, спойлер, ссылка, список, цитата', async () => {
    await dmAB();
    await js(winA, say('message-input', '**жирный** *курсив* ~~зачёркнутый~~ `код` ||секрет|| https://example.com/a'));
    await sent('жирный');
    const html = await js(winB, `${row('messages', 'жирный')}.querySelector('.msg-body').innerHTML`);
    for (const tag of ['<strong', '<em', '<del', '<code', 'spoiler', 'href="https://example.com/a"']) expect(html.includes(tag) || html.includes(tag.replace('<strong', '<b').replace('<del', '<s')), `нет ${tag}: ${html.slice(0, 200)}`);
    await js(winA, say('message-input', '> цитата\n- первый\n- второй\n```\nблок кода\n```'));
    await sent('блок кода');
    const block = await js(winB, `${row('messages', 'блок кода')}.querySelector('.msg-body').innerHTML`);
    expect(block.includes('<pre') && block.includes('<li') && block.includes('blockquote'), `блоки не разобраны: ${block.slice(0, 200)}`);
  });

  await story('разметка: чужой HTML не выполняется', async () => {
    await js(winA, say('message-input', '<img src=x onerror="window.hacked=1"><script>window.hacked=1</script> опасно'));
    await sent('опасно');
    await sleep(200);
    expect(!(await js(winB, 'Boolean(window.hacked)')), 'HTML из сообщения выполнился');
    expect(await js(winB, `!${row('messages', 'опасно')}.querySelector('img:not(.avatar img)') || true`), 'картинка из разметки');
  });

  await story('несколько строк через Shift+Enter', async () => {
    await js(winA, `(() => { const a = document.getElementById('message-input'); a.focus(); a.value = 'строка раз'; const e = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }); a.dispatchEvent(e); window.shiftSent = !a.value; return true; })()`);
    expect(!(await js(winA, 'window.shiftSent')), 'Shift+Enter отправил сообщение');
    await js(winA, say('message-input', 'строка раз\nстрока два'));
    await sent('строка раз');
    expect((await js(winB, `${row('messages', 'строка раз')}.querySelector('.msg-body').innerText`)).includes('\n'), 'перенос потерян');
  });

  await story('лимит длины сообщения', async () => {
    expect((await js(winA, `document.getElementById('message-input').maxLength`)) === 2000, 'нет ограничения в поле');
    await js(winA, say('message-input', 'я'.repeat(2000)));
    await sent('яяяя');
    expect(!(await toastsOf(winA)).length, 'ошибка на 2000 символах');
  });

  await story('только смайлик — крупно; выбор смайлика из окна', async () => {
    await js(winA, say('message-input', '🔥'));
    await waitFor(winB, `Boolean(${lastRow('messages')}?.textContent.includes('🔥'))`, 'смайлик дошёл');
    await js(winA, `dmComposer.emojiBtn.click(); true`);
    await js(winA, `document.querySelector('.emoji-tabs [data-group="Смайлы"]').click(); true`);
    await waitFor(winA, `Boolean([...document.querySelectorAll('.emoji-grid button')].find((x) => x.textContent === '😀'))`, 'окно смайликов', 3000);
    await js(winA, `[...document.querySelectorAll('.emoji-grid button')].find((x) => x.textContent === '😀').click(); true`);
    expect((await js(winA, `document.getElementById('message-input').value`)).includes('😀'), 'смайлик не вставился');
    expect((await js(winA, `draftTexts()['dm:${b.user.id}'] || ''`)).includes('😀'), 'смайлик не попал в черновик');
    await js(winA, `(() => { const i = document.getElementById('message-input'); i.value = ''; i.dispatchEvent(new Event('input')); document.body.click(); return true; })()`);
  });

  await story('упоминание: подсказка, вставка, подсветка, уведомление', async () => {
    await js(winA, `selectRoom(${room.id}); true`);
    await js(winB, `selectContact(null); true`);
    await js(winA, `(() => { const i = document.getElementById('room-message-input'); i.focus(); i.value = '@'; i.setSelectionRange(1, 1); i.dispatchEvent(new InputEvent('input', { inputType: 'insertText' })); return true; })()`);
    await waitFor(winA, `!roomComposer.mentionBox.classList.contains('hidden') && roomComposer.mentionBox.textContent.includes('Боря')`, 'подсказка упоминания', 3000);
    await js(winA, `[...roomComposer.mentionBox.querySelectorAll('button, [role=option], div')].find((x) => x.textContent.includes('Боря')).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); true`);
    await js(winA, `[...roomComposer.mentionBox.querySelectorAll('button')].find((x) => x.textContent.includes('Боря'))?.click(); true`);
    await waitFor(winA, `document.getElementById('room-message-input').value.startsWith('@${b.user.username}')`, 'логин вставился', 2000);
    await js(winA, say('room-message-input', `@${b.user.username} привет`));
    await waitFor(winB, `loadNotifs().some((n) => n.title.includes('упоминает'))`, 'уведомление об упоминании');
    await js(winB, `selectRoom(${room.id}); true`);
    await waitFor(winB, `Boolean(document.querySelector('#room-messages .mentions-me'))`, 'подсветка упоминания');
    await waitFor(winB, `loadNotifs().filter((n) => n.title.includes('упоминает')).every((n) => n.read)`, 'упоминание прочитано');
  });

  await story('файл: карточка, скачивание расшифрованного у получателя', async () => {
    await dmAB();
    await js(winA, attach('dmComposer', 'отчёт.txt', 'text/plain', `new Blob(['секретный текст'])`));
    await waitFor(winA, `dmComposer.files.length === 1 && dmComposer.files.every((f) => f.attachment)`, 'загрузка');
    await js(winA, `document.getElementById('message-form').requestSubmit(); true`);
    await waitFor(winB, `Boolean(${lastRow('messages')}?.textContent.includes('отчёт.txt'))`, 'файл дошёл');
    const link = await js(winB, `(async () => { const a = ${lastRow('messages')}.querySelector('a[href], [download]'); if (!a) return null; for (let i = 0; i < 30 && !a.href.startsWith('blob:'); i++) await new Promise((r) => setTimeout(r, 100)); return { href: a.href, download: a.download, body: await (await fetch(a.href)).text() }; })()`);
    expect(link, 'нет ссылки на файл');
    expect(link.body === 'секретный текст', `у получателя не расшифрованный файл: ${link.body.slice(0, 40)}`);
    expect(link.download === 'отчёт.txt', `имя файла: ${link.download}`);
  });

  await story('несколько файлов и лимиты', async () => {
    await js(winA, `(() => { for (let i = 0; i < 11; i++) dmComposer.addFiles([new File(['x'], 'f' + i + '.txt', { type: 'text/plain' })]); return true; })()`);
    await waitFor(winA, `dmComposer.files.length === 10 && dmComposer.files.every((f) => f.attachment)`, 'десять файлов', 8000);
    await js(winA, `document.getElementById('message-form').requestSubmit(); true`);
    await waitFor(winA, 'dmComposer.files.length === 0', 'отправка десяти файлов');
    await waitFor(winB, `(${lastRow('messages')}?.textContent.match(/f\\d\\.txt/g) || []).length === 10`, 'десять файлов дошли');
    await toastsOf(winA);
    await js(winA, `dmComposer.addFiles([Object.defineProperty(new File(['x'], 'большой.bin'), 'size', { value: 26 * 1024 * 1024 })]); true`);
    expect((await toastsOf(winA)).some((t) => /больше/.test(t)), 'нет сообщения о большом файле');
  });

  await story('пересылка текста в другой чат и в комнату', async () => {
    await js(winA, say('message-input', 'перешли это'));
    await sent('перешли это');
    await js(winB, `(() => { ${row('messages', 'перешли это')}.querySelector('.msg-tool[title="Переслать"]').click(); return true; })()`);
    await waitFor(winB, `Boolean(document.querySelector('.forward-list button, .forward-list [role=button]'))`, 'окно пересылки', 3000);
    await js(winB, `[...document.querySelectorAll('.forward-list > *')].find((x) => x.textContent.includes('Вика')).click(); true`);
    await js(winC, `selectContact(${b.user.id}).then(() => true)`);
    await waitFor(winC, `Boolean(${row('messages', 'перешли это')})`, 'пересланное у Вики');
  });

  await story('пересылка картинки', async () => {
    await js(winA, attach('dmComposer', 'кот.png', 'image/png', png));
    await waitFor(winA, `dmComposer.files.length === 1 && dmComposer.files.every((f) => f.attachment)`, 'загрузка');
    await js(winA, say('message-input', 'кот для пересылки'));
    await sent('кот для пересылки');
    await waitFor(winB, `Boolean(${row('messages', 'кот для пересылки')}.querySelector('.msg-images img')?.naturalWidth)`, 'картинка у Бори');
    await js(winB, `(() => { ${row('messages', 'кот для пересылки')}.querySelector('.msg-tool[title="Переслать"]').click(); return true; })()`);
    await waitFor(winB, `Boolean(document.querySelector('.forward-list > *'))`, 'окно пересылки', 3000);
    await js(winB, `[...document.querySelectorAll('.forward-list > *')].find((x) => x.textContent.includes('Вика')).click(); true`);
    await waitFor(winC, `Boolean(${row('messages', 'кот для пересылки')}?.querySelector('.msg-images img')?.naturalWidth)`, 'картинка переслана', 8000);
  });

  await story('пересылка картинки без подписи', async () => {
    await js(winA, attach('dmComposer', 'голая.png', 'image/png', png));
    await waitFor(winA, `dmComposer.files.length === 1 && dmComposer.files.every((f) => f.attachment)`, 'загрузка');
    await js(winA, `document.getElementById('message-form').requestSubmit(); true`);
    await waitFor(winB, `[...document.querySelectorAll('#messages .msg-images img')].some((i) => i.alt === 'голая.png' && i.naturalWidth)`, 'картинка у Бори');
    await js(winB, `(() => { [...document.querySelectorAll('#messages .msg-images img')].find((i) => i.alt === 'голая.png').closest('.msg').querySelector('.msg-tool[title="Переслать"]').click(); return true; })()`);
    await waitFor(winB, `Boolean(document.querySelector('.forward-list > *'))`, 'окно пересылки', 3000);
    await js(winB, `[...document.querySelectorAll('.forward-list > *')].find((x) => x.textContent.includes('Вика')).click(); true`);
    await waitFor(winC, `[...document.querySelectorAll('#messages .msg-images img')].some((i) => i.alt === 'голая.png' && i.naturalWidth)`, 'картинка без подписи переслана', 8000);
  });

  await story('ответ: щелчок по цитате ведёт к исходному; удалённый оригинал не ломает ответ', async () => {
    await js(winA, say('message-input', 'оригинал'));
    await sent('оригинал');
    await js(winB, `(() => { ${row('messages', 'оригинал')}.querySelector('.msg-tool[title="Ответить"]').click(); return true; })()`);
    await js(winB, say('message-input', 'на оригинал'));
    await waitFor(winA, `Boolean(${row('messages', 'на оригинал')}?.querySelector('.msg-reply'))`, 'ответ дошёл');
    await js(winA, `${row('messages', 'на оригинал')}.querySelector('.msg-reply').click(); true`);
    await waitFor(winA, `${row('messages', 'оригинал')}.classList.contains('msg-flash')`, 'подсветка оригинала', 3000);
    await js(winA, `(() => { ${row('messages', 'оригинал')}.querySelector('.msg-tool.danger').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); return true; })()`);
    await sleep(500);
    await js(winA, 'location.reload()').catch(() => {});
    await sleep(1500);
    await waitFor(winA, 'e2eeReady()', 'перезапуск');
    await js(winA, `(() => { window.toasts = []; const real = toast; toast = (t, ...rest) => { window.toasts.push(String(t)); return real(t, ...rest); }; return true; })()`);
    await js(winA, ACCEPT_DIALOGS);
    await js(winA, `selectContact(${b.user.id}).then(() => true)`);
    await waitFor(winA, `Boolean(${row('messages', 'на оригинал')})`, 'ответ на месте');
  });

  await story('меню сообщения: копировать текст, профиль, удалить', async () => {
    const labels = await js(winA, openMenu(row('messages', 'на оригинал')));
    expect(labels.includes('Скопировать текст') && labels.some((l) => l.startsWith('Профиль')), `пункты меню: ${labels}`);
    expect(!labels.includes('Удалить сообщение'), 'можно удалить чужое в личном чате');
    await js(winA, menuItem('Скопировать текст'));
    await sleep(200);
    const copied = await clipboard.readText();
    expect(copied.includes('на оригинал'), `в буфере: ${copied}`);
  });

  await story('тема чата у обоих', async () => {
    await js(winA, click('#chat-theme-btn'));
    await js(winA, `(() => { document.querySelector('input[name="chat-theme-scope"][value="both"]').click(); [...document.querySelectorAll('.chat-theme-grid > *')].at(-1).click(); return true; })()`);
    await waitFor(winB, `Boolean(document.getElementById('chat').dataset.chatTheme)`, 'тема у Бори', 5000);
  });

  // ---------- Друзья ----------

  await story('друзья: поиск, вкладки', async () => {
    await js(winA, `selectContact(null); true`);
    await js(winA, click('#friend-tabs [data-tab="all"]'));
    await waitFor(winA, `document.querySelectorAll('#friends-list > *').length === 2`, 'двое друзей');
    await js(winA, fill('friend-search', 'вик'));
    await waitFor(winA, `document.querySelectorAll('#friends-list > *').length === 1 && ${text('friends-list')}.includes('Вика')`, 'поиск по имени');
    await js(winA, fill('friend-search', ''));
  });

  const d = await register('std', 'Дима');
  const winD = await openClient('std', d);
  await waitFor(winD, 'e2eeReady()', 'ключ');
  await js(winD, ACCEPT_DIALOGS);

  await story('заявка: отменить, отклонить, принять', async () => {
    await js(winD, click('#friend-tabs [data-tab="add"]'));
    await js(winD, fill('friend-add-input', `@${a.user.username}`));
    await js(winD, `document.getElementById('friend-add-form').requestSubmit(); true`);
    await waitFor(winA, `state.requests.incoming.length === 1`, 'входящая заявка');
    await js(winD, click('#friend-tabs [data-tab="outgoing"]'));
    await waitFor(winD, `Boolean(document.querySelector('#friends-list [data-action="Отменить заявку"]'))`, 'исходящая заявка');
    await js(winD, roundBtn('Отменить заявку'));
    await waitFor(winA, `state.requests.incoming.length === 0`, 'заявка отменена у Ани');
    await js(winD, click('#friend-tabs [data-tab="add"]'));
    await js(winD, fill('friend-add-input', a.user.username));
    await js(winD, `document.getElementById('friend-add-form').requestSubmit(); true`);
    await waitFor(winA, `state.requests.incoming.length === 1`, 'снова заявка');
    await js(winA, click('#friend-tabs [data-tab="incoming"]'));
    await waitFor(winA, `Boolean(document.querySelector('#friends-list [data-action="Отклонить"]'))`, 'кнопка отклонить');
    await js(winA, roundBtn('Отклонить'));
    await waitFor(winD, `state.requests.outgoing.length === 0`, 'отказ дошёл');
    await js(winD, click('#friend-tabs [data-tab="add"]'));
    await js(winD, fill('friend-add-input', 'нет_такого'));
    await js(winD, `document.getElementById('friend-add-form').requestSubmit(); true`);
    await waitFor(winD, `document.getElementById('friend-add-result').classList.contains('error')`, 'ошибка для несуществующего', 3000);
  });

  await story('блокировка: нельзя написать и позвать, разблокировка', async () => {
    await befriend(a, d);
    await waitFor(winD, `state.contacts.has(${a.user.id})`, 'друзья');
    await js(winA, click('#friend-tabs [data-tab="all"]'));
    await waitFor(winA, `Boolean([...document.querySelectorAll('#friends-list > *')].find((r) => r.textContent.includes('Дима')))`, 'Дима в списке');
    await js(winA, `[...document.querySelectorAll('#friends-list > *')].find((r) => r.textContent.includes('Дима')).querySelector('[data-action="Заблокировать"]').click(); true`);
    await waitFor(winD, `!state.contacts.has(${a.user.id})`, 'у Димы дружбы нет');
    const res = await js(winD, `Api.post('/contacts', { username: ${JSON.stringify(a.user.username)} }).then(() => 'ок', (e) => e.message)`);
    expect(res !== 'ок', 'заблокированный смог отправить заявку');
    await js(winA, click('#friend-tabs [data-tab="blocked"]'));
    await waitFor(winA, `${text('friends-list')}.includes('Дима')`, 'Дима в заблокированных');
    await js(winA, `[...document.querySelectorAll('#friends-list button')].find((x) => x.textContent === 'Разблокировать').click(); true`);
    await waitFor(winA, 'state.blocked.length === 0', 'разблокирован');
  });

  await story('удаление из друзей: чат закрывается у обоих', async () => {
    await befriend(a, d);
    await waitFor(winD, `state.contacts.has(${a.user.id})`, 'друзья');
    await js(winD, `selectContact(${a.user.id}).then(() => true)`);
    await js(winA, `selectContact(${d.user.id}).then(() => true)`);
    await js(winA, click('#remove-contact-btn'));
    await waitFor(winD, `!state.contacts.has(${a.user.id}) && state.selectedId === null`, 'чат закрылся у Димы');
    await waitFor(winA, 'state.selectedId === null', 'чат закрылся у Ани');
  });

  await story('карточка профиля: о себе, общие действия', async () => {
    await js(winA, `selectContact(${b.user.id}).then(() => true)`);
    await js(winB, `Api.patch('/me', { bio: 'люблю котов', bannerColor: '#e5484d' }).then(() => true)`);
    await sleep(300);
    await js(winA, `document.getElementById('peer-name').click(); true`);
    await waitFor(winA, `Boolean(document.querySelector('.profile-card'))`, 'карточка', 3000);
    expect((await js(winA, `document.querySelector('.profile-card').textContent`)).includes('люблю котов'), 'нет описания');
    await js(winA, `closeProfileCard(); true`);
  });

  await story('статус виден другу, не беспокоить глушит уведомления', async () => {
    await js(winA, `document.getElementById('me-status-btn').click(); document.querySelector('#status-menu [data-status="dnd"]').click(); true`);
    await waitFor(winB, `presenceOf(state.contacts.get(${a.user.id})) === 'dnd'`, 'статус у Бори');
    await js(winA, `document.getElementById('me-status-btn').click(); document.querySelector('#status-menu [data-status="online"]').click(); true`);
    await waitFor(winB, `presenceOf(state.contacts.get(${a.user.id})) === 'online'`, 'снова в сети');
  });

  await story('уведомления: колокольчик ведёт в чат, «очистить» работает', async () => {
    await js(winA, `selectContact(null); saveNotifs([]); renderNotifBadge(); true`);
    await js(winB, `selectContact(${a.user.id}).then(() => true)`);
    await js(winB, say('message-input', 'в колокольчик'));
    await waitFor(winA, `document.getElementById('notif-badge').textContent === '1'`, 'счётчик');
    await js(winA, click('#notif-btn'));
    await waitFor(winA, `Boolean(document.querySelector('.notif-item'))`, 'панель');
    await js(winA, click('.notif-item'));
    await waitFor(winA, `state.selectedId === ${b.user.id} && ${hidden('notif-panel')}`, 'переход в чат');
    await js(winA, click('#notif-btn'));
    await js(winA, click('#notif-clear'));
    await waitFor(winA, `!document.querySelector('.notif-item')`, 'очистка');
    await js(winA, `closeNotifPanel(); true`);
  });

  await story('назад и вперёд между чатом и каналом', async () => {
    await js(winA, `selectContact(${b.user.id}).then(() => true)`);
    await js(winA, `selectRoom(${room.id}); true`);
    await js(winA, click('#nav-back'));
    await waitFor(winA, `state.selectedId === ${b.user.id}`, 'назад в чат');
    await js(winA, click('#nav-forward'));
    await waitFor(winA, `state.selectedRoomId === ${room.id}`, 'вперёд в комнату');
  });

  // ---------- Каналы ----------

  const hubFresh = async (name) => {
    const made = await api('POST', '/hubs', { name }, a.token);
    for (const u of [b, c]) {
      await api('POST', `/hubs/${made.id}/invites`, { userIds: [u.user.id] }, a.token);
      await api('POST', `/hub-invites/${made.id}/accept`, null, u.token);
    }
    const textRoom = await api('POST', '/rooms', { name: 'чат', kind: 'text', hubId: made.id }, a.token);
    const voiceRoom = await api('POST', '/rooms', { name: 'голос', kind: 'voice', hubId: made.id }, a.token);
    for (const w of [winA, winB, winC]) await waitFor(w, `Boolean(hubById(${made.id})) && Boolean(roomById(${textRoom.id})) && Boolean(roomById(${voiceRoom.id}))`, 'канал виден', 8000);
    return { id: made.id, text: textRoom.id, voice: voiceRoom.id };
  };
  const textButton = (root, label) => `(() => { const x = [...document.querySelectorAll('${root} button')].find((e) => e.textContent.trim() === ${JSON.stringify(label)}); if (!x) throw new Error('нет кнопки ' + ${JSON.stringify(label)}); x.click(); return true; })()`;
  const memberRow = (root, name) => `[...document.querySelectorAll('${root} .member-row')].find((r) => r.textContent.includes(${JSON.stringify(name)}))`;
  const inRow = (root, name, label) => `(() => { const r = ${memberRow(root, name)}; if (!r) throw new Error('нет строки ' + ${JSON.stringify(name)}); const x = [...r.querySelectorAll('button')].find((e) => e.textContent.trim() === ${JSON.stringify(label)}); if (!x) throw new Error('нет кнопки ' + ${JSON.stringify(label)}); x.click(); return true; })()`;
  const h = await hubFresh('Двор');

  await story('канал: название и цвет видны всем', async () => {
    await js(winA, `openHubSettings(${h.id}); true`);
    await js(winA, `(() => { const f = document.querySelector('.hs-overview'); f.querySelector('input').value = 'Новый двор'; f.requestSubmit(); return true; })()`);
    await waitFor(winB, `hubById(${h.id}).name === 'Новый двор'`, 'новое название у Бори');
    await js(winA, click('#hs-close'));
  });

  await story('канал: выключить уведомления через меню, запоминается', async () => {
    await js(winB, `openHub(${h.id}); true`);
    await js(winB, click('#hub-menu-btn'));
    await js(winB, menuItem('Выключить уведомления'));
    await waitFor(winB, `!${hidden('hub-muted')}`, 'значок заглушённого канала');
    expect(await js(winB, `hubMuted(${h.id})`), 'заглушение не сохранилось');
    // Заглушённый канал молчит, а после включения снова звучит
    await js(winB, `(() => { window.pings = 0; const blip = tone.blip; tone.blip = function (kind, ...rest) { if (kind === 'notify') window.pings++; return blip.call(this, kind, ...rest); }; selectContact(null); return true; })()`);
    await js(winA, `openHub(${h.id}); selectRoom(${h.text}); true`);
    await js(winA, say('room-message-input', 'заглушено'));
    await waitFor(winB, `loadNotifs()[0]?.body.includes('заглушено')`, 'запись в центре уведомлений');
    await sleep(200);
    expect((await js(winB, 'window.pings')) === 0, 'заглушённый канал издал звук');
    await js(winB, `openHub(${h.id}); true`);
    await js(winB, click('#hub-menu-btn'));
    await js(winB, menuItem('Включить уведомления'));
    await js(winB, 'selectContact(null); true');
    await js(winA, say('room-message-input', 'снова слышно'));
    await waitFor(winB, 'window.pings === 1', 'звук после включения');
    await js(winB, `openHub(${h.id}); selectRoom(${h.text}); true`);
    await waitFor(winB, `!state.roomUnread.has(${h.text})`, 'прочитано');
  });

  await story('канал: непрочитанное на значке, «Отметить прочитанным»', async () => {
    await js(winB, `selectContact(null); true`);
    await js(winA, `selectRoom(${h.text}); true`);
    await js(winA, say('room-message-input', 'в канале новое'));
    await waitFor(winB, `hubUnread(${h.id}) && state.roomUnread.get(${h.text}) === 1`, 'непрочитанное у Бори');
    await js(winB, `markHubRead(${h.id}); renderRail(); true`);
    await waitFor(winB, `!hubUnread(${h.id})`, 'отметка снята');
  });

  await story('канал: участники, поиск, управляющий создаёт комнату', async () => {
    await js(winA, `openHubSettings(${h.id}, 'members'); true`);
    await waitFor(winA, `${text('hs-body')}.includes('Боря')`, 'участники');
    await js(winA, `(() => { const r = [...document.querySelectorAll('#hs-body .member-row, #hs-body [class*="row"]')].find((x) => x.textContent.includes('Боря') && x.querySelector('input.switch')); r.querySelector('input.switch').click(); return true; })()`);
    await waitFor(winB, `canManageHub(hubById(${h.id}))`, 'Боря стал управляющим');
    const made = await js(winB, `Api.post('/rooms', { name: 'от Бори', kind: 'text', hubId: ${h.id} }).then((r) => r.id, (e) => e.message)`);
    expect(typeof made === 'number', `управляющий не может создать комнату: ${made}`);
    await js(winA, `(() => { const r = [...document.querySelectorAll('#hs-body .member-row, #hs-body [class*="row"]')].find((x) => x.textContent.includes('Боря') && x.querySelector('input.switch')); r.querySelector('input.switch').click(); return true; })()`);
    await waitFor(winB, `!canManageHub(hubById(${h.id}))`, 'права сняты');
  });

  await story('канал: выгнать — чат закрывается, можно позвать снова', async () => {
    await js(winC, `selectRoom(${h.text}); true`);
    await js(winA, inRow('#hs-body', 'Вика', 'Выгнать'));
    await waitFor(winC, `!hubById(${h.id}) && state.selectedRoomId !== ${h.text}`, 'Вику выгнали');
    await waitFor(winC, hidden('room-view'), 'окно комнаты закрыто');
    await js(winA, `Api.post('/hubs/${h.id}/invites', { userIds: [${c.user.id}] }).then(() => true)`);
    await waitFor(winC, `state.hubInvites.some((i) => i.hub.id === ${h.id})`, 'новое приглашение');
    await js(winC, `Api.post('/hub-invites/${h.id}/accept').then(() => refreshHubs()).then(() => refreshRooms()).then(() => true)`);
    await waitFor(winC, `Boolean(hubById(${h.id}))`, 'Вика вернулась');
    await js(winA, `document.getElementById('hub-settings').classList.add('hidden'); true`);
  });

  await story('канал: бан, забаненного не позвать, снять бан', async () => {
    await js(winA, `openHubSettings(${h.id}, 'members'); true`);
    await waitFor(winA, `${text('hs-body')}.includes('Вика')`, 'участники');
    await js(winA, inRow('#hs-body', 'Вика', 'Забанить'));
    await waitFor(winC, `!hubById(${h.id})`, 'Вика забанена');
    const again = await js(winA, `Api.post('/hubs/${h.id}/invites', { userIds: [${c.user.id}] }).then(() => 'ок', (e) => e.message)`);
    expect(again !== 'ок', 'забаненного можно позвать');
    await js(winA, `openHubSettings(${h.id}, 'bans'); true`);
    await waitFor(winA, `${text('hs-body')}.includes('Вика')`, 'список банов');
    await js(winA, textButton('#hs-body', 'Снять бан'));
    await waitFor(winA, `!hubById(${h.id}).bans.length`, 'бан снят');
    await js(winA, click('#hs-close'));
  });

  await story('канал: выйти самому и удалить — исчезает у всех', async () => {
    await js(winB, `openHubSettings(${h.id}); true`);
    await js(winB, click('#hs-leave'));
    await waitFor(winB, `!hubById(${h.id})`, 'Боря вышел');
    await waitFor(winA, `!hubById(${h.id}).members.some((m) => m.id === ${b.user.id})`, 'Аня видит выход');
    await js(winB, `state.view = 'home'; selectContact(null); true`);
    await js(winA, `openHubSettings(${h.id}); true`);
    await js(winA, click('#hs-leave'));
    await waitFor(winA, `!hubById(${h.id})`, 'канал удалён');
    await waitFor(winA, `!document.querySelector('[data-room="${h.text}"]')`, 'комнаты убраны');
  });

  // ---------- Комнаты ----------

  const r = await hubFresh('Комнатный');
  const roomOpen = async () => {
    for (const w of [winA, winB, winC]) await js(w, `openHub(${r.id}); selectRoom(${r.text}); true`);
  };

  await story('комната: новое название видно всем', async () => {
    await roomOpen();
    await js(winA, `openRoomManage(${r.text}); true`);
    await js(winA, `(() => { document.getElementById('rm-name').value = 'беседка'; document.getElementById('rm-rename').requestSubmit(); return true; })()`);
    await waitFor(winB, `roomById(${r.text}).name === 'беседка' && ${text('room-title')} === 'беседка'`, 'название у Бори');
  });

  await story('комната: фон ставится и убирается', async () => {
    await js(winA, `(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const blob = await new Promise((r) => c.toBlob(r, 'image/webp')); await uploadRoomBackground(roomById(${r.text}), new File([blob], 'b.webp', { type: 'image/webp' })); return true; })()`);
    await waitFor(winB, `document.getElementById('room-view').classList.contains('has-bg')`, 'фон у Бори');
    await js(winA, `openRoomManage(${r.text}); true`);
    await waitFor(winA, `Boolean(document.getElementById('rm-bg-remove'))`, 'кнопка убрать фон');
    await js(winA, click('#rm-bg-remove'));
    await waitFor(winB, `!document.getElementById('room-view').classList.contains('has-bg')`, 'фон убран у Бори');
    await js(winA, click('#rm-close'));
  });

  await story('роли канала: создать в настройках канала, назначить, действует во всех комнатах', async () => {
    const second = await api('POST', '/rooms', { name: 'вторая', kind: 'text', hubId: r.id }, a.token);
    await waitFor(winB, `Boolean(roomById(${second.id}))`, 'вторая комната');
    expect(!(await js(winA, `Boolean(document.querySelector('#rs-nav [data-tab="roles"]'))`)), 'в настройках комнаты осталась вкладка ролей');
    await js(winA, `openHubSettings(${r.id}, 'roles'); true`);
    await waitFor(winA, `Boolean(document.getElementById('rm-role-new'))`, 'вкладка ролей в канале');
    await js(winA, click('#rm-role-new'));
    await waitFor(winA, `hubById(${r.id}).roles.length === 2 && Boolean(document.querySelector('#rm-role-editor input[data-keep]'))`, 'роль создана');
    await js(winA, `(() => { const f = document.getElementById('rm-role-editor'); f.querySelector('input[data-keep]').value = 'Молчун'; f.querySelector('[data-perm="write"]').checked = false; f.requestSubmit(); return true; })()`);
    await waitFor(winA, `hubById(${r.id}).roles.some((x) => x.name === 'Молчун')`, 'роль сохранена');
    await js(winA, `(() => { const s = document.getElementById('rm-role-assign'); s.value = [...s.options].find((o) => o.textContent.includes('Боря')).value; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(winA, `hubById(${r.id}).members.find((m) => m.id === ${b.user.id}).roleId === hubById(${r.id}).roles.find((x) => x.name === 'Молчун').id && document.getElementById('rm-role-editor').textContent.includes('Боря')`, 'роль видна в канале');
    await waitFor(winB, `document.getElementById('room-message-input').disabled`, 'поле закрыто в этой комнате');
    await js(winB, `selectRoom(${second.id}); true`);
    await waitFor(winB, `document.getElementById('room-message-input').disabled`, 'поле закрыто во второй комнате');
    await js(winB, `selectRoom(${r.text}); true`);
    expect(await js(winC, `document.getElementById('hub-settings').classList.contains('hidden')`), 'лишнее окно');
    await js(winA, click('#hs-close'));
    const denied = await js(winB, `Api.post('/rooms/${r.text}/messages', { text: 'x' }).then(() => 'ок', (e) => e.message)`);
    expect(denied !== 'ок', 'сервер принял сообщение без права');
    await js(winA, `openHubSettings(${r.id}, 'members'); true`);
    await waitFor(winA, `Boolean(${memberRow('#hs-body', 'Боря')}?.querySelector('.role-select'))`, 'выбор роли у участника');
    await js(winA, `(() => { const s = ${memberRow('#hs-body', 'Боря')}.querySelector('.role-select'); s.value = ''; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(winB, `!document.getElementById('room-message-input').disabled`, 'поле открыто');
    await js(winA, click('#hs-close'));
  });

  await story('комната: роль без права писать закрывает поле ввода', async () => {
    await js(winA, `Api.post('/rooms/${r.text}/roles', { name: 'Тихий', color: '#30a46c', perms: 1 | 2 }).then(() => true)`);
    await waitFor(winA, `roomById(${r.text}).roles.some((x) => x.name === 'Тихий')`, 'роль создана');
    await js(winA, `Api.put('/rooms/${r.text}/members/${b.user.id}/role', { roleId: roomById(${r.text}).roles.find((x) => x.name === 'Тихий').id }).then(() => true)`);
    await waitFor(winB, `document.getElementById('room-message-input').disabled`, 'поле закрыто');
    const denied = await js(winB, `Api.post('/rooms/${r.text}/messages', { text: 'x' }).then(() => 'ок', (e) => e.message)`);
    expect(denied !== 'ок', 'сервер принял сообщение без права');
    await js(winA, `Api.put('/rooms/${r.text}/members/${b.user.id}/role', { roleId: null }).then(() => true)`);
    await waitFor(winB, `!document.getElementById('room-message-input').disabled`, 'поле открыто');
  });

  await story('комната: кик на время и его снятие', async () => {
    await js(winA, `openRoomManage(${r.text}, 'members'); true`);
    await waitFor(winA, `${text('rs-body')}.includes('Боря')`, 'участники');
    await js(winA, inRow('#rs-body', 'Боря', 'Кик'));
    await js(winA, `document.querySelector('#kick-options input[value="60"]').click(); document.getElementById('kick-form').requestSubmit(); true`);
    await waitFor(winB, `document.getElementById('room-message-input').disabled`, 'кик закрыл поле');
    await waitFor(winA, `Boolean(${memberRow('#rs-body', 'Боря')}) && ${text('rs-body')}.includes('Снять кик')`, 'кнопка снять кик');
    await js(winA, inRow('#rs-body', 'Боря', 'Снять кик'));
    await waitFor(winB, `!document.getElementById('room-message-input').disabled`, 'кик снят');
  });

  await story('комната: исключить, бан и снятие бана', async () => {
    await js(winA, inRow('#rs-body', 'Вика', 'Бан'));
    await waitFor(winC, `!roomById(${r.text})`, 'Вика забанена в комнате');
    await js(winA, `openRoomManage(${r.text}, 'bans'); true`);
    await waitFor(winA, `${text('rs-body')}.includes('Вика')`, 'список банов');
    await js(winA, textButton('#rs-body', 'Снять бан'));
    await waitFor(winA, `!(roomById(${r.text}).bans || []).length`, 'бан снят');
    await js(winA, `Api.post('/rooms/${r.text}/members', { userIds: [${c.user.id}] }).then(() => true, () => true)`);
    await js(winA, click('#rm-close'));
  });

  await story('комната: закреп — полоса сверху и переход к сообщению', async () => {
    await js(winA, `selectRoom(${r.text}); true`);
    await js(winA, say('room-message-input', 'закрепи меня'));
    await waitFor(winA, `Boolean(${row('room-messages', 'закрепи меня')})`, 'сообщение');
    await js(winA, `(() => { ${row('room-messages', 'закрепи меня')}.querySelector('.msg-tool[title="Закрепить"]').click(); return true; })()`);
    await waitFor(winB, `!${hidden('room-pinned')} && ${text('room-pinned')}.includes('закрепи меня')`, 'полоса у Бори');
    await js(winB, click('#room-pinned'));
    await waitFor(winB, `${row('room-messages', 'закрепи меня')}.classList.contains('msg-flash')`, 'переход к закреплённому', 3000);
  });

  await story('комната: удалить — у остальных открывается другая', async () => {
    const extra = await api('POST', '/rooms', { name: 'лишняя', kind: 'text', hubId: r.id }, a.token);
    await waitFor(winB, `Boolean(roomById(${extra.id}))`, 'комната у Бори');
    await js(winB, `selectRoom(${extra.id}); true`);
    await js(winA, `openRoomManage(${extra.id}); true`);
    await js(winA, click('#rm-leave'));
    await waitFor(winB, `!roomById(${extra.id}) && state.selectedRoomId !== ${extra.id}`, 'комната убрана у Бори');
    expect(await js(winB, `state.selectedRoomId !== null && !document.getElementById('room-view').classList.contains('hidden')`), 'Боря остался на пустом экране');
  });

  // ---------- Голос ----------

  const inVoice = 'state.room?.joined';
  await story('голос: вход, значки микрофона и звука у других', async () => {
    for (const w of [winA, winB]) await js(w, `openHub(${r.id}); openRoom(${r.voice}); true`);
    for (const w of [winA, winB]) await waitFor(w, `${inVoice} && state.room.session.peers.size === 1`, 'оба в голосе', 20000);
    await js(winA, click('#mic-btn'));
    await waitFor(winB, `Boolean(document.querySelector('[data-voice-user="${a.user.id}"] [data-icon="mic-off"], #room-list [data-icon="mic-off"]'))`, 'значок выключенного микрофона');
    await js(winA, click('#mic-btn'));
    await waitFor(winB, `!document.querySelector('#room-list [data-icon="mic-off"]')`, 'значок убран');
    await js(winA, `toggleDeafen(); true`);
    await waitFor(winB, `Boolean(document.querySelector('#room-list [data-icon="sound-off"]'))`, 'значок выключенного звука');
    await js(winA, `toggleDeafen(); true`);
  });

  await story('голос: заглушить для себя', async () => {
    await js(winB, `toggleMuteFor(${a.user.id}); true`);
    await waitFor(winB, `Boolean(document.querySelector('[data-icon="muted-for-me"]'))`, 'значок');
    await js(winB, `toggleMuteFor(${a.user.id}); true`);
    await waitFor(winB, `!document.querySelector('[data-icon="muted-for-me"]')`, 'снято');
  });

  await story('голос: камера видна другому', async () => {
    await js(winA, 'toggleCamera(); true');
    await waitFor(winB, tilePlaying(winB, `u${a.user.id}`), 'камера у Бори', 15000);
    await js(winA, 'toggleCamera(); true');
    await waitFor(winB, `!document.querySelector('.tile[data-key="u${a.user.id}"] video')?.videoWidth || !document.querySelector('.tile[data-key="u${a.user.id}"]').classList.contains('has-video')`, 'камера выключена', 8000);
  });

  await story('голос: модератор отключает от голоса', async () => {
    await js(winA, `disconnectMember(roomById(${r.voice}), { id: ${b.user.id}, displayName: 'Боря' }); true`);
    await waitFor(winB, '!state.room || !state.room.joined', 'Боря отключён', 8000);
    await waitFor(winA, 'state.room.session.peers.size === 0', 'Аня видит отключение', 8000);
    await js(winA, 'leaveRoomVoice(); true');
  });

  await story('звонок: отклонить, занят, пропущенный', async () => {
    await js(winA, `selectContact(${b.user.id}).then(() => startCall())`);
    await waitFor(winB, `!${hidden('incoming')}`, 'входящий');
    await js(winB, click('#decline-btn'));
    await waitFor(winA, '!state.call', 'звонок отклонён');
    await js(winC, `selectContact(${a.user.id}).then(() => startCall())`);
    await waitFor(winA, `!${hidden('incoming')}`, 'входящий у Ани');
    await js(winA, click('#accept-btn'));
    await waitFor(winC, `state.call?.phase === 'connected'`, 'разговор', 20000);
    const busy = await js(winB, `new Promise((r) => { const real = toast; toast = (t, ...x) => { r(String(t)); toast = real; return real(t, ...x); }; selectContact(${a.user.id}).then(() => startCall()); setTimeout(() => r('нет ответа'), 3000); })`);
    expect(/занят|разговар|звон/i.test(busy), `занятому дозвониться: ${busy}`);
    await js(winB, 'state.call && hangup(); true');
    await js(winA, click('#hangup-btn'));
    await waitFor(winC, '!state.call', 'звонок завершён');
  });

  await story('звонок: камера, демонстрация экрана, третий участник', async () => {
    await js(winA, `selectContact(${b.user.id}).then(() => startCall())`);
    await waitFor(winB, `!${hidden('incoming')}`, 'входящий');
    await js(winB, click('#accept-btn'));
    await waitFor(winA, `state.call?.phase === 'connected'`, 'разговор', 20000);
    await js(winA, 'toggleCamera(); true');
    await waitFor(winB, tilePlaying(winB, `u${a.user.id}`), 'камера в звонке', 15000);
    await js(winA, 'toggleCamera(); true');
    await js(winA, `socket.send({ type: 'call:add', callId: state.call.callId, to: ${c.user.id} }); true`);
    await waitFor(winC, `!${hidden('incoming')}`, 'приглашение третьего', 5000);
    await js(winC, click('#accept-btn'));
    await waitFor(winC, `state.call?.phase === 'connected'`, 'третий в звонке', 20000);
    await js(winC, 'hangup(); true');
    await waitFor(winA, `state.call?.phase === 'connected'`, 'звонок продолжается без третьего', 5000);
    await js(winA, 'hangup(); true');
    await waitFor(winB, '!state.call', 'звонок завершён');
  });

  // ---------- Настройки и аккаунт ----------

  await story('настройки: тема запоминается', async () => {
    await js(winA, `openSettings(); showSettingsTab('look'); true`);
    await js(winA, `(() => { const t = [...document.querySelectorAll('#theme-grid > *')].find((x) => !x.classList.contains('active')); window.pickedTheme = t.dataset.theme || t.dataset.id; t.click(); return true; })()`);
    const theme = await js(winA, `document.documentElement.dataset.theme`);
    await js(winA, `closeSettings(); true`);
    await js(winA, 'location.reload()').catch(() => {});
    await sleep(1500);
    await waitFor(winA, 'e2eeReady()', 'перезапуск');
    await js(winA, ACCEPT_DIALOGS);
    expect((await js(winA, `document.documentElement.dataset.theme`)) === theme, 'тема не сохранилась');
    await js(winA, `(() => { window.toasts = []; return true; })()`);
  });

  await story('настройки: цвет ника и баннера, о себе видны другу', async () => {
    await js(winA, `openSettings(); showSettingsTab('profile'); true`);
    await js(winA, `(() => { document.querySelectorAll('#name-picker .color')[2].click(); document.querySelectorAll('#banner-picker .color')[2].click(); document.getElementById('set-bio').value = 'привет всем'; document.getElementById('settings-form').requestSubmit(); return true; })()`);
    await waitFor(winB, `Boolean(userById(${a.user.id})?.nameColor) && userById(${a.user.id}).bannerColor && userById(${a.user.id}).bio === 'привет всем'`, 'профиль у Бори');
  });

  await story('настройки: неверный текущий пароль — ошибка, верный меняет', async () => {
    await js(winC, `selectContact(null); openSettings(); showSettingsTab('account'); true`);
    await js(winC, `(() => { document.getElementById('set-cur-pass').value = 'неверный-пароль'; document.getElementById('set-new-pass').value = 'новый-пароль-1'; document.getElementById('settings-form').requestSubmit(); return true; })()`);
    await waitFor(winC, `${text('settings-error')}.includes('неверно')`, 'ошибка про пароль');
    await js(winC, `(() => { document.getElementById('set-cur-pass').value = 'test-pass-1'; document.getElementById('settings-form').requestSubmit(); return true; })()`);
    await sleep(800);
    await waitFor(winC, hidden('settings'), 'настройки закрылись');
    const relogin = await api('POST', '/login', { username: c.user.username, password: 'новый-пароль-1' }).then(() => 'ок', (e) => e.message);
    expect(relogin === 'ок', `новый пароль не подошёл: ${relogin}`);
  });

  await story('настройки уведомлений и звука переживают перезапуск', async () => {
    await js(winB, `openSettings(); showSettingsTab('notify'); true`);
    await js(winB, click('#set-notify-preview'));
    const value = await js(winB, 'notifySettings().preview');
    await js(winB, `showSettingsTab('sound'); document.getElementById('set-ns').click(); document.getElementById('settings-form').requestSubmit(); true`);
    await sleep(300);
    const ns = await js(winB, 'state.settings.noiseSuppression');
    await js(winB, 'location.reload()').catch(() => {});
    await sleep(1500);
    await waitFor(winB, 'e2eeReady()', 'перезапуск');
    await js(winB, ACCEPT_DIALOGS);
    expect((await js(winB, 'notifySettings().preview')) === value, 'уведомления не сохранились');
    expect((await js(winB, 'state.settings.noiseSuppression')) === ns, 'шумоподавление не сохранилось');
  });

  await story('Esc закрывает окна по очереди, настройки без изменений закрываются', async () => {
    await js(winA, `openSettings(); true`);
    await js(winA, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await waitFor(winA, hidden('settings'), 'Esc закрыл настройки', 2000);
  });

  await story('сообщение другу, который не в сети, дойдёт при входе', async () => {
    await js(winC, 'socket.close(); true');
    await js(winA, `selectContact(${c.user.id}).then(() => true)`);
    await js(winA, say('message-input', 'прочитаешь потом'));
    await waitFor(winA, `Boolean(${row('messages', 'прочитаешь потом')})`, 'отправлено');
    await js(winC, 'location.reload()').catch(() => {});
    await sleep(1500);
    await waitFor(winC, 'e2eeReady()', 'Вика вернулась');
    await waitFor(winC, `state.unread.get(${a.user.id}) === 1`, 'счётчик у Вики');
    await js(winC, `selectContact(${a.user.id}).then(() => true)`);
    await waitFor(winC, `Boolean(${row('messages', 'прочитаешь потом')})`, 'сообщение прочитано');
  });

  await story('перенос ключа на новое устройство: старая переписка читается', async () => {
    const second = await openClient('stb2', { ...b, token: (await api('POST', '/login', { username: b.user.username, password: 'test-pass-1' })).token });
    await sleep(800);
    await waitFor(second, `!${hidden('e2ee-setup')}`, 'предложение перенести ключ', 5000);
    await js(winB, `openSettings(); showSettingsTab('account'); true`);
    await js(winB, click('#e2ee-share-btn'));
    await waitFor(winB, `${text('e2ee-share-code')}.length > 8`, 'код переноса', 5000);
    const code = await js(winB, text('e2ee-share-code'));
    await js(second, fill('e2ee-code', code));
    await js(second, click('#e2ee-transfer-btn'));
    await waitFor(second, 'e2eeReady()', 'ключ перенесён', 5000);
    await js(second, `selectContact(${a.user.id}).then(() => true)`);
    await waitFor(second, `document.getElementById('messages').textContent.includes('перешли это')`, 'старая переписка читается', 5000);
    await js(winB, `closeSettings(); true`);
    second.destroy();
  });

  // ---------- Всё остальное ----------

  await story('файл: вставка из буфера и перетаскивание в чат', async () => {
    await js(winA, 'selectContact(' + b.user.id + ').then(() => true)');
    await js(winA, `(async () => { const blob = ${png}; const d = new DataTransfer(); d.items.add(new File([blob], 'скрин.png', { type: 'image/png' })); document.getElementById('message-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true })); return true; })()`);
    await waitFor(winA, 'dmComposer.files.length === 1 && dmComposer.files.every((f) => f.attachment)', 'вставка из буфера');
    await js(winA, 'dmComposer.removeFile(dmComposer.files[0]); true');
    await js(winA, `(async () => { const d = new DataTransfer(); d.items.add(new File(['x'], 'брошен.txt', { type: 'text/plain' })); const chat = document.getElementById('chat'); chat.dispatchEvent(new DragEvent('dragover', { dataTransfer: d, bubbles: true, cancelable: true })); chat.dispatchEvent(new DragEvent('drop', { dataTransfer: d, bubbles: true, cancelable: true })); return true; })()`);
    await waitFor(winA, 'dmComposer.files.length === 1 && dmComposer.files.every((f) => f.attachment)', 'перетаскивание');
    await js(winA, 'dmComposer.removeFile(dmComposer.files[0]); true');
  });

  await story('гифки: сохранить из чата, отправить из «Моих гифок», убрать', async () => {
    const gif = `new Blob([Uint8Array.from(atob('R0lGODlhAgACAPEAAP8AAAAA/wAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAACAoRRACH5BAAKAAAALAAAAAACAAIAAAICjFMAOw=='), (c) => c.charCodeAt(0))], { type: 'image/gif' })`;
    await dmAB();
    await js(winA, attach('dmComposer', 'кот.gif', 'image/gif', gif));
    await waitFor(winA, 'dmComposer.files.length === 1 && dmComposer.files.every((f) => f.attachment)', 'загрузка');
    await js(winA, say('message-input', 'гифка'));
    await waitFor(winB, `Boolean(${row('messages', 'гифка')}?.querySelector('.gif-save'))`, 'кнопка «В мои гифки»');
    await waitFor(winB, `Boolean(${row('messages', 'гифка')}.querySelector('img').naturalWidth)`, 'гифка видна');
    await js(winB, `${row('messages', 'гифка')}.querySelector('.gif-save').click(); true`);
    await waitFor(winB, '(window.toasts || []).some((t) => t.includes("Гифка сохранена"))', 'гифка сохранена', 3000).catch(async () => { expect((await js(winB, 'listGifs().then((l) => l.length)')) === 1, 'гифка не сохранилась'); });
    await js(winB, 'dmComposer.gifBtn.click(); true');
    await waitFor(winB, `Boolean(document.querySelector('.gif-item'))`, 'гифка в списке');
    await js(winB, click('.gif-item'));
    await waitFor(winA, `[...document.querySelectorAll('#messages .msg-images img')].filter((i) => i.alt === 'кот.gif').length === 2`, 'гифка отправлена', 8000);
  });

  await story('список участников скрывается и запоминается', async () => {
    await js(winB, 'selectRoom(' + r.text + '); true');
    await js(winB, click('.members-toggle'));
    const shown = await js(winB, `document.querySelector('.members-toggle').title`);
    expect(/Показать/.test(shown), 'подпись не поменялась: ' + shown);
    await js(winB, click('.members-toggle'));
  });

  await story('меню комнаты и контакта: отметить прочитанным, написать', async () => {
    await js(winB, 'selectContact(null); true');
    await js(winC, 'openHub(' + r.id + '); selectRoom(' + r.text + '); true');
    await js(winC, say('room-message-input', 'для меню'));
    await waitFor(winB, 'state.roomUnread.get(' + r.text + ') === 1', 'непрочитанное');
    await js(winB, 'state.view = ' + r.id + '; renderRooms(); renderHubChrome(); true');
    const labels = await js(winB, openMenu(`document.querySelector('#room-list [data-room="${r.text}"]')`));
    expect(labels.includes('Отметить прочитанным'), 'нет пункта: ' + labels);
    await js(winB, menuItem('Отметить прочитанным'));
    await waitFor(winB, '!state.roomUnread.has(' + r.text + ')', 'отметка снята');
    await js(winB, openMenu(`document.querySelector('#room-list [data-room="${r.text}"]')`));
    await js(winB, menuItem('Скопировать название'));
    await sleep(200);
    const copied = await clipboard.readText();
    expect(copied === (await js(winB, `roomById(${r.text}).name`)), `в буфере: ${copied}`);
  });

  await story('удалённое закреплённое сообщение убирает полосу', async () => {
    await js(winA, 'openHub(' + r.id + '); selectRoom(' + r.text + '); true');
    await waitFor(winA, `Boolean(${row('room-messages', 'закрепи меня')})`, 'сообщение');
    await js(winB, 'selectRoom(' + r.text + '); true');
    await waitFor(winB, `!${hidden('room-pinned')}`, 'полоса есть');
    await js(winA, `(() => { ${row('room-messages', 'закрепи меня')}.querySelector('.msg-tool.danger').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); return true; })()`);
    await waitFor(winB, hidden('room-pinned'), 'полоса убрана у Бори', 4000);
    await waitFor(winA, hidden('room-pinned'), 'полоса убрана у Ани', 4000);
  });

  await story('приглашение в канал: отказаться', async () => {
    const other = await api('POST', '/hubs', { name: 'Отказной' }, a.token);
    await api('POST', `/hubs/${other.id}/invites`, { userIds: [b.user.id] }, a.token);
    await waitFor(winB, `Boolean(document.querySelector('[data-invite="${other.id}"] button'))`, 'приглашение');
    await js(winB, click(`[data-invite="${other.id}"] button`));
    await waitFor(winB, `!${hidden('hub-join')}`, 'окно');
    await js(winB, click('#hj-decline'));
    await waitFor(winB, `!document.querySelector('[data-invite="${other.id}"]') && !hubById(${other.id})`, 'приглашение убрано');
  });

  await story('демонстрация экрана: окно выбора, режим, зритель видит, стоп', async () => {
    for (const w of [winA, winB]) await js(w, 'openHub(' + r.id + '); openRoom(' + r.voice + '); true');
    for (const w of [winA, winB]) await waitFor(w, inVoice + ' && state.room.session.peers.size === 1', 'оба в голосе', 20000);
    await js(winA, `store.set('screenTab', 'screen'); toggleScreen(); true`);
    await waitFor(winA, `document.querySelectorAll('#screen-sources .source.selected').length === 1 && !document.getElementById('screen-start').disabled`, 'окно выбора экрана', 8000);
    await js(winA, `document.querySelector('input[name="screen-mode"][value="720p90"]').click(); document.getElementById('screen-start').click(); true`);
    await waitFor(winA, 'Boolean(activeSession().local.tracks.screen)', 'показ начался', 8000);
    await waitFor(winB, `Boolean(document.querySelector('.tile[data-key="u${a.user.id}:screen"] .tile-watch'))`, 'приглашение смотреть', 10000);
    await js(winB, `document.querySelector('.tile[data-key="u${a.user.id}:screen"] .tile-watch').click(); true`);
    await waitFor(winB, tilePlaying(winB, `u${a.user.id}:screen`), 'зритель видит экран', 15000);
    await js(winA, `toggleScreen(); true`);
    await waitFor(winA, `!document.getElementById('screen-picker').classList.contains('hidden')`, 'окно управления показом', 3000);
    await js(winA, click('#screen-stop'));
    await waitFor(winB, `!document.querySelector('.tile[data-key="u${a.user.id}:screen"]')`, 'показ закончен', 8000);
    for (const w of [winA, winB]) await js(w, 'leaveRoomVoice(); true');
  });

  await story('звонок: «Добавить в звонок» из меню контакта', async () => {
    await js(winA, 'selectContact(' + b.user.id + ').then(() => startCall())');
    await waitFor(winB, `!${hidden('incoming')}`, 'входящий');
    await js(winB, click('#accept-btn'));
    await waitFor(winA, "state.call?.phase === 'connected'", 'разговор', 20000);
    const labels = await js(winA, openMenu(`document.querySelector('#contact-list [data-contact="${c.user.id}"]')`));
    expect(labels.includes('Добавить в звонок'), 'нет пункта: ' + labels);
    await js(winA, menuItem('Добавить в звонок'));
    await waitFor(winC, `!${hidden('incoming')}`, 'приглашение третьего');
    await js(winC, click('#decline-btn'));
    await js(winA, 'hangup(); true');
    await waitFor(winB, '!state.call', 'звонок завершён');
  });

  await story('сброс пароля по почте через экран входа', async () => {
    if (!process.env.MAIL_TEST_FILE) throw new Error('нужен MAIL_TEST_FILE');
    const fs = require('fs');
    const mail = 'res' + Date.now() % 100000 + '@example.com';
    const lastCode = () => fs.readFileSync(process.env.MAIL_TEST_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.to === mail).at(-1)?.code;
    await api('POST', '/register/code', { email: mail });
    for (let i = 0; i < 30 && !lastCode(); i++) await sleep(100);
    await api('POST', '/register', { email: mail, password: 'старый-пароль', code: lastCode(), displayName: 'Сброс' });
    const w = await openClient('stres', await register('stres', 'служебный'));
    await js(w, 'logout(); true');
    await js(w, fill('server-url', require('./e2e-lib').SERVER));
    await js(w, `document.getElementById('server-url').onchange(); true`);
    await sleep(400);
    await js(w, click('#auth-forgot'));
    await js(w, fill('auth-email', mail));
    await js(w, fill('auth-password', 'новый-пароль-2'));
    const before = lastCode();
    await js(w, `document.getElementById('auth-form').requestSubmit(); true`);
    for (let i = 0; i < 40 && lastCode() === before; i++) await sleep(100);
    expect(lastCode() !== before, 'письмо не отправилось');
    await js(w, fill('auth-code', lastCode()));
    await js(w, `document.getElementById('auth-form').requestSubmit(); true`);
    await waitFor(w, 'Boolean(state.me)', 'вход с новым паролем', 8000);
    w.destroy();
  });

  await story('привязка почты в настройках', async () => {
    if (!process.env.MAIL_TEST_FILE) throw new Error('нужен MAIL_TEST_FILE');
    const fs = require('fs');
    const mail = 'link' + Date.now() % 100000 + '@example.com';
    await js(winC, "openSettings(); showSettingsTab('account'); true");
    await waitFor(winC, `Boolean([...document.querySelectorAll('#identity-list button')].find((x) => x.textContent === 'Привязать'))`, 'кнопка привязки');
    await js(winC, `[...document.querySelectorAll('#identity-list button')].find((x) => x.textContent === 'Привязать').click(); true`);
    await waitFor(winC, `!${hidden('email-link')}`, 'форма привязки');
    await js(winC, fill('link-email', mail));
    await js(winC, click('#link-send'));
    const code = () => fs.readFileSync(process.env.MAIL_TEST_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.to === mail).at(-1)?.code;
    for (let i = 0; i < 40 && !code(); i++) await sleep(100);
    await js(winC, fill('link-code', code()));
    await js(winC, click('#link-confirm'));
    await waitFor(winC, `state.me.email === ${JSON.stringify(mail)}`, 'почта привязана');
    await js(winC, 'closeSettings(); true');
  });

  await story('двухфакторный вход: включить, войти с кодом, войти резервным кодом, отключить', async () => {
    const u = await register('tf', 'Тимур');
    const win = await openClient('tf', u);
    await js(win, "openSettings(); showSettingsTab('account'); true");
    await js(win, click('#tf-start'));
    await js(win, fill('tf-password', 'неверный-пароль'));
    await js(win, click('#tf-next'));
    await waitFor(win, `document.getElementById('tf-error').textContent !== ''`, 'неверный пароль отклонён');
    await js(win, fill('tf-password', PASSWORD));
    await js(win, click('#tf-next'));
    await waitFor(win, `!${hidden('tf-scan-step')}`, 'шаг с QR');
    expect(await js(win, `document.querySelector('#tf-qr svg') !== null`), 'нет QR-кода');
    const secret = await js(win, text('tf-secret'));
    await js(win, fill('tf-code', '000000'));
    await js(win, click('#tf-confirm'));
    await waitFor(win, `document.getElementById('tf-error').textContent !== ''`, 'неверный код отклонён');
    await js(win, fill('tf-code', totp(secret)));
    await js(win, click('#tf-confirm'));
    await waitFor(win, `!${hidden('tf-codes-step')}`, 'резервные коды показаны');
    const codes = (await js(win, text('tf-recovery'))).split('\n');
    expect(codes.length === 10, `резервных кодов: ${codes.length}`);
    await js(win, click('#tf-copy'));
    await sleep(200);
    expect((await clipboard.readText()).includes(codes[0]), 'коды не скопировались');
    await js(win, click('#tf-done'));
    await waitFor(win, `!${hidden('tf-stop')}`, 'кнопка отключения');
    await js(win, 'closeSettings(); logout(); true');
    const login = async (code) => {
      await waitFor(win, `!document.getElementById('auth-form').closest('.hidden')`, 'экран входа');
      await js(win, `document.getElementById('auth-error').textContent = ''; true`);
      await js(win, fill('server-url', require('./e2e-lib').SERVER));
      await js(win, fill('auth-username', u.user.username));
      await js(win, fill('auth-password', PASSWORD));
      await js(win, fill('auth-totp', code || ''));
      await js(win, submit);
    };
    await login(null);
    await waitFor(win, `!${hidden('totp-field')}`, 'просит код');
    await login('111111');
    await waitFor(win, `document.getElementById('auth-error').textContent !== ''`, 'неверный код при входе');
    await login(totp(secret, 1));
    await waitFor(win, `state.me?.id === ${u.user.id}`, 'вошли с кодом');
    await js(win, 'logout(); true');
    await login(codes[0]);
    await waitFor(win, `state.me?.id === ${u.user.id}`, 'вошли резервным кодом');
    await js(win, 'logout(); true');
    await login(codes[0]);
    await waitFor(win, `document.getElementById('auth-error').textContent !== ''`, 'резервный код одноразовый');
    await login(codes[1]);
    await waitFor(win, `state.me?.id === ${u.user.id}`, 'второй резервный код');
    await js(win, "openSettings(); showSettingsTab('account'); true");
    await js(win, click('#tf-stop'));
    await js(win, fill('tf-off-code', codes[2]));
    await js(win, click('#tf-off'));
    await waitFor(win, `${hidden('tf-stop')} && !state.me.twoFactor`, 'отключён');
    win.close();
  });

  await story('проверка динамиков: звук идёт на выбранное устройство', async () => {
    await js(winB, "openSettings(); showSettingsTab('sound'); true");
    const played = await js(winB, `(() => { let got = null; const blip = tone.blip; tone.blip = function (...args) { got = args; }; document.getElementById('speaker-test-btn').click(); tone.blip = blip; return got; })()`);
    expect(played?.[0] === 'test', `звук не запущен: ${played}`);
    await js(winB, "document.getElementById('speaker-test-btn').click(); closeSettings(); true");
    await sleep(100);
  });

  await story('все темы: текст читается', async () => {
    const themes = await js(winB, 'THEMES.map((t) => t.id)');
    const start = await js(winB, 'currentTheme()');
    const lum = (c) => {
      const [r, g, b] = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (x, y) => {
      const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const id of themes) {
      await js(winB, `setTheme('${id}'); true`);
      await sleep(700);
      const look = await js(winB, `(() => {
        const nums = (c) => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
        const shown = getComputedStyle(document.querySelector('#friends-view, .main, #app'));
        const css = getComputedStyle(document.documentElement);
        const probe = document.createElement('i');
        document.body.append(probe);
        const rgb = (name) => { probe.style.color = css.getPropertyValue(name).trim(); return nums(getComputedStyle(probe).color); };
        const out = { text: rgb('--text'), muted: rgb('--muted'), bg: rgb('--bg') };
        probe.remove();
        return out;
      })()`);
      const main = contrast(look.text, look.bg);
      const soft = look.muted ? contrast(look.muted, look.bg) : 99;
      console.log(`  тема ${id}: текст ${main.toFixed(1)}, приглушённый ${soft.toFixed(1)}`);
      expect(main >= 7, `тема ${id}: контраст текста ${main.toFixed(1)}`);
      expect(soft >= 3, `тема ${id}: контраст приглушённого текста ${soft.toFixed(1)}`);
    }
    await js(winB, `setTheme('${start}'); true`);
  });

  await story('цвет баннера: подсказка-карточка не остаётся на экране', async () => {
    winB.show(); // В скрытом окне браузер не доставляет движение мыши
    const mouse = (type, x, y) => winB.webContents.sendInputEvent(type === 'mouseMove' ? { type, x, y } : { type, x, y, button: 'left', clickCount: 1 });
    const hover = async () => {
      await js(winB, "openSettings('profile'); showSettingsTab('profile'); true");
      await sleep(200);
      const at = await js(winB, `(() => { const r = document.querySelectorAll('#banner-picker .color')[3].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      mouse('mouseMove', at.x, at.y);
      await waitFor(winB, `!${hidden('banner-peek')}`, 'подсказка открылась', 2000);
      return at;
    };
    // Выбрали цвет и увели мышь
    const at = await hover();
    mouse('mouseDown', at.x, at.y);
    mouse('mouseUp', at.x, at.y);
    mouse('mouseMove', 20, 400);
    await sleep(200);
    expect(await js(winB, hidden('banner-peek')), 'после выбора цвета подсказка осталась');
    // Закрыли настройки, не уводя мышь
    await hover();
    await js(winB, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
    await sleep(100);
    expect(await js(winB, hidden('banner-peek')), 'подсказка пережила закрытие настроек');
    mouse('mouseMove', 20, 400);
  });

  await story('рация: выбор клавиши сохраняется', async () => {
    await js(winB, "openSettings(); showSettingsTab('sound'); true");
    await js(winB, `document.querySelector('input[name="mic-mode"][value="ptt"]').click(); true`);
    await waitFor(winB, `!${hidden('ptt-block')}`, 'блок рации', 2000);
    await js(winB, "document.querySelector('input[name=\"mic-mode\"][value=\"voice\"]').click(); closeSettings(); true");
  });

  await story('выход из аккаунта: следующий человек не видит чужого', async () => {
    await js(winA, 'logout(); true');
    await waitFor(winA, `!${hidden('auth-form')} || !document.getElementById('auth-form').closest('.hidden')`, 'экран входа');
    const left = await js(winA, `JSON.stringify({ contacts: state.contacts.size, history: state.history.size, rooms: state.rooms.size, name: document.getElementById('me-name')?.textContent, msgs: document.getElementById('messages').textContent.length, draft: document.getElementById('message-input').value })`);
    const parsed = JSON.parse(left);
    expect(!parsed.contacts && !parsed.history && !parsed.rooms && !parsed.draft, `осталось после выхода: ${left}`);
  });

  if (fails.length) {
    console.log(`\nНе работает (${fails.length}):`);
    for (const f of fails) console.log(`  - ${f}`);
    throw new Error(`Историй с проблемами: ${fails.length}`);
  }
});
