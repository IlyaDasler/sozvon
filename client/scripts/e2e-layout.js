// Проверка геометрии интерфейса: ничего не съезжает, не налезает и не вылезает.
// Запуск (сервер должен работать): node_modules/electron/dist/electron.exe scripts/e2e-layout.js
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;

runTest(async () => {
  const a = await register('lay' + Math.random().toString(36).slice(2, 5), 'Аня');
  const b = await register('lby' + Math.random().toString(36).slice(2, 5), 'Боря');
  await api('POST', '/contacts', { username: b.user.username }, a.token).catch(() => {});
  const hub = await api('POST', '/hubs', { name: 'Эридан' }, a.token);
  const room = await api('POST', '/rooms', { name: 'Основной', kind: 'voice', hubId: hub.id }, a.token);

  const win = await openClient('laya', a);
  await sleep(1300);
  win.show();
  win.focus();

  // ---------- Свитчеры: шарик по центру дорожки во всех состояниях ----------
  await js(win, `document.documentElement.dataset.theme='glass'; applyGlass(); openHub(${hub.id}); openHubSettings(${hub.id},'roles'); true`);
  await sleep(900);
  const knob = await js(win, `(() => {
    const sw = document.querySelector('.perm-item .switch');
    const track = sw.getBoundingClientRect();
    const cs = getComputedStyle(sw);
    const after = getComputedStyle(sw, '::after');
    const knobH = parseFloat(after.height);
    const knobW = parseFloat(after.width);
    const top = parseFloat(after.top);
    const left = parseFloat(after.left);
    return JSON.stringify({
      trackH: track.height, trackW: track.width, border: parseFloat(cs.borderTopWidth),
      topGap: top, bottomGap: track.height - parseFloat(cs.borderTopWidth) * 2 - top - knobH,
      leftGap: left, knobH, knobW,
    });
  })()`);
  const g = JSON.parse(knob);
  if (g.border !== 0) throw new Error(`У переключателя осталась рамка ${g.border}px — шарик сместится`);
  if (!near(g.topGap, g.bottomGap)) throw new Error(`Шарик свитчера не по центру: сверху ${g.topGap}, снизу ${g.bottomGap}`);
  if (!near(g.leftGap, 3)) throw new Error(`Шарик свитчера не с левым отступом 3px: ${g.leftGap}`);
  console.log('✔ свитчер: шарик по центру, рамки нет');

  // ---------- Шапка сайдбара: иконки внутри панели, не липнут к скруглению ----------
  const head = await js(win, `(() => {
    const side = document.querySelector('.sidebar').getBoundingClientRect();
    const icons = [...document.querySelectorAll('.sidebar-head .icon-btn')].map((el) => el.getBoundingClientRect());
    const headEl = document.querySelector('.sidebar-head').getBoundingClientRect();
    const last = icons[icons.length - 1];
    return JSON.stringify({
      rightGap: Math.round(side.right - last.right),
      topGap: Math.round(icons[0].top - headEl.top),
      bottomGap: Math.round(headEl.bottom - icons[0].bottom),
    });
  })()`);
  const h = JSON.parse(head);
  if (h.rightGap < 4) throw new Error(`Иконки в шапке липнут к краю: отступ ${h.rightGap}px`);
  if (!near(h.topGap, h.bottomGap)) throw new Error(`Иконки в шапке не по центру: ${h.topGap}/${h.bottomGap}`);
  console.log('✔ иконки в шапке сайдбара не съехали');

  // ---------- Панели ниже полосы заголовка ----------
  const panels = await js(win, `(() => {
    const bar = document.querySelector('.titlebar').getBoundingClientRect();
    const side = document.querySelector('.sidebar').getBoundingClientRect();
    const content = document.querySelector('.content').getBoundingClientRect();
    return JSON.stringify({ barH: bar.height, sideTop: side.top, contentTop: content.top });
  })()`);
  const p = JSON.parse(panels);
  if (p.sideTop < p.barH || p.contentTop < p.barH) throw new Error('Панели залезли под полосу заголовка');
  console.log('✔ панели начинаются ниже полосы заголовка');

  // ---------- Композер: «плюс» и поле внутри пилюли ----------
  await js(win, `document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); openRoom(${room.id}); true`);
  await sleep(800);
  const composer = await js(win, `(() => {
    const bar = document.querySelector('.composer-bar').getBoundingClientRect();
    const plus = document.querySelector('.composer .composer-btn').getBoundingClientRect();
    const area = document.querySelector('.composer textarea').getBoundingClientRect();
    return JSON.stringify({
      insideLeft: Math.round(plus.left - bar.left),
      insideRight: Math.round(bar.right - plus.right),
      areaInside: area.left >= bar.left && area.right <= bar.right,
      plusInside: plus.top >= bar.top - 1 && plus.bottom <= bar.bottom + 1,
    });
  })()`);
  const c = JSON.parse(composer);
  if (!c.plusInside || !c.areaInside) throw new Error('Кнопка или поле композера вылезли из пилюли');
  if (!near(c.insideLeft, c.insideRight, 12)) throw new Error(`Композер смещён: ${c.insideLeft}/${c.insideRight}`);
  console.log('✔ композер собран ровно');

  // ---------- Окна не выходят за пределы окна ----------
  await js(win, `openSettings('profile'); true`);
  await sleep(600);
  const modal = await js(win, `(() => {
    const card = document.querySelector('#settings .modal-card').getBoundingClientRect();
    return JSON.stringify({ left: Math.round(card.left), top: Math.round(card.top), right: Math.round(innerWidth - card.right), bottom: Math.round(innerHeight - card.bottom) });
  })()`);
  const m = JSON.parse(modal);
  if (m.left < 0 || m.top < 0 || m.right < 0 || m.bottom < 0) throw new Error('Окно настроек выходит за пределы экрана');
  console.log('✔ окна не выходят за пределы экрана');

  // ---------- Панель трансляции не под кнопками окна (Windows) ----------
  const fullview = await js(win, `(() => {
    const bar = document.querySelector('.fullview-bar');
    const style = getComputedStyle(bar);
    return JSON.stringify({ padRight: parseFloat(style.paddingRight), isWin: document.documentElement.classList.contains('is-win') });
  })()`);
  const f = JSON.parse(fullview);
  if (f.isWin && f.padRight < 120) throw new Error(`Панель трансляции налезет на кнопки окна: отступ ${f.padRight}px`);
  console.log('✔ панель трансляции не пересекается с кнопками окна');

  // ---------- Жидкий индикатор вкладок: перетекает под активную кнопку ----------
  await js(win, `document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); showScreen('main'); true`);
  await sleep(600);
  const pill = await js(win, `(async () => {
    const root = document.getElementById('friend-tabs');
    const pill = root?.querySelector('.liquid-pill');
    if (!pill) return JSON.stringify({ error: 'нет индикатора' });
    const second = root.querySelectorAll('button')[1];
    second.click();
    await new Promise((r) => setTimeout(r, 550));
    const box = root.getBoundingClientRect();
    const active = root.querySelector('button.active');
    const r = active.getBoundingClientRect();
    const pr = pill.getBoundingClientRect();
    return JSON.stringify({
      pillLeft: Math.round(pr.left - box.left),
      activeLeft: Math.round(r.left - box.left),
      pillW: Math.round(pr.width),
      activeW: Math.round(r.width),
      activeBg: getComputedStyle(active).backgroundColor,
    });
  })()`);
  const tab = JSON.parse(pill);
  if (tab.error) throw new Error(`Вкладки: ${tab.error}`);
  if (Math.abs(tab.pillLeft - tab.activeLeft) > 2)
    throw new Error(`Индикатор вкладки не совпал: ${tab.pillLeft} против ${tab.activeLeft}`);
  if (Math.abs(tab.pillW - tab.activeW) > 3)
    throw new Error(`Индикатор вкладки не по ширине: ${tab.pillW} против ${tab.activeW}`);
  if (tab.activeBg !== 'rgba(0, 0, 0, 0)' && tab.activeBg !== 'transparent')
    throw new Error(`У активной вкладки свой фон поверх индикатора: ${tab.activeBg}`);
  console.log('✔ жидкий индикатор вкладок на месте');

  // ---------- Радиокнопки: круг 18 px, текст не наезжает ----------
  await js(win, `document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); selectContact(${b.user.id}); true`);
  await sleep(500);
  await js(win, `document.getElementById('chat-theme-btn').click(); true`);
  await sleep(400);
  const radio = await js(win, `(() => {
    const scope = document.querySelector('.chat-theme-scope');
    const box = scope?.querySelector('input[type=radio]');
    if (!box) return JSON.stringify({ error: 'нет радиокнопок' });
    const r = box.getBoundingClientRect();
    const label = box.closest('label').getBoundingClientRect();
    const cs = getComputedStyle(box);
    return JSON.stringify({
      w: Math.round(r.width), h: Math.round(r.height),
      radius: cs.borderRadius, height: cs.height, padding: cs.padding,
      gapToText: Math.round(label.width - r.width),
    });
  })()`);
  const rd = JSON.parse(radio);
  if (rd.error) throw new Error(`Тема чата: ${rd.error}`);
  if (rd.w > 22 || rd.h > 22) throw new Error(`Радиокнопка раздулась: ${rd.w}x${rd.h}`);
  if (!/50%|999px/.test(rd.radius)) throw new Error(`Радиокнопка не круглая: ${rd.radius}`);
  if (rd.height !== '18px' || rd.padding !== '0px') throw new Error(`К радиокнопке применились стили поля: ${rd.height}, ${rd.padding}`);
  console.log('✔ радиокнопки — ровные круги, без стилей поля');

  // ---------- Анимации только для стекла; рейл без рамок вокруг аватарок ----------
  const themes = await js(win, `(async () => {
    const out = {};
    document.documentElement.dataset.theme = 'sozvon';
    await new Promise((r) => setTimeout(r, 120));
    out.pillOnDefault = Boolean(document.querySelector('.liquid-pill'));
    document.documentElement.dataset.theme = 'glass';
    await new Promise((r) => setTimeout(r, 200));
    out.pillOnGlass = Boolean(document.querySelector('.liquid-pill'));
    const item = document.querySelector('.rail-item');
    const tile = item && item.querySelector('.rail-tile');
    const cs = item ? getComputedStyle(item) : null;
    out.itemBorder = cs ? cs.borderTopWidth : null;
    out.itemBg = cs ? cs.backgroundColor : null;
    if (tile) {
      const ir = item.getBoundingClientRect();
      const tr = tile.getBoundingClientRect();
      out.tileInside = tr.left >= ir.left - 1 && tr.right <= ir.right + 1;
    }
    document.documentElement.dataset.theme = 'sozvon';
    return JSON.stringify(out);
  })()`);
  const th = JSON.parse(themes);
  if (th.pillOnDefault) throw new Error('Жидкая подложка осталась в обычной теме');
  if (!th.pillOnGlass) throw new Error('В теме стекла пропала жидкая подложка вкладок');
  if (th.itemBorder !== '0px') throw new Error(`У обёртки канала рамка ${th.itemBorder} — она выезжает за аватарку`);
  if (th.itemBg !== 'rgba(0, 0, 0, 0)') throw new Error(`У обёртки канала свой фон: ${th.itemBg}`);
  if (th.tileInside === false) throw new Error('Плитка канала вылезает за обёртку');
  console.log('✔ анимации только в стекле, рейл без рамок вокруг аватарок');

  // ---------- Каналы с картинкой не обрезаются кругом ----------
  await js(win, `openHub(${hub.id}); true`);
  await sleep(500);
  const photo = await js(win, `(() => {
    const tile = document.querySelector('.rail-tile.has-image');
    if (!tile) return JSON.stringify({ skip: true });
    const cs = getComputedStyle(tile);
    return JSON.stringify({ radius: cs.borderRadius, size: Math.round(tile.getBoundingClientRect().width), bg: Boolean(cs.backgroundImage && cs.backgroundImage !== 'none') });
  })()`);
  const ph = JSON.parse(photo);
  if (!ph.skip) {
    if (/50%/.test(ph.radius)) throw new Error('Плитка канала с картинкой обрезана кругом');
    if (ph.bg !== true) throw new Error('У плитки канала пропала картинка');
  }
  console.log('✔ каналы с картинкой — скруглённый квадрат, фото не обрезано');

  // ---------- Адаптив: 480 / 760 / 1280 ----------
  for (const width of [480, 760, 1280]) {
    win.setSize(width, 900);
    await sleep(550);
    const probe = await js(win, `(() => {
      const out = { width: innerWidth, scroll: document.documentElement.scrollWidth, overflow: [] };
      for (const sel of ['.composer-bar', '.chat-head', '.sidebar', '.content', '.call-panel']) {
        const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.right > innerWidth + 1 || r.left < -1)
          out.overflow.push(sel + ':' + Math.round(r.left) + '..' + Math.round(r.right));
      }
      const visible = (sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length); };
      out.sidebarVisible = visible('.sidebar');
      out.railVisible = visible('.rail');
      return JSON.stringify(out);
    })()`);
    const row = JSON.parse(probe);
    if (row.scroll > row.width + 2) throw new Error(`На ${width}px горизонтальный скролл ${row.scroll} > ${row.width}`);
    if (row.overflow.length) throw new Error(`На ${width}px вылезают за экран: ${row.overflow.join(', ')}`);
    if (width <= 760 && row.sidebarVisible) throw new Error(`На ${width}px сайдбар должен быть скрыт`);
    if (width === 1280 && !row.sidebarVisible) throw new Error('На 1280px сайдбар должен быть виден');
  }
  win.setSize(1280, 900);
  await sleep(400);
  console.log('✔ адаптив 480 / 760 / 1280 без переполнений');
});
