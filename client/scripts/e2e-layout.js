// Проверка геометрии интерфейса: ничего не съезжает, не налезает и не вылезает.
// Запуск (сервер должен работать): node_modules/electron/dist/electron.exe scripts/e2e-layout.js
const { api, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

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

  // ---------- Стеклянный каркас: одна поверхность, без щелей и висящих линий ----------
  const shell = await js(win, `(() => {
    const rail = document.querySelector('.rail').getBoundingClientRect();
    const side = document.querySelector('.sidebar').getBoundingClientRect();
    const content = document.querySelector('.content').getBoundingClientRect();
    const mainEl = document.querySelector('.main');
    const main = mainEl.getBoundingClientRect();
    const divider = document.querySelector('.main-divider');
    const tabs = document.querySelector('.friend-tabs');
    const railTiles = [...document.querySelectorAll('#rail-list .rail-tile')].filter((t) => t.getClientRects().length);
    const railTileWidths = railTiles.map((t) => Math.round(t.getBoundingClientRect().width));
    const contentEl = document.querySelector('.content');
    const contentCss = getComputedStyle(contentEl);
    const tile = railTiles[0];
    if (tile) tile.classList.add('rail-pop');
    const popAnim = tile ? getComputedStyle(tile).animationName : 'none';
    if (tile) tile.classList.remove('rail-pop');
    return JSON.stringify({
      railToSide: Math.round(side.left - rail.right),
      sideToContent: Math.round(content.left - side.right),
      mainHeight: Math.round(main.height),
      innerHeight: window.innerHeight,
      dividerShown: divider ? getComputedStyle(divider).display !== 'none' : false,
      mainFilter: getComputedStyle(mainEl).backdropFilter,
      contentFilter: contentCss.backdropFilter,
      contentRadius: contentCss.borderTopLeftRadius,
      titlebarZ: getComputedStyle(document.getElementById('titlebar')).zIndex,
      railWidth: Math.round(rail.width),
      railTileWidths,
      popAnim,
      overflowX: document.documentElement.scrollWidth - innerWidth,
      tabsOverflow: tabs ? tabs.scrollWidth - tabs.clientWidth : 0,
    });
  })()`);
  const sh = JSON.parse(shell);
  if (!near(sh.railToSide, 0)) throw new Error(`Щель между рейлом и списком: ${sh.railToSide}px`);
  if (!near(sh.sideToContent, 0)) throw new Error(`Щель между списком и контентом: ${sh.sideToContent}px`);
  if (sh.dividerShown) throw new Error('Линия-разделитель снова висит в зазоре');
  if (sh.overflowX > 0) throw new Error(`Появилась горизонтальная прокрутка: ${sh.overflowX}px`);
  if (sh.tabsOverflow > 0) throw new Error(`Вкладки друзей обрезаны: ${sh.tabsOverflow}px`);
  if (sh.mainHeight < sh.innerHeight * 0.8) throw new Error('Каркас сжался по высоте');
  if (sh.mainFilter !== 'none') throw new Error(`У полнооконного каркаса остался backdrop-filter: ${sh.mainFilter}`);
  if (sh.contentFilter !== 'none') throw new Error(`У контента остался backdrop-filter: ${sh.contentFilter}`);
  if (sh.contentRadius !== '0px') throw new Error(`Контент снова стал карточкой внутри окна: radius ${sh.contentRadius}`);
  if (!Number.isFinite(Number(sh.titlebarZ)) || Number(sh.titlebarZ) < 2) throw new Error(`Полоса заголовка под фоновым слоем: z-index ${sh.titlebarZ}`);
  if (sh.railTileWidths.some((w) => w > sh.railWidth - 8)) throw new Error(`Плитка канала шире рейла: ${sh.railTileWidths.join(', ')} при ${sh.railWidth}`);
  if (new Set(sh.railTileWidths).size > 1) throw new Error(`Плитки каналов разного размера: ${sh.railTileWidths.join(', ')}`);
  if (sh.popAnim !== 'rail-pop-soft') throw new Error(`У плитки канала пропала мягкая анимация выбора: ${sh.popAnim}`);
  console.log('✔ стеклянный каркас: без щелей, висящих линий и обрезки');
  // Tooltip рейла не должен становиться flex-ребёнком и растягиваться на всю высоту
  const railTip = await js(win, `(() => {
    const tile = document.querySelector('#rail-list .rail-tile[data-tip], .rail-tile[data-tip]');
    if (!tile) return 'none';
    tile.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));
    const tip = document.getElementById('rail-tip');
    const c = getComputedStyle(tip);
    const r = tip.getBoundingClientRect();
    const out = { pos: c.position, h: Math.round(r.height), w: Math.round(r.width), text: tip.textContent.slice(0, 30) };
    tip.classList.add('hidden');
    return JSON.stringify(out);
  })()`);
  if (railTip !== 'none') {
    const rt = JSON.parse(railTip);
    if (rt.pos !== 'fixed') throw new Error(`Подсказка рейла снова в потоке: ${rt.pos}`);
    if (rt.h > 100) throw new Error(`Подсказка рейла растянута на ${rt.h}px`);
    if (rt.w > 260) throw new Error(`Подсказка рейла слишком широкая: ${rt.w}px`);
  }
  console.log('✔ подсказка рейла — компактный фиксированный слой');
  // ---------- Кнопки просмотра трансляции не заходят под кнопки окна ----------
  for (const [width, height] of [[1100, 720], [820, 620]]) {
    await js(win, `document.documentElement.style.setProperty('--audit-width','${width}px'); true`);
    win.setContentSize(width, height);
    await sleep(500);
    const fv = JSON.parse(await js(win, `(() => {
      const f = document.getElementById('fullview');
      f.classList.remove('hidden'); f.classList.add('show-bar');
      const bar = f.querySelector('.fullview-bar');
      const cs = getComputedStyle(bar);
      const buttons = [...bar.querySelectorAll('.btn')].map((b) => b.getBoundingClientRect());
      const labels = [...bar.querySelectorAll('.btn .label')].map((b) => getComputedStyle(b).display);
      const out = {
        top: parseFloat(cs.paddingTop),
        right: Math.max(...buttons.map((b) => b.right)),
        firstTop: Math.min(...buttons.map((b) => b.top)),
        inner: innerWidth,
        labels,
      };
      return JSON.stringify(out);
    })()`));
    if (fv.top < 40) throw new Error(`Кнопки полн(о)экранного просмотра под кнопками окна: отступ сверху ${fv.top}px`);
    if (fv.right > fv.inner - 140) throw new Error(`Кнопки просмотра заходят под кнопки окна: правый край ${Math.round(fv.right)} при ширине ${fv.inner}`);
    if (fv.inner <= 900 && fv.labels.some((v) => v !== 'none')) throw new Error('На узком окне подписи кнопок просмотра не скрыты');
    await js(win, `document.getElementById('fullview').classList.add('hidden'); true`);
  }
  win.setContentSize(1100, 720); await sleep(300);
  console.log('✔ кнопки просмотра трансляции не пересекают кнопки окна');

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

  // ---------- Вкладки: одна стеклянная плашка, которая переезжает к активной ----------
  await js(win, `document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); showScreen('main'); true`);
  await sleep(600);
  const tabsState = JSON.parse(await js(win, `(async () => {
    const root = document.getElementById('friend-tabs');
    const oldPill = root?.querySelector('.liquid-pill');
    const second = root?.querySelectorAll('button')[1];
    second?.click();
    await new Promise((r) => setTimeout(r, 320));
    const active = root?.querySelector('button.active');
    const ind = root?.querySelector('.glass-tab-indicator');
    const ir = ind?.getBoundingClientRect();
    const ar = active?.getBoundingClientRect();
    return JSON.stringify({
      oldPill: Boolean(oldPill),
      activeText: active?.textContent || '',
      activeBg: active ? getComputedStyle(active).backgroundColor : '',
      activeBox: active ? Math.round(ar.width) : 0,
      hasIndicator: Boolean(ind),
      indicatorHidden: ind ? ind.hidden : true,
      indicatorLeft: ir ? Math.round(ir.left) : 0,
      indicatorWidth: ir ? Math.round(ir.width) : 0,
      activeLeft: ar ? Math.round(ar.left) : 0,
      activeWidth: ar ? Math.round(ar.width) : 0,
      indicatorRadius: ind ? getComputedStyle(ind).borderRadius : '',
    });
  })()`));
  if (tabsState.oldPill) throw new Error('Вкладки: вернулась старая подложка .liquid-pill');
  if (!tabsState.activeText) throw new Error('Вкладки: нет активной вкладки');
  if (!tabsState.activeBox) throw new Error('Вкладки: активная вкладка схлопнулась');
  if (!tabsState.hasIndicator || tabsState.indicatorHidden) throw new Error('Вкладки: нет стеклянной плашки-указателя');
  if (Math.abs(tabsState.indicatorLeft - tabsState.activeLeft) > 2)
    throw new Error(`Плашка вкладки не совпала по X: ${tabsState.indicatorLeft} против ${tabsState.activeLeft}`);
  if (Math.abs(tabsState.indicatorWidth - tabsState.activeWidth) > 3)
    throw new Error(`Плашка вкладки не совпала по ширине: ${tabsState.indicatorWidth} против ${tabsState.activeWidth}`);
  if (tabsState.indicatorRadius === '0px') throw new Error('У плашки вкладки нет скругления');
  if (tabsState.activeBg !== 'rgba(0, 0, 0, 0)' && tabsState.activeBg !== 'transparent')
    throw new Error(`У активной вкладки двойная заливка поверх плашки: ${tabsState.activeBg}`);
  console.log('✔ стеклянная плашка вкладок двигается к активной');

  // Вертикальные вкладки настроек — та же плашка, только едет по Y
  await js(win, `openSettings('look'); true`);
  await sleep(500);
  const setNavTab = JSON.parse(await js(win, `(() => {
    const root = document.getElementById('set-nav');
    const active = root?.querySelector(':scope > button[data-tab].active');
    const ind = root?.querySelector('.glass-tab-indicator');
    const ar = active?.getBoundingClientRect();
    const ir = ind?.getBoundingClientRect();
    return JSON.stringify({
      active: active?.textContent || '',
      hasIndicator: Boolean(ind),
      hidden: ind ? ind.hidden : true,
      topDiff: ar && ir ? Math.round(ir.top - ar.top) : 999,
      heightDiff: ar && ir ? Math.round(ir.height - ar.height) : 999,
    });
  })()`));
  if (!setNavTab.active) throw new Error('Настройки: нет активной вкладки');
  if (!setNavTab.hasIndicator || setNavTab.hidden) throw new Error('Настройки: нет вертикальной плашки');
  if (Math.abs(setNavTab.topDiff) > 2) throw new Error(`Вертикальная плашка не совпала по Y: ${setNavTab.topDiff}`);
  if (Math.abs(setNavTab.heightDiff) > 3) throw new Error(`Вертикальная плашка не совпала по высоте: ${setNavTab.heightDiff}`);
  await js(win, 'closeSettings(); true');
  console.log('✔ вертикальная плашка настроек на месте');

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
  if (th.pillOnGlass) throw new Error('В теме стекла вернулась старая перетекающая подложка вкладок');
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

  // ---------- Центровка иконок во всех кнопках ----------
  const icons = await js(win, `(() => {
    const bad = [];
    for (const btn of document.querySelectorAll('.icon-btn, .round-btn, .composer-btn')) {
      if (!btn.getClientRects().length) continue;
      const svg = btn.querySelector('svg');
      if (!svg) continue;
      const b = btn.getBoundingClientRect();
      const s = svg.getBoundingClientRect();
      const dx = (s.left - b.left) - (b.right - s.right);
      const dy = (s.top - b.top) - (b.bottom - s.bottom);
      if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5)
        bad.push((btn.id || btn.className) + ' parent=' + (btn.parentElement?.className || '') + ' pad=' + getComputedStyle(btn).padding + ' ' + dx.toFixed(1) + '/' + dy.toFixed(1));
    }
    return JSON.stringify(bad);
  })()`);
  const misaligned = JSON.parse(icons);
  if (misaligned.length) throw new Error(`Иконки не по центру: ${misaligned.join(', ')}`);
  console.log('✔ иконки в кнопках отцентрованы');

  // ---------- Списки не красят себя: фон даёт панель ----------
  const tinted = await js(win, `(() => {
    const bad = [];
    for (const sel of ['.contact-list', '.friends-body', '#room-list', '.sidebar-scroll', '.messages', '.set-body']) {
      for (const el of document.querySelectorAll(sel)) {
        if (!el.getClientRects().length) continue;
        const bg = getComputedStyle(el).backgroundColor;
        const m = bg.match(/rgba?\\(([^)]+)\\)/);
        const alpha = m ? Number(m[1].split(',')[3] ?? 1) : 1;
        if (alpha > 0.02) bad.push(sel + '=' + bg);
      }
    }
    return JSON.stringify(bad);
  })()`);
  const tintedLists = JSON.parse(tinted);
  if (tintedLists.length) throw new Error(`У списков свой фон (полоса другого тона): ${tintedLists.join(', ')}`);
  console.log('✔ списки не красят себя');
});
