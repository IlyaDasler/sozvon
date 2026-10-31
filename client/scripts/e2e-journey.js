// Путь новых людей от начала до конца, только через интерфейс: регистрация по почте, заявка в друзья, переписка, свой канал
// с приглашением, фото с выбором области, смена имени, звонок, голосовая комната, выход и вход обратно.
// Нужен сервер с почтой в файл: MAIL_TEST_FILE=<файл> node src/index.js. Запуск: MAIL_TEST_FILE=<тот же файл> npx electron scripts/e2e-journey.js
const fs = require('fs');
const { SERVER, register, js, waitFor, sleep, openClient, screenshot, runTest } = require('./e2e-lib');

const stamp = Date.now().toString(36).slice(-5);
const PASSWORD = 'journey-pass-1';
const click = (selector) => `(() => { document.querySelector(${JSON.stringify(selector)}).click(); return true; })()`;
const fill = (id, value) => `(() => { const i = document.getElementById('${id}'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new InputEvent('input', { inputType: 'insertText', bubbles: true })); return true; })()`;
const shown = (id) => `!document.getElementById('${id}').classList.contains('hidden')`;
const submit = (id) => `document.getElementById('${id}').requestSubmit(); true`;
const say = (input, text) => `(() => { const a = document.getElementById('${input}'); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new InputEvent('input', { inputType: 'insertText' })); a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()`;
const clickByTip = (text) => `(() => { [...document.querySelectorAll('button')].find((b) => (b.title || b.dataset.tip) === ${JSON.stringify(text)}).click(); return true; })()`;
const clickByText = (root, text) => `(() => { [...document.querySelectorAll('${root} button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click(); return true; })()`;
const shows = (id, text) => `document.getElementById('${id}').textContent.includes(${JSON.stringify(text)})`;
// Картинка 200×100: слева красная половина, справа синяя
const pickImage = (input) => `(async () => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 100; const g = c.getContext('2d');
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, 100, 100); g.fillStyle = '#0000ff'; g.fillRect(100, 0, 100, 100);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const data = new DataTransfer(); data.items.add(new File([blob], 'фото.png', { type: 'image/png' }));
  const i = document.getElementById('${input}'); i.files = data.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
const dragCrop = (dx) => `(() => { const s = document.getElementById('crop-stage'); const at = (type, x) => s.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: 10 })); at('pointerdown', 150); at('pointermove', 150 + ${dx}); at('pointerup', 150 + ${dx}); return true; })()`;
const centerColor = (url) => `(async () => { const b = await createImageBitmap(await (await fetch(Api.base + ${url})).blob()); const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; const g = c.getContext('2d'); g.drawImage(b, 0, 0); return [...g.getImageData(b.width / 2, b.height / 2, 1, 1).data].slice(0, 3); })()`;

function mailCode(address) {
  const lines = fs.readFileSync(process.env.MAIL_TEST_FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return lines.filter((l) => l.to === address).at(-1)?.code;
}

async function signUp(name, email, displayName) {
  // Окно со входом: заводим служебный профиль и выходим, дальше всё как у нового человека
  const win = await openClient(name, await register(`${name}t`, 'служебный'));
  await js(win, 'logout(); true');
  await waitFor(win, shown('auth-form'), 'экран входа');
  await js(win, fill('server-url', SERVER));
  await js(win, `document.getElementById('server-url').onchange(); setAuthMode(true); true`);
  await js(win, fill('auth-email', email));
  await js(win, fill('auth-display', displayName));
  await js(win, fill('auth-password', 'короткий'.slice(0, 7)));
  await js(win, submit('auth-form'));
  await waitFor(win, `document.getElementById('auth-error').textContent.includes('8 символов')`, 'короткий пароль отклонён сразу');
  if (mailCode(email)) throw new Error('Письмо ушло до проверки пароля');
  await js(win, fill('auth-password', PASSWORD));
  await js(win, submit('auth-form'));
  for (let i = 0; i < 40 && !mailCode(email); i++) await sleep(100);
  await js(win, fill('auth-code', mailCode(email)));
  await js(win, submit('auth-form'));
  await waitFor(win, `Boolean(state.me) && e2eeReady() && document.getElementById('conn-dot').classList.contains('ok')`, `${displayName}: вход после регистрации`);
  return win;
}

runTest(async () => {
  const winA = await signUp('jna', `a${stamp}@example.com`, 'Аня');
  const winB = await signUp('jnb', `b${stamp}@example.com`, 'Боря');
  for (const w of [winA, winB]) await js(w, `(() => { window.toasts = []; const real = toast; toast = (text, ...rest) => { window.toasts.push(String(text)); return real(text, ...rest); }; return true; })()`);
  const noErrors = async (step) => {
    for (const w of [winA, winB]) {
      const bad = (await js(w, 'window.toasts.splice(0)')).filter((t) => /не удал|ошибк|не найден|нельзя|недоступ|неверн/i.test(t));
      if (bad.length) throw new Error(`${step}: ошибка на экране — ${bad.join('; ')}`);
    }
  };
  const [meA, meB] = await Promise.all([js(winA, 'state.me'), js(winB, 'state.me')]);
  console.log('✔ регистрация по почте с кодом');

  // Друзья
  await js(winA, click('#friend-tabs [data-tab="add"]'));
  await js(winA, fill('friend-add-input', meB.username));
  await js(winA, submit('friend-add-form'));
  await waitFor(winA, shows('friend-add-result', 'Заявка отправлена'), 'заявка отправлена');
  await waitFor(winB, `Boolean(document.getElementById('ftab-incoming').textContent)`, 'значок входящей заявки');
  await js(winB, click('#friend-tabs [data-tab="incoming"]'));
  await waitFor(winB, `[...document.querySelectorAll('#friends-list button')].some((b) => (b.title || b.dataset.tip) === 'Принять')`, 'кнопка «Принять»');
  await js(winB, clickByTip('Принять'));
  for (const [w, other] of [[winA, meB], [winB, meA]]) await waitFor(w, `state.contacts.has(${other.id})`, 'друг в списке');
  await noErrors('друзья');
  console.log('✔ заявка в друзья: отправил, увидел, принял');

  // Первая переписка
  await js(winA, `document.querySelector('#contact-list [data-contact="${meB.id}"]').click(); true`);
  await waitFor(winA, shown('chat'), 'открытый чат');
  await js(winA, say('message-input', 'привет, это я'));
  await waitFor(winB, `state.unread.get(${meA.id}) === 1`, 'непрочитанное у Бори');
  await js(winB, `document.querySelector('#contact-list [data-contact="${meA.id}"]').click(); true`);
  await waitFor(winB, shows('messages', 'привет, это я'), 'сообщение у Бори');
  await js(winB, say('message-input', 'привет!'));
  await waitFor(winA, shows('messages', 'привет!'), 'ответ у Ани');
  await noErrors('переписка');
  console.log('✔ первая переписка');

  // Свой канал, приглашение, комната
  await js(winA, click('#rail-add'));
  await js(winA, fill('hub-name', 'Наш двор'));
  await js(winA, submit('hub-create-form'));
  await waitFor(winA, `[...state.hubs.values()].some((h) => h.name === 'Наш двор')`, 'канал создан');
  const hubId = await js(winA, `[...state.hubs.values()].find((h) => h.name === 'Наш двор').id`);
  await js(winA, `openHubInvite(${hubId}); true`);
  await waitFor(winA, `[...document.querySelectorAll('#hi-list button')].length > 0`, 'список друзей для приглашения');
  await js(winA, clickByText('#hi-list', 'Пригласить'));
  await waitFor(winB, `Boolean(document.querySelector('[data-invite="${hubId}"] button'))`, 'приглашение у Бори');
  await js(winB, click(`[data-invite="${hubId}"] button`));
  await waitFor(winB, shown('hub-join'), 'окно приглашения');
  await js(winB, click('#hj-accept'));
  await waitFor(winB, `state.view === ${hubId}`, 'Боря в канале');
  await js(winA, click('#hi-close'));
  await js(winA, `openHub(${hubId}); openRoomCreate('text', ${hubId}); true`);
  await js(winA, `document.querySelector('input[name="room-kind"][value="text"]').click(); true`);
  await js(winA, fill('room-name', 'общая'));
  await js(winA, submit('room-create-form'));
  await waitFor(winA, `state.rooms.size >= 1 && [...state.rooms.values()].some((r) => r.name === 'общая')`, 'комната создана');
  const roomId = await js(winA, `[...state.rooms.values()].find((r) => r.name === 'общая').id`);
  await waitFor(winB, `Boolean(roomById(${roomId}))`, 'комната у Бори');
  await js(winB, `document.querySelector('#room-list [data-room="${roomId}"]').click(); true`);
  await js(winA, `document.querySelector('#room-list [data-room="${roomId}"]').click(); true`);
  await js(winB, say('room-message-input', 'я в комнате'));
  await waitFor(winA, shows('room-messages', 'я в комнате'), 'сообщение в комнате');
  await js(winA, `(() => { const r = [...document.querySelectorAll('#room-messages .msg')].at(-1); r.querySelector('.msg-tool[title="Ответить"]').click(); return true; })()`);
  await js(winA, say('room-message-input', 'вижу тебя'));
  await waitFor(winB, `Boolean([...document.querySelectorAll('#room-messages .msg')].at(-1)?.querySelector('.msg-reply'))`, 'ответ в комнате');
  await noErrors('канал');
  console.log('✔ канал: создал, пригласил, принял, комната, ответ в комнате');

  // Фото профиля: передумал, потом выбрал правую часть
  await js(winA, `openSettings(); showSettingsTab('profile'); true`);
  await js(winA, pickImage('avatar-input'));
  await waitFor(winA, shown('crop'), 'окно выбора области');
  await js(winA, click('#crop-cancel'));
  await sleep(200);
  if (await js(winA, 'Boolean(state.me.avatarUrl)')) throw new Error('Отмена всё равно поставила фото');
  await js(winA, pickImage('avatar-input'));
  await waitFor(winA, shown('crop'), 'окно выбора области');
  if (await js(winA, `(() => { const c = document.querySelector('.crop-card'); return c.scrollWidth > c.clientWidth || c.scrollHeight > c.clientHeight; })()`)) throw new Error('В окне выбора области лишняя прокрутка');
  await js(winA, dragCrop(-400));
  await sleep(200);
  await screenshot(winA, 'crop');
  await js(winA, click('#crop-ok'));
  await waitFor(winA, 'Boolean(state.me.avatarUrl)', 'фото поставлено');
  const avatar = await js(winA, 'state.me.avatarUrl');
  const color = await js(winA, centerColor(JSON.stringify(avatar)));
  if (!(color[2] > 200 && color[0] < 60)) throw new Error(`Фото обрезано не там: центр ${color}`);
  await waitFor(winB, `userById(${meA.id})?.avatarUrl === ${JSON.stringify(avatar)}`, 'новое фото у Бори');
  console.log('✔ фото профиля: отмена, выбор области, видно другу');

  // Картинка канала
  await js(winA, `closeSettings(); openHubSettings(${hubId}); true`);
  await js(winA, pickImage('hub-icon-input'));
  await waitFor(winA, `${shown('crop')} && !document.getElementById('crop-box').classList.contains('round')`, 'выбор области картинки канала');
  await js(winA, click('#crop-ok'));
  await waitFor(winB, `Boolean(hubById(${hubId})?.iconUrl)`, 'картинка канала у Бори');
  await js(winA, `document.getElementById('hub-settings').classList.add('hidden'); true`);
  console.log('✔ картинка канала с выбором области');

  // Новое имя видно везде
  await js(winA, `openSettings(); showSettingsTab('profile'); true`);
  await js(winA, fill('set-display', 'Анна'));
  await js(winA, submit('settings-form'));
  await waitFor(winB, `userById(${meA.id})?.displayName === 'Анна' && ${shows('room-messages', 'Анна')}`, 'новое имя у Бори в комнате');
  await noErrors('профиль');
  console.log('✔ новое имя видно другу');

  // Звонок
  await js(winA, `selectContact(${meB.id}).then(() => true)`);
  await js(winA, click('#call-btn'));
  await waitFor(winB, shown('incoming'), 'входящий звонок');
  await js(winB, click('#accept-btn'));
  await waitFor(winA, `state.call?.phase === 'connected'`, 'звонок соединён', 20000);
  await js(winA, click('#hangup-btn'));
  await waitFor(winB, '!state.call', 'звонок завершён у Бори');
  console.log('✔ звонок: позвонил, ответили, положил трубку');

  // Голосовая комната
  await js(winA, `openHub(${hubId}); openRoomCreate('voice', ${hubId}); true`);
  await js(winA, `document.querySelector('input[name="room-kind"][value="voice"]').click(); true`);
  await js(winA, fill('room-name', 'Болталка'));
  await js(winA, submit('room-create-form'));
  await waitFor(winA, `[...state.rooms.values()].some((r) => r.name === 'Болталка')`, 'голосовая создана');
  const voiceId = await js(winA, `[...state.rooms.values()].find((r) => r.name === 'Болталка').id`);
  await waitFor(winB, `Boolean(roomById(${voiceId}))`, 'голосовая у Бори');
  for (const w of [winA, winB]) await js(w, `openHub(${hubId}); document.querySelector('#room-list [data-room="${voiceId}"]').click(); true`);
  for (const w of [winA, winB]) await waitFor(w, 'state.room?.joined && state.room.session?.peers.size === 1', 'оба в голосе', 20000);
  await js(winA, 'leaveRoomVoice(); true');
  await waitFor(winB, 'state.room?.session?.peers.size === 0', 'Боря видит, что Аня вышла', 10000);
  await js(winB, 'leaveRoomVoice(); true');
  await noErrors('голос');
  console.log('✔ голосовая комната: оба вошли, вышли');

  // Выход и вход: переписка читается
  await js(winA, 'logout(); true');
  await waitFor(winA, shown('auth-form'), 'экран входа');
  await js(winA, fill('auth-username', `a${stamp}@example.com`));
  await js(winA, fill('auth-password', PASSWORD));
  await js(winA, submit('auth-form'));
  await waitFor(winA, `Boolean(state.me) && e2eeReady()`, 'вход обратно');
  await js(winA, `selectContact(${meB.id}).then(() => true)`);
  await waitFor(winA, shows('messages', 'привет, это я'), 'переписка после повторного входа');
  console.log('✔ выход и вход: переписка на месте');
});
