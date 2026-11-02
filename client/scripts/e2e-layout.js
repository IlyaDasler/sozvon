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
});
