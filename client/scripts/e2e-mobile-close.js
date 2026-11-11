// Закрытие экранов на Android: кнопок закрытия быть не должно вообще.
// Системный back + стрелка в TopAppBar — единственная навигация.
//
// Почему этот тест существует: mobile-navigation.css прячет крестики списком id c
// display:none. Любой крестик вне списка (динамически созданный, из другого модуля)
// остаётся на экране и его никто не замечает. Здесь проверка идёт по СМЫСЛУ, а не по
// списку id: иконка X, title «Закрыть», aria-label, текст ×. Новый крестик попадёт
// сюда автоматически, даже если о нём забыли.
const { register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

// Возвращает массив подозрительных элементов: { tag, id, cls, why, text }
const SCAN = `(() => {
  const out = [];
  const hits = (el) => {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 4 || r.height < 4) return null;
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return null;
    if (r.bottom < 0 || r.top > innerHeight) return null;

    const label = ((el.getAttribute('title') || '') + ' ' +
                   (el.getAttribute('aria-label') || '') + ' ' +
                   (el.getAttribute('data-tooltip') || '')).toLowerCase();
    if (/закрыть|close|dismiss/.test(label)) return 'title/aria-label закрытия';

    // Крестик текстом или путём иконки. X-образный путь: начинается с M и содержит
    // переход между противоположными углами (18 6 ... 6 18 — так рисуется ×).
    const txt = (el.textContent || '').trim();
    if (/^[×✕✖╳xX]$/.test(txt)) return 'символ крестика';
    for (const p of el.querySelectorAll('path')) {
      const d = (p.getAttribute('d') || '').replace(/\\s+/g, ' ').trim();
      if (/^M ?1[0-9] [0-9] ?L? ?[0-9] [0-9]+|M ?18 ?6 ?6 ?18M ?6 ?6 ?12 ?12|M ?6 ?6 ?l?12 ?12|M ?1[0-9] ?[0-9] ?\\.?\\d* ?6/.test(d) &&
          /M ?\\d+ ?\\d+/.test(d) && d.length < 60) {
        // уточняем: путь должен содержать две диагонали (крест), а не одну линию
        if (/M[^A-Za-z]*?[0-9]+ [0-9]+[^A-Za-z]*?[0-9]+ [0-9]+/.test(d)) return 'иконка крестика';
      }
    }
    const cls = (el.className || '').toString();
    if (/(^|[\\s_-])(close|dismiss)([\\s_-]|$)/i.test(cls) &&
        !/hidden|\\.hidden/.test(cls)) {
      // сам класс может быть на обёртке — тогда крестик ищется внутри
    }
    return null;
  };

  for (const el of document.querySelectorAll('button, [role="button"], a')) {
    const why = hits(el);
    if (why) out.push({
      tag: el.tagName,
      id: el.id || '',
      cls: (el.className || '').toString().slice(0, 60),
      why,
      text: (el.textContent || '').trim().slice(0, 24),
    });
  }
  return JSON.stringify(out);
})()`;

async function assertNoClose(w, where, allow = []) {
  const raw = await js(w, SCAN);
  const found = JSON.parse(raw).filter((f) => !allow.includes(f.id));
  if (found.length) {
    throw new Error(
      `на экране «${where}» есть кнопки закрытия — на Android закрывает системный back:\n` +
      found.map((f) => `  · <${f.tag.toLowerCase()}> id="${f.id}" class="${f.cls}" — ${f.why} «${f.text}»`).join('\n')
    );
  }
  console.log(`  ✓ ${where}: кнопок закрытия нет`);
}

// Шапка: контент не под треем и не вылезает за границы самой шапки.
async function assertHeader(w, sel, where, safeTop) {
  const raw = await js(w, `(() => {
    const head = document.querySelector('${sel}');
    if (!head) return JSON.stringify({ missing: true });
    const hr = head.getBoundingClientRect();
    const items = [...head.querySelectorAll('button, h1, h2, h3, h4, span, svg')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width < 2 || r.height < 2 || cs.display === 'none' || cs.visibility === 'hidden') return null;
        return { tag: el.tagName, id: el.id || '', top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
                 left: +r.left.toFixed(1), right: +r.right.toFixed(1) };
      }).filter(Boolean);
    return JSON.stringify({ head: { top: +hr.top.toFixed(1), bottom: +hr.bottom.toFixed(1),
                                    left: +hr.left.toFixed(1), right: +hr.right.toFixed(1) }, items });
  })()`);
  const d = JSON.parse(raw);
  if (d.missing) throw new Error(`не найден элемент шапки ${sel} (${where})`);

  const problems = [];
  for (const it of d.items) {
    if (it.top < safeTop - 1) problems.push(`<${it.tag.toLowerCase()} #${it.id}> начинается на ${it.top}px — под треем (safe-top ${safeTop}px)`);
    if (it.bottom > d.head.bottom + 1) problems.push(`<${it.tag.toLowerCase()} #${it.id}> вылезает за низ шапки на ${(it.bottom - d.head.bottom).toFixed(1)}px`);
    if (it.right > d.head.right + 1) problems.push(`<${it.tag.toLowerCase()} #${it.id}> вылезает за правый край шапки`);
  }

  // Пересечение соседних элементов шапки (крестик налез на карточку/заголовок).
  const boxes = d.items.filter((i) => i.tag !== 'SPAN');
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 1) {
        problems.push(`<${a.tag.toLowerCase()} #${a.id}> и <${b.tag.toLowerCase()} #${b.id}> пересекаются (${ox.toFixed(0)}×${oy.toFixed(0)}px)`);
      }
    }
  }

  if (problems.length) {
    throw new Error(`шапка ${sel} (${where}):\n` + problems.map((p) => '  · ' + p).join('\n'));
  }
  console.log(`  ✓ ${where}: шапка ниже трея, без наложений`);
}

