// Картинка в чате: копируется в буфер как картинка и скачивается расшифрованной — в личном чате, в канале и в просмотрщике.
// Запуск (сервер должен работать): npx electron scripts/e2e-image-menu.js [адрес сервера]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clipboard } = require('electron');
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const png = (composer) => `(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const g = c.getContext('2d'); g.fillStyle = '#e5484d'; g.fillRect(0, 0, 64, 48); const blob = await new Promise((r) => c.toBlob(r, 'image/png')); ${composer}.addFiles([new File([blob], 'кот.png', { type: 'image/png' })]); return true; })()`;
const menuLabels = `[...document.querySelectorAll('.popup-item')].map((b) => b.textContent)`;
const openMenu = (selector) => `(() => { document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 })); return ${menuLabels}; })()`;
const clickItem = (label) => `[...document.querySelectorAll('.popup-item')].find((b) => b.textContent === ${JSON.stringify(label)}).click(); true`;

runTest(async () => {
  const a = await register('ima', 'Аня');
  const b = await register('imb', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Компания' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const win = await openClient('ima', a);
  const winB = await openClient('imb', b);
  for (const w of [win, winB]) await waitFor(w, `e2eeReady() && Boolean(roomById(${room.id}))`, 'ключ');

  // Скачивание уходит в папку теста, а не в окно выбора файла
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-image-'));
  const saved = [];
  winB.webContents.session.on('will-download', (_event, item) => {
    const file = path.join(folder, `${saved.length}-${item.getFilename()}`);
    saved.push(file);
    item.setSavePath(file);
  });

  async function check(where, selector) {
    await waitFor(winB, `Boolean(document.querySelector(${JSON.stringify(selector)})?.naturalWidth)`, `картинка: ${where}`);
    const labels = await js(winB, openMenu(selector));
    if (labels.some((l) => /ссылк/i.test(l))) throw new Error(`${where}: остался пункт со ссылкой: ${labels}`);
    clipboard.clear();
    await js(winB, clickItem('Скопировать картинку'));
    for (let i = 0; i < 30 && !(await clipboard.has('image/png')); i++) await sleep(100);
    const [item] = await clipboard.read();
    const copied = Buffer.from(await (await item.getType('image/png')).arrayBuffer());
    // Размер — в заголовке PNG
    const size = `${copied.readUInt32BE(16)}×${copied.readUInt32BE(20)}`;
    if (size !== '64×48') throw new Error(`${where}: в буфере картинка ${size}`);

    const before = saved.length;
    await js(winB, openMenu(selector));
    await js(winB, clickItem('Скачать'));
    for (let i = 0; i < 30 && saved.length === before; i++) await sleep(100);
    if (saved.length === before) throw new Error(`${where}: скачивание не началось`);
    const file = saved.at(-1);
    for (let i = 0; i < 30 && !fs.existsSync(file); i++) await sleep(100);
    await sleep(200);
    if (!file.endsWith('кот.png')) throw new Error(`${where}: имя файла ${file}`);
    // Настоящий PNG, а не шифр с сервера
    if (fs.readFileSync(file).subarray(1, 4).toString() !== 'PNG') throw new Error(`${where}: скачан не расшифрованный файл`);
    console.log(`✔ ${where}: скопировать картинку и скачать`);
  }

  // Личный чат
  await js(win, `selectContact(${b.user.id}).then(() => true)`);
  await js(win, png('dmComposer'));
  await waitFor(win, `dmComposer.files.length === 1 && dmComposer.files.every((f) => f.attachment)`, 'загрузка');
  await js(win, `document.getElementById('message-form').requestSubmit(); true`);
  await waitFor(win, 'dmComposer.files.length === 0', 'отправка');
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await check('личный чат', '#messages .msg-images img');

  // Просмотрщик
  await js(winB, `document.querySelector('#messages .msg-images img').click(); true`);
  await check('просмотрщик', '#image-viewer-img');
  await js(winB, 'closeImageViewer(); true');

  // Канал
  await js(win, `selectRoom(${room.id}); true`);
  await js(win, png('roomComposer'));
  await waitFor(win, `roomComposer.files.length === 1 && roomComposer.files.every((f) => f.attachment)`, 'загрузка');
  await js(win, `document.getElementById('room-message-form').requestSubmit(); true`);
  await waitFor(win, 'roomComposer.files.length === 0', 'отправка');
  await js(winB, `selectRoom(${room.id}); true`);
  await check('канал', '#room-messages .msg-images img');
});
