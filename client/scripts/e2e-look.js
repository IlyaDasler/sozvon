// Обзор внешнего вида: снимки всех основных экранов в каждой теме и при разных размерах окна,
// плюс проверка, что ничего не вылезает за окно и меню не остаются висеть поверх окон.
// Запуск (сервер должен работать): E2E_SHOTS=папка npx electron scripts/e2e-look.js [адрес сервера]
const { api, befriend, register, js, waitFor, openClient, screenshot, sleep, runTest } = require('./e2e-lib');

const THEMES = ['sozvon', 'midnight', 'light', 'forest', 'dusk'];
const SIZES = [
  [1280, 800],
  [940, 640],
];

// Видимые элементы, которые вылезают за край окна или своего прокручиваемого родителя
const OVERFLOW = `(() => {
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || el.closest('.hidden')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1) {
      if (s.position === 'fixed' || el.closest('[style*="position: fixed"]')) continue;
      if ([...el.classList].some((c) => /^(toast|tile|stage)/.test(c))) continue;
      bad.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + ' ' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }
  return bad.slice(0, 12);
})()`;

runTest(async () => {
  const a = await register('la', 'Илья');
  const b = await register('lb', 'Вася Пупкин');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Наш двор', iconColor: '#6e56cf' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  await api('POST', '/hubs', { name: 'Гаражи', iconColor: '#30a46c' }, a.token);
  const rooms = await api('GET', '/rooms', null, a.token);
  const text = rooms.find((r) => r.hubId === hub.id && r.kind === 'text');
  const voice = rooms.find((r) => r.hubId === hub.id && r.kind === 'voice');
  for (const [who, msg] of [
    [b, 'Привет! Сегодня в **CS2** вечером?'],
    [a, 'Да, после девяти. Вот карта: https://github.com/IlyaDasler/sozvon'],
    [b, '> Да, после девяти\nОтлично, зову остальных 🎮'],
    [a, 'Длинное сообщение, чтобы проверить перенос строк: ' + 'очень '.repeat(40) + 'длинно.'],
  ])
    await api('POST', `/rooms/${text.id}/messages`, { text: msg }, who.token);
  await api('POST', `/messages/${b.user.id}`, { text: 'Личное сообщение ✨' }, a.token);

  process.env.E2E_SHOW = '1';
  const win = await openClient('la', a);
  delete process.env.E2E_SHOW;
  const winB = await openClient('lb', b);
  win.focus();
  const shot = async (name) => {
    await sleep(350);
    const bad = await js(win, OVERFLOW);
    if (bad.length) console.log(`  ! ${name}: за краем — ${bad.join('; ')}`);
    await screenshot(win, name);
  };
  const press = (selector) => js(win, `document.querySelector(${JSON.stringify(selector)})?.click(); true`);
  const escape = () => js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.click(); true`);

  for (const [w, h] of SIZES) {
    win.setContentSize(w, h);
    const tag = `${w}`;
    await js(win, `selectContact(null); true`);
    await shot(`${tag}-home`);
    await js(win, `selectContact(${b.user.id})`);
    await shot(`${tag}-dm`);
    await js(win, `openHub(${hub.id}); selectRoom(${text.id}); true`);
    await waitFor(win, `document.querySelectorAll('#room-messages .msg').length >= 4`, 'сообщения в комнате');
    await shot(`${tag}-room`);
    // Меню и всплывающие окна
    await press('#hub-menu-btn');
    await shot(`${tag}-hub-menu`);
    await escape();
    await press('#room-message-form .composer-btn.emoji');
    await shot(`${tag}-emoji`);
    await escape();
    await press('#me-status-btn');
    await shot(`${tag}-status-menu`);
    await escape();
    await js(win, `document.querySelector('#room-messages .msg .avatar[data-profile]').click(); true`);
    await shot(`${tag}-profile-card`);
    await escape();
    await js(win, `openSettings(); true`);
    await shot(`${tag}-settings`);
    await js(win, `closeSettings(); true`);
    await js(win, `openRoomManage(${text.id}, 'roles'); true`);
    await shot(`${tag}-room-settings`);
    await js(win, `closeRoomManage(); openHubSettings(${hub.id}, 'members'); true`);
    await shot(`${tag}-hub-settings`);
    await js(win, `closeHubSettings(); true`);
  }

  // Голосовая комната с двумя участниками
  win.setContentSize(1280, 800);
  await js(win, `openHub(${hub.id}); openRoom(${voice.id}); true`);
  await js(winB, `openHub(${hub.id}); openRoom(${voice.id}); true`);
  await waitFor(win, `state.room?.joined && activeSession().peers.size === 1`, 'голос', 20000);
  await shot('1280-voice');

  // Темы на странице комнаты
  await js(win, `selectRoom(${text.id}); true`);
  for (const t of THEMES) {
    await js(win, `setTheme('${t}'); true`);
    await shot(`theme-${t}`);
  }
  await js(win, `leaveRoomVoice(); setTheme('sozvon'); true`);
  await js(winB, `leaveRoomVoice(); true`);

  // Ширина боковых панелей: тянем край мышью (настоящие события ввода), двойной щелчок — как было
  const width = (sel) => js(win, `Math.round(document.querySelector('${sel}').getBoundingClientRect().width)`);
  const drag = async (sel, dx) => {
    const r = await js(win, `(() => { const b = document.querySelector('${sel} > .panel-resizer').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + 200) }; })()`);
    const wc = win.webContents;
    wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) wc.sendInputEvent({ type: 'mouseMove', x: r.x + Math.round((dx * i) / 8), y: r.y, button: 'left' });
    wc.sendInputEvent({ type: 'mouseUp', x: r.x + dx, y: r.y, button: 'left', clickCount: 1 });
    await sleep(300);
  };
  const sidebarBefore = await width('.sidebar');
  await drag('.sidebar', 80);
  const sidebarAfter = await width('.sidebar');
  if (Math.abs(sidebarAfter - sidebarBefore - 80) > 3) throw new Error(`Левая панель: было ${sidebarBefore}, стало ${sidebarAfter}`);
  const membersBefore = await width('#members-panel');
  await drag('#members-panel', -60);
  const membersAfter = await width('#members-panel');
  if (Math.abs(membersAfter - membersBefore - 60) > 3) throw new Error(`Участники: было ${membersBefore}, стало ${membersAfter}`);
  await shot('1280-resized');
  if ((await js(win, `store.get('panelWidths').sidebar`)) !== sidebarAfter) throw new Error('Ширина не запомнилась');
  await js(win, `document.querySelector('.sidebar > .panel-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true`);
  if ((await width('.sidebar')) !== sidebarBefore) throw new Error('Двойной щелчок не вернул ширину');
  console.log('✔ боковые панели тянутся мышью, ширина запоминается, двойной щелчок возвращает');
});