runTest(async () => {
  const a = await register('cls' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('close', a);
  w.setSize(390, 844);
  w.show();
  await sleep(700);

  // Эмулируем трей: DevTools и обычный Chromium отдают env() = 0, реальный Android — нет.
  await js(w, `document.documentElement.style.setProperty('--safe-area-inset-top','36px'); true`);
  await sleep(200);

  console.log('Проверка кнопок закрытия и шапок на Android (390×844, safe-top 36):');

  await assertNoClose(w, 'главный экран');

  await js(w, `openSettings(); true`);
  await waitFor(w, `!document.getElementById('settings').classList.contains('hidden')`, 'settings');
  await sleep(400);
  await assertNoClose(w, 'настройки: корень');
  await assertHeader(w, '#settings .rs-head', 'настройки: корень', 36);

  // Все разделы. Здесь ловятся крестики, которые создаются внутри панелей
  // (выбор фона, меню громкости и т.п.), а не в самом index.html.
  const tabs = ['profile', 'look', 'sound', 'notify', 'account', 'privacy', 'about'];
  for (const tab of tabs) {
    const exists = await js(w, `Boolean(document.querySelector('#set-nav [data-tab="${tab}"]'))`);
    if (!exists) continue;
    await js(w, `document.querySelector('#set-nav [data-tab="${tab}"]').click(); true`);
    await sleep(350);
    await assertNoClose(w, `настройки: ${tab}`);
    await assertHeader(w, '#settings .rs-head', `настройки: ${tab}`, 36);
    // из раздела — обратно в корень, иначе следующая итерация кликает по скрытому меню
    await js(w, `document.getElementById('mobile-settings-back').click(); true`);
    await sleep(250);
  }

  // Системный back из раздела возвращает в корень, а не закрывает настройки целиком.
  await js(w, `document.querySelector('#set-nav [data-tab="sound"]').click(); true`);
  await sleep(300);
  const inSection = await js(w, `document.body.classList.contains('mobile-settings-section')`);
  if (!inSection) throw new Error('не вошли в раздел настроек — back-тест невозможен');
  const handled = await js(w, `window.sozvonBack()`);
  if (!handled) throw new Error('sozvonBack вернул false в разделе настроек — приложение выйдет из себя');
  await sleep(300);
  const backToRoot = await js(w, `(() => {
    const s = document.getElementById('settings');
    return JSON.stringify({ open: !s.classList.contains('hidden'),
                            section: document.body.classList.contains('mobile-settings-section') });
  })()`).then(JSON.parse);
  if (!backToRoot.open) throw new Error('back из раздела закрыл настройки целиком вместо возврата в список');
  if (backToRoot.section) throw new Error('back из раздела не вернул в корень настроек');
  console.log('  ✓ back из раздела → корень, настройки остались открыты');

  // back из корня закрывает настройки, но не приложение.
  const closed = await js(w, `window.sozvonBack()`);
  await sleep(300);
  const stillHere = await js(w, `!document.getElementById('settings').classList.contains('hidden')`);
  if (stillHere) throw new Error('back из корня настроек не закрыл модалку');
  if (!closed) throw new Error('back из корня настроек вернул false — приложение выйдет из себя');
  console.log('  ✓ back из корня закрыл настройки, приложение живо');

  // Панель уведомлений — там кнопка создаётся в JS (mobile.js), а прячется в CSS.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"], #mobile-notif-btn')?.click(); true`);
  await sleep(500);
  await assertNoClose(w, 'уведомления');
});
