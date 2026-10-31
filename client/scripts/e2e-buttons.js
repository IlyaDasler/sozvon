// Каждый элемент каждого экрана: обход собирает кнопки, поля и пункты меню и нажимает их настоящей мышью.
// Итог по элементу: ok — что-то произошло; dead — нажатие ничего не изменило; blocked — кнопку перекрывает другой элемент;
// off — она за краем окна; error — ошибка на странице; skip — необратимое действие, проверяется в e2e-stories.
// Запуск (сервер должен работать): E2E_REPORT=файл.json E2E_SHOTS=папка npx electron scripts/e2e-buttons.js
// E2E_ONLY=слово — только экраны с этим словом. Окно теста на время обхода поверх остальных: нужны настоящие нажатия.
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { ACCEPT_DIALOGS, api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

// Необратимое или уводящее с экрана: нажимать в обходе нельзя, поведение проверено в e2e-stories
const SKIP = /Выйти из|^Выйти|^Удалить|Заблокировать|Завершить|Отключиться|Отключить от голоса|logout|Забанить|^Бан$|Исключить|Выгнать|Закрыть окно|Сбросить ключ|Создать новый ключ/;
const SELECTOR = 'button, a[href], input:not([type=hidden]):not([type=file]), select, textarea, [role=button], [data-contact], [data-room], .rail-tile, .friend-row.clickable, .popup-item';

// В обвязке нет этих каналов главного процесса: они проверяются в e2e-update и e2e-ptt
for (const [name, value] of [['update:status', { state: 'idle', current: '0' }], ['ptt:set', null], ['ptt:names', {}], ['ptt:capture', null]]) {
  ipcMain.removeHandler(name);
  ipcMain.handle(name, () => value);
}
for (const name of ['update:check', 'update:download', 'update:install']) ipcMain.on(name, () => {});

// Что умеет страница: счётчики последствий нажатия и список кандидатов
const PROBE = `(() => {
  if (window.fx) return true;
  window.fx = { changes: 0, calls: 0, errors: [], toasts: [] };
  new MutationObserver((list) => {
    for (const m of list) if (!m.target.closest?.('.app-tip') && !m.target.parentElement?.closest?.('.app-tip') && !m.target.parentElement?.closest?.('.msg-tools')) fx.changes++;
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  const realFetch = window.fetch;
  window.fetch = (...a) => { fx.calls++; return realFetch(...a); };
  const realSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) { fx.calls++; return realSend.apply(this, a); };
  const fileClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () { if (this.type === 'file') { fx.calls++; return; } return fileClick.call(this); };
  document.addEventListener('click', (e) => { const a = e.target.closest?.('a[href]'); if (a) { fx.calls++; e.preventDefault(); } }, true);
  window.addEventListener('error', (e) => fx.errors.push(e.message));
  window.addEventListener('unhandledrejection', (e) => fx.errors.push(String(e.reason?.message || e.reason)));
  const realToast = toast;
  toast = (t, ...r) => { fx.toasts.push(String(t)); return realToast(t, ...r); };
  window.labelOf = (e) => (e.getAttribute('aria-label') || e.title || e.dataset.tip || e.dataset.action || e.innerText || e.placeholder || e.value || e.id || e.className || e.tagName).toString().trim().split('\\n')[0].slice(0, 60);
  window.shownElements = (scope) => {
    const root = scope ? document.querySelector(scope) : document;
    const seen = new Map();
    return [...(root?.querySelectorAll(${JSON.stringify(SELECTOR)}) || [])].filter((e) => {
      if (e.closest('.app-tip')) return false;
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('.hidden');
    }).map((e) => {
      const label = labelOf(e);
      const n = (seen.get(label) || 0) + 1;
      seen.set(label, n);
      return { e, key: e.id || label + '#' + n, label, tag: e.tagName.toLowerCase(), type: e.type || '', disabled: e.disabled };
    });
  };
  return true;
})()`;

const findOf = (scope, key) => `shownElements(${JSON.stringify(scope || '')}).find((x) => x.key === ${JSON.stringify(key)})`;

runTest(async () => {
  const a = await register('bta', 'Аня');
  const b = await register('btb', 'Боря');
  const c = await register('btc', 'Вика');
  const d = await register('btd', 'Дима');
  const e = await register('bte', 'Ева');
  const f = await register('btf', 'Фёдор');
  await befriend(a, b);
  await befriend(a, f);
  await api('POST', '/contacts', { username: a.user.username }, c.token); // входящая заявка
  await api('POST', '/contacts', { username: d.user.username }, a.token); // исходящая заявка
  await api('POST', '/blocks', { userId: e.user.id }, a.token); // заблокированный
  const hub = await api('POST', '/hubs', { name: 'Наш двор' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const text = await api('POST', '/rooms', { name: 'общая', kind: 'text', hubId: hub.id }, a.token);
  const voice = await api('POST', '/rooms', { name: 'Болталка', kind: 'voice', hubId: hub.id }, a.token);
  await api('POST', `/hubs/${hub.id}/roles`, { name: 'Модератор', color: '#30a46c', perms: 1 | 2 | 8 | 32 }, a.token);

  const win = await openClient('bta', a);
  const winB = await openClient('btb', b);
  win.setBounds({ x: 40, y: 40, width: 1280, height: 800 });
  win.show();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.focus();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (ev) => ev.preventDefault());
  for (const w of [win, winB]) await waitFor(w, `e2eeReady() && Boolean(roomById(${text.id}))`, 'ключ');
  await js(win, ACCEPT_DIALOGS);
  await js(win, PROBE);

  // Переписка с картинкой, файлом, ответом и закрепом
  const send = (w, peer, t) => js(w, `(async () => { const { body, plain } = await encryptOutgoing(dmConvOf(${peer}), { text: ${JSON.stringify(t)} }); addMessage({ ...(await Api.post('/messages/${peer}', body)), plain }); return true; })()`);
  await js(win, `selectContact(${b.user.id}).then(() => true)`);
  await send(win, b.user.id, 'моё сообщение');
  await js(win, `(async () => { const c = document.createElement('canvas'); c.width = 320; c.height = 200; c.getContext('2d').fillRect(0, 0, 320, 200); const blob = await new Promise((r) => c.toBlob(r, 'image/png')); dmComposer.addFiles([new File([blob], 'кот.png', { type: 'image/png' }), new File(['текст'], 'заметки.txt', { type: 'text/plain' })]); return true; })()`);
  await waitFor(win, `dmComposer.files.length === 2 && dmComposer.files.every((f) => f.attachment)`, 'загрузка');
  await js(win, `document.getElementById('message-form').requestSubmit(); true`);
  await waitFor(win, 'dmComposer.files.length === 0', 'отправка');
  await js(winB, `selectContact(${a.user.id}).then(() => true)`);
  await send(winB, a.user.id, 'чужое сообщение https://example.com');

  /** Дождаться, пока экран перестанет меняться (не дольше 700 мс) */
  const quiet = async () => {
    let last = -1;
    for (let i = 0; i < 14; i++) {
      await sleep(50);
      const now = await js(win, 'fx.changes');
      if (now === last) return;
      last = now;
    }
  };

  // Настоящая мышь
  const mouse = (type, x, y, extra = {}) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...extra });
  const hoverAt = async (x, y) => {
    mouse('mouseMove', x, y);
    await sleep(40);
  };
  const clickAt = async (x, y, button = 'left') => {
    await hoverAt(x, y);
    mouse('mouseDown', x, y, { button, clickCount: 1 });
    mouse('mouseUp', x, y, { button, clickCount: 1 });
  };
  const centerOf = (expr) => js(win, `(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const rightClick = async (expr) => {
    const at = await centerOf(expr);
    if (!at) throw new Error(`Нет элемента: ${expr}`);
    await clickAt(at.x, at.y, 'right');
    await waitFor(win, `Boolean(document.querySelector('.popup-item'))`, 'меню', 2000);
  };
  const hoverOn = async (expr) => {
    const at = await centerOf(expr);
    if (at) await hoverAt(at.x, at.y);
  };

  // Вернуть приложение к исходному виду: ни окон, ни меню
  const calm = () => js(win, `(() => {
    if (state.call && state.call.phase !== 'connected') hangup(); // нажатая «Позвонить» не должна сжимать чат дальше
    for (const [fn] of [[closeSettings], [closeHubSettings], [closeRoomManage], [closeProfileCard], [closeNotifPanel], [closeImageViewer], [hideMenu], [closeReactionPicker]]) { try { fn(); } catch {} }
    try { closeCrop(null); closeDialog(false); closeScreenPicker(); } catch {}
    for (const id of ['room-create', 'hub-create', 'hub-invite', 'room-invite', 'hub-join', 'room-kick', 'folder-edit', 'call-add-modal', 'chat-theme-pop', 'status-menu']) document.getElementById(id)?.classList.add('hidden');
    document.querySelectorAll('.emoji-popover, .gif-popover').forEach((p) => p.classList.add('hidden'));
    document.querySelectorAll('.forward-card').forEach((p) => p.closest('.modal')?.remove()); document.querySelector('.call-add-modal')?.classList.add('hidden');
    return true;
  })()`);

  const dm = (peer) => async () => {
    await js(win, `selectContact(${peer}).then(() => true)`);
    await hoverOn(`[...document.querySelectorAll('#messages .msg')].at(-1)`);
  };
  const room = (id) => async () => {
    await js(win, `openHub(${hub.id}); selectRoom(${id}); true`);
    await hoverOn(`[...document.querySelectorAll('#room-messages .msg')].at(-1)`);
  };
  const tab = (name) => async () => {
    await js(win, `selectContact(null); showFriendsTab('${name}'); true`);
  };
  const settings = (name) => async () => js(win, `openSettings(); showSettingsTab('${name}'); true`);
  const hubTab = (name) => async () => js(win, `openHubSettings(${hub.id}, '${name}'); true`);
  const roomTab = (id, name) => async () => js(win, `openHub(${hub.id}); selectRoom(${id}); openRoomManage(${id}, '${name}'); true`);
  const open = (run, wait) => async () => {
    await run();
    if (wait) await waitFor(win, wait, 'окно открылось', 3000);
  };
  const realClick = async (selector) => {
    const at = await centerOf(`document.querySelector(${JSON.stringify(selector)})`);
    await clickAt(at.x, at.y);
    await sleep(120);
  };
  const lastMsg = (box) => `[...document.querySelectorAll('#${box} .msg')].at(-1)`;
  const hubTile = `document.querySelector('#rail-list [data-hub="${hub.id}"] .rail-tile, [data-hub="${hub.id}"]')`;

  const screens = [
    { name: 'друзья: в сети', enter: tab('online') },
    { name: 'друзья: все', enter: tab('all') },
    { name: 'друзья: входящие', enter: tab('incoming') },
    { name: 'друзья: отправленные', enter: tab('outgoing') },
    { name: 'друзья: заблокированные', enter: tab('blocked') },
    { name: 'друзья: добавить', enter: tab('add') },
    { name: 'личный чат', enter: dm(b.user.id) },
    { name: 'канал: текстовая комната', enter: room(text.id) },
    { name: 'канал: голосовая комната (вне голоса)', enter: room(voice.id) },
    { name: 'настройки: профиль', enter: settings('profile'), scope: '#settings' },
    { name: 'настройки: оформление', enter: settings('look'), scope: '#settings' },
    { name: 'настройки: звук и видео', enter: settings('sound'), scope: '#settings' },
    { name: 'настройки: уведомления', enter: settings('notify'), scope: '#settings' },
    { name: 'настройки: аккаунт', enter: settings('account'), scope: '#settings' },
    { name: 'настройки: о приложении', enter: settings('about'), scope: '#settings' },
    { name: 'канал: обзор', enter: hubTab('overview'), scope: '#hub-settings' },
    { name: 'канал: роли', enter: hubTab('roles'), scope: '#hub-settings' },
    { name: 'канал: участники', enter: hubTab('members'), scope: '#hub-settings' },
    { name: 'канал: баны', enter: hubTab('bans'), scope: '#hub-settings' },
    { name: 'комната: обзор', enter: roomTab(text.id, 'overview'), scope: '#room-manage' },
    { name: 'комната: участники', enter: roomTab(text.id, 'members'), scope: '#room-manage' },
    { name: 'комната: баны', enter: roomTab(text.id, 'bans'), scope: '#room-manage' },
    { name: 'окно: новый канал', enter: open(() => js(win, `openHubCreate(); true`)), scope: '#hub-create' },
    { name: 'окно: новая комната', enter: open(() => js(win, `openHub(${hub.id}); openRoomCreate('voice', ${hub.id}); true`)), scope: '#room-create' },
    { name: 'окно: пригласить в канал', enter: open(() => js(win, `openHubInvite(${hub.id}); true`)), scope: '#hub-invite' },
    { name: 'окно: пригласить в комнату', enter: open(() => js(win, `openHub(${hub.id}); openRoomInvite(${text.id}); true`)), scope: '#room-invite' },
    { name: 'панель уведомлений', enter: open(async () => { await realClick('#notif-btn'); }), scope: '#notif-panel' },
    { name: 'меню статуса', enter: open(async () => { await realClick('#me-status-btn'); }), scope: '#status-menu' },
    { name: 'окно смайликов', enter: async () => { await dm(b.user.id)(); await js(win, `dmComposer.emojiBtn.click(); document.querySelector('.emoji-tabs [data-group="Смайлы"]').click(); true`); }, scope: '.emoji-tabs' },
    { name: 'смайлики: сетка, выборочно', enter: async () => { await dm(b.user.id)(); await js(win, `dmComposer.emojiBtn.click(); document.querySelector('.emoji-tabs [data-group="Жесты"]').click(); true`); }, scope: '.emoji-grid', limit: 5 },
    { name: 'окно гифок', enter: async () => { await dm(b.user.id)(); await js(win, `dmComposer.gifBtn.click(); true`); await sleep(150); }, scope: '.gif-popover' },
    { name: 'тема чата', enter: async () => { await dm(b.user.id)(); await realClick('#chat-theme-btn'); }, scope: '#chat-theme-pop' },
    { name: 'карточка профиля', enter: async () => { await dm(b.user.id)(); await realClick('#peer-name'); await sleep(200); }, scope: '.profile-card' },
    { name: 'просмотр картинки', enter: async () => { await dm(b.user.id)(); await realClick('#messages .msg-images img'); await sleep(200); }, scope: '#image-viewer' },
    { name: 'меню: контакт', enter: async () => { await dm(b.user.id)(); await rightClick(`document.querySelector('#contact-list [data-contact="${b.user.id}"]')`); }, scope: '.popup, .popup-menu, #popup-menu' },
    { name: 'меню: своё сообщение', enter: async () => { await dm(b.user.id)(); await rightClick(`[...document.querySelectorAll('#messages .msg')].find((r) => r.textContent.includes('моё сообщение'))`); }, scope: '.popup, .popup-menu, #popup-menu' },
    { name: 'меню: чужое сообщение', enter: async () => { await dm(b.user.id)(); await rightClick(lastMsg('messages')); }, scope: '.popup, .popup-menu, #popup-menu' },
    { name: 'меню: картинка', enter: async () => { await dm(b.user.id)(); await rightClick(`document.querySelector('#messages .msg-images img')`); }, scope: '.popup, .popup-menu, #popup-menu' },
    { name: 'меню: комната', enter: async () => { await room(text.id)(); await rightClick(`document.querySelector('#room-list [data-room="${text.id}"]')`); }, scope: '.popup, .popup-menu, #popup-menu' },
    { name: 'меню: участник комнаты', enter: async () => { await room(text.id)(); await rightClick(`document.querySelector('#members-list [data-profile="${b.user.id}"]')`); }, scope: '.popup, .popup-menu, #popup-menu' },
    { name: 'меню: канал в столбце', enter: async () => { await room(text.id)(); await rightClick(hubTile); }, scope: '.popup, .popup-menu, #popup-menu' },
    { name: 'окно: кик на время', enter: async () => { await roomTab(text.id, 'members')(); await js(win, `openKick(roomById(${text.id}), memberOf(roomById(${text.id}), ${b.user.id})); true`); }, scope: '#room-kick' },
    { name: 'окно: переслать', enter: async () => { await dm(b.user.id)(); await js(win, `forwardMessage(state.history.get(${b.user.id}).at(-1)); true`); await sleep(100); }, scope: '.forward-card' },
    { name: 'окно: приглашение в канал', enter: async () => { await js(win, `state.hubInvites = [{ hub: { id: 999999, name: 'Чужой', iconColor: '#e5484d', memberCount: 3 }, from: state.me, createdAt: Date.now() }]; renderRail(); openHubJoin(999999); true`); }, scope: '#hub-join' },
    { name: 'полоса над полем: ответ и правка', enter: async () => { await dm(b.user.id)(); await js(win, `startReply(state.history.get(${b.user.id}).at(-1), { kind: 'dm', peerId: ${b.user.id} }); true`); }, scope: '#chat-reply' },
    { name: 'поле ввода с файлом', enter: async () => { await dm(b.user.id)(); if (!(await js(win, 'dmComposer.files.length'))) { await js(win, `dmComposer.addFiles([new File(['x'], 'черновик.txt', { type: 'text/plain' })]); true`); await waitFor(win, 'dmComposer.files.every((f) => f.attachment)', 'загрузка'); } }, scope: '#message-form' },
    { name: 'звонок: панель', enter: async () => { await inCall(); }, scope: '#chat' },
    { name: 'голос: панель слева и плитки', enter: async () => { await inVoice(); }, scope: '.main, #room-view' },
    { name: 'голос: панель статуса', enter: async () => { await inVoice(); }, scope: '#voice-panel' },
    { name: 'голос: выбор экрана', enter: async () => { await inVoice(); await js(win, `store.set('screenTab', 'screen'); toggleScreen(); true`); await waitFor(win, `document.querySelectorAll('#screen-sources .source').length > 0`, 'источники', 5000); }, scope: '#screen-picker' },
    { name: 'меню: участник в голосе', enter: async () => { await inVoice(); await rightClick(`document.querySelector('[data-voice-user="${b.user.id}"]')`); }, scope: '.popup, .popup-menu, #popup-menu' },
    { name: 'меню: шапка канала', enter: async () => { await room(text.id)(); await realClick('#hub-menu-btn'); }, scope: '.popup, .popup-menu, #popup-menu' },
  ];
  // Живой разговор: для экранов звонка и голоса
  const leaveAll = async () => {
    for (const w of [win, winB]) await js(w, 'state.call && hangup(); state.room && leaveRoomVoice(); true');
  };
  async function inCall() {
    if (await js(win, `state.call?.phase === 'connected'`)) return dm(b.user.id)();
    await leaveAll();
    await sleep(300);
    await js(win, `selectContact(${b.user.id}).then(() => startCall())`);
    await waitFor(winB, 'state.incoming !== null', 'входящий', 8000);
    await js(winB, 'acceptIncoming(); true');
    await waitFor(win, `state.call?.phase === 'connected'`, 'разговор', 20000);
  }
  async function inVoice() {
    if (await js(win, `Boolean(state.room?.joined && state.room.session?.peers.size === 1)`)) return js(win, `openHub(${hub.id}); selectRoom(${voice.id}); true`);
    await leaveAll();
    await sleep(300);
    for (const w of [win, winB]) await js(w, `openHub(${hub.id}); openRoom(${voice.id}); true`);
    for (const w of [win, winB]) await waitFor(w, 'state.room?.joined && state.room.session?.peers.size === 1', 'оба в голосе', 20000);
  }
  if (process.env.E2E_THEME) await js(win, `setTheme('${process.env.E2E_THEME}'); true`);
  const only = process.env.E2E_ONLY;
  const report = [];
  const shotsDir = process.env.E2E_SHOTS;

  for (const screen of screens) {
    if (only && !screen.name.includes(only)) continue;
    await calm();
    try {
      await screen.enter();
    } catch (err) {
      report.push({ screen: screen.name, label: '(экран)', status: 'error', note: err.message });
      console.log(`✖ ${screen.name}: не открылся — ${err.message}`);
      continue;
    }
    await sleep(150);
    if (shotsDir) fs.writeFileSync(path.join(shotsDir, `${String(screens.indexOf(screen)).padStart(2, '0')}-${screen.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`), (await win.webContents.capturePage()).toPNG());
    const keys = (await js(win, `shownElements(${JSON.stringify(screen.scope || '')}).map(({ key, label, tag, type, disabled }) => ({ key, label, tag, type, disabled }))`)).slice(0, screen.limit || 500);
    const counts = { ok: 0, bad: 0 };
    for (const item of keys) {
      const row = { screen: screen.name, label: item.label, tag: item.tag };
      if (item.disabled) {
        report.push({ ...row, status: 'disabled' });
        continue;
      }
      if (SKIP.test(item.label)) {
        report.push({ ...row, status: 'skip' });
        continue;
      }
      await calm();
      await screen.enter().catch(() => {});
      await sleep(40);
      // Сначала прокрутка: если листать после наведения, строка уедет из-под мыши
      await js(win, `${findOf(screen.scope, item.key)}?.e.closest('.msg')?.scrollIntoView({ block: 'nearest' }); true`);
      await hoverOn(`${findOf(screen.scope, item.key)}?.e.closest('.msg')`);
      await sleep(item.label.match(/Ответить|Переслать|Реакция|Изменить|репить/) ? 220 : 30);
      const at = await js(win, `(() => {
        const x = ${findOf(screen.scope, item.key)};
        if (!x) return null;
        if (!x.e.closest('.msg')) x.e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = x.e.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const off = cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight;
        const hit = document.elementFromPoint(cx, cy);
        const same = hit && (hit === x.e || x.e.contains(hit) || hit.contains(x.e) && hit.tagName === 'LABEL' || hit.closest('label') && hit.closest('label') === x.e.closest('label'));
        const row = x.e.closest('.msg'); const box = row?.getBoundingClientRect(); return { x: cx, y: cy, off, same: Boolean(same), hit: (hit ? (hit.id || hit.className || hit.tagName) + '' : '') + (row ? ' ' + JSON.stringify({ hover: row.matches(':hover'), rowTop: Math.round(box.top), rowH: Math.round(box.height), toolY: Math.round(cy), scrollTop: Math.round(row.closest('.messages, #messages')?.getBoundingClientRect().top ?? -1), text: row.textContent.slice(0, 20) }) : '') };
      })()`);
      if (!at) {
        report.push({ ...row, status: 'gone', note: 'после возврата на экран элемента нет' });
        continue;
      }
      if (at.off) {
        report.push({ ...row, status: 'off' });
        counts.bad++;
        continue;
      }
      if (!at.same) {
        report.push({ ...row, status: 'blocked', note: at.hit.slice(0, 140) });
        counts.bad++;
        continue;
      }
      if (item.tag === 'select') {
        // Список откроется окном системы: меняем значение, как при выборе
        await js(win, `(() => { fx.changes = 0; fx.calls = 0; const s = ${findOf(screen.scope, item.key)}.e; const o = [...s.options].find((p) => p.value !== s.value && !p.disabled); if (o) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
      } else {
        await hoverAt(at.x, at.y);
        await quiet();
        await js(win, 'fx.changes = 0; fx.calls = 0; fx.errors.length = 0; fx.toasts.length = 0; true');
        await clickAt(at.x, at.y);
      }
      await sleep(180);
      const fx = await js(win, `({ changes: fx.changes, calls: fx.calls, errors: [...fx.errors], toasts: [...fx.toasts], focus: document.activeElement === ${findOf(screen.scope, item.key)}?.e })`).catch((err) => ({ changes: 0, calls: 0, errors: [err.message], toasts: [] }));
      const failed = [...fx.errors, ...fx.toasts.filter((t) => /Не удал|ошибк|не найден|Нельзя|нельзя|недоступ|Нет права/i.test(t))];
      const typed = /input|textarea/.test(item.tag) && fx.focus;
      if (failed.length) {
        report.push({ ...row, status: 'error', note: failed.join('; ').slice(0, 160) });
        counts.bad++;
      } else if (fx.changes || fx.calls || typed) {
        report.push({ ...row, status: 'ok', changes: fx.changes, calls: fx.calls });
        counts.ok++;
      } else {
        report.push({ ...row, status: 'dead' });
        counts.bad++;
      }
    }
    console.log(`${counts.bad ? '✖' : '✔'} ${screen.name}: элементов ${keys.length}, сработало ${counts.ok}, проблем ${counts.bad}`);
  }

  await calm();
  await js(win, 'selectContact(null); true');
  await quiet();
  await js(win, 'fx.changes = 0; fx.calls = 0; true');
  await clickAt(640, 300);
  await sleep(200);
  const control = await js(win, '({ changes: fx.changes, calls: fx.calls })');
  console.log('Контроль (нажатие в пустое место):', JSON.stringify(control));

  // Экран входа: отдельное окно, вход здесь не нужен
  const auth = await openClient('btx', await register('btx', 'служебный'));
  await js(auth, 'logout(); true');
  await js(auth, PROBE);
  auth.setBounds({ x: 40, y: 40, width: 1280, height: 800 });
  for (const [name, mode] of [['вход', "setAuthMode('login')"], ['регистрация', "setAuthMode('register')"], ['сброс пароля', "setAuthMode('reset')"]]) {
    await js(auth, `${mode}; true`);
    const list = await js(auth, `shownElements('#auth-form').filter((x) => !x.e.closest('#auth-toggle')).map(({ key, label }) => ({ key, label }))`);
    for (const item of list) {
      await js(auth, `${mode}; fx.changes = 0; fx.calls = 0; true`);
      const seen = await js(auth, `(() => { const x = shownElements('#auth-form').find((y) => y.key === ${JSON.stringify(item.key)}); if (!x) return null; const r = x.e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h === x.e || x.e.contains(h) || h?.closest('label') === x.e.closest('label'); })()`);
      report.push({ screen: `вход: ${name}`, label: item.label, status: seen ? 'ok' : 'blocked' });
    }
    console.log(`✔ вход: ${name}: элементов ${list.length}`);
  }

  if (process.env.E2E_REPORT) fs.writeFileSync(process.env.E2E_REPORT, JSON.stringify(report, null, 1));
  const tally = {};
  for (const r of report) tally[r.status] = (tally[r.status] || 0) + 1;
  console.log('Итог:', JSON.stringify(tally));
  for (const r of report.filter((x) => !['ok', 'skip', 'disabled'].includes(x.status))) console.log(`  ${r.status}: ${r.screen} → ${r.label}${r.note ? ` (${r.note})` : ''}`);
});
