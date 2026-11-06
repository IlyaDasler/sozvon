// Обзор внешнего вида: снимки всех основных экранов в каждой теме и при разных размерах окна,
// плюс проверка, что ничего не вылезает за окно и меню не остаются висеть поверх окон.
// Запуск (сервер должен работать): E2E_SHOTS=папка npx electron scripts/e2e-look.js [адрес сервера]
const { api, befriend, register, js, waitFor, openClient, screenshot, sleep, runTest } = require('./e2e-lib');

const THEMES = ['sozvon', 'midnight', 'light', 'forest', 'dusk', 'ferrari', 'glass'];
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
    await js(win, `openRoomManage(${text.id}, 'overview'); true`);
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
    if (t === 'ferrari') await js(win, `document.documentElement.style.setProperty('--accent', '#3f3f3f'); document.documentElement.style.setProperty('--accent-2', '#3f3f3f'); true`);
    await js(win, `setTheme('${t}'); true`);
    if (t === 'ferrari') {
      await sleep(450);
      const f = JSON.parse(await js(win, `(() => {
        const cs = getComputedStyle(document.documentElement);
        const add = getComputedStyle(document.querySelector('.friend-tabs .add-tab'));
        return JSON.stringify({ accent: cs.getPropertyValue('--accent').trim(), add: add.backgroundColor });
      })()`));
      if (f.accent !== '#e10600') throw new Error(`Феррари: системный акцент перекрыл красный (${f.accent})`);
      if (f.add !== 'rgb(242, 194, 0)') throw new Error(`Феррари: неверное действие «Добавить в друзья» ${f.add}`);
      await js(win, `document.documentElement.style.removeProperty('--accent'); document.documentElement.style.removeProperty('--accent-2'); true`);
    }
    await shot(`theme-${t}`);
  }
  // Все темы доступны в «Оформлении», разбитые на «Классические темы» и «Новые темы»
  await js(win, `openSettings('look'); true`);
  await sleep(300);
  const picker = JSON.parse(await js(win, `(() => {
    const groups = [...document.querySelectorAll('#theme-grid .theme-group')].map((g) => ({
      title: g.querySelector('h4')?.textContent.trim(),
      ids: [...g.querySelectorAll('.theme-card')].map((c) => c.dataset.pick),
    }));
    return JSON.stringify(groups);
  })()`));
  const expectedGroups = [
    { title: 'Классические темы', ids: ['sozvon', 'dark', 'midnight', 'light', 'forest', 'dusk'] },
    { title: 'Новые темы', ids: ['frost', 'cold', 'ferrari', 'glass'] },
  ];
  if (JSON.stringify(picker) !== JSON.stringify(expectedGroups)) throw new Error(`Группы тем в оформлении: ${JSON.stringify(picker)}`);
  await js(win, `document.querySelector('[data-pick="ferrari"]').click(); true`);
  await sleep(350);
  if ((await js(win, `document.documentElement.dataset.theme`)) !== 'ferrari') throw new Error('«Феррари» не выбирается из оформления');
  await js(win, `closeSettings(); true`);
  console.log('✔ все 7 тем в оформлении, «Феррари» выбирается');
  await js(win, `leaveRoomVoice(); setTheme('sozvon'); true`);
  await js(winB, `leaveRoomVoice(); true`);

  // Ширина боковых панелей: тянем край мышью (настоящие события ввода), двойной щелчок — как было
  const width = (sel) => js(win, `Math.round(document.querySelector('${sel}').getBoundingClientRect().width)`);
  // Ручка стоит внутри панели, поэтому ожидаемую ширину считаем по фактической точке захвата
  const expectedWidth = (sel, dx, edge) => js(win, `(() => {
    const p = document.querySelector('${sel}').getBoundingClientRect();
    const b = document.querySelector('${sel} > .panel-resizer').getBoundingClientRect();
    const center = b.left + b.width / 2;
    return Math.round('${edge}' === 'right' ? (center + ${dx}) - p.left : p.right - (center + ${dx}));
  })()`);
  const drag = async (sel, dx) => {
    await js(win, `(() => {
      const h = document.querySelector('${sel} > .panel-resizer');
      const r = h.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + 200);
      h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 81, clientX: x, clientY: y }));
      for (let i = 1; i <= 8; i++) window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 81, clientX: x + Math.round((${dx} * i) / 8), clientY: y }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 81, clientX: x + ${dx}, clientY: y }));
      return true;
    })()`);
    await sleep(300);
  };
  const sidebarBefore = await width('.sidebar');
  const sidebarExpected = await expectedWidth('.sidebar', 80, 'right');
  await drag('.sidebar', 80);
  const sidebarAfter = await width('.sidebar');
  if (Math.abs(sidebarAfter - sidebarExpected) > 4)
    throw new Error(`Левая панель: ждали ${sidebarExpected}, стало ${sidebarAfter}`);
  const membersBefore = await width('#members-panel');
  const membersExpected = await expectedWidth('#members-panel', -60, 'left');
  await drag('#members-panel', -60);
  const membersAfter = await width('#members-panel');
  if (Math.abs(membersAfter - membersExpected) > 4)
    throw new Error(`Участники: ждали ${membersExpected}, стало ${membersAfter}`);
  await shot('1280-resized');
  if ((await js(win, `store.get('panelWidths').sidebar`)) !== sidebarAfter) throw new Error('Ширина не запомнилась');
  await js(win, `document.querySelector('.sidebar > .panel-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true`);
  if ((await width('.sidebar')) !== sidebarBefore) throw new Error('Двойной щелчок не вернул ширину');
  console.log('✔ боковые панели тянутся мышью, ширина запоминается, двойной щелчок возвращает');
});
