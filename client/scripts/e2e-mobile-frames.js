// Одно окно на телефоне и фолде: снаружи один радиус, внутри — только секции.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('frames' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('frames', a);
  w.setSize(673, 841);
  w.show();
  w.focus();
  await sleep(700);

  const themes = JSON.parse(await js(w, `JSON.stringify(THEMES.map((t) => t.id))`));
  const failures = [];
  for (const theme of themes) {
    await js(w, `setTheme('${theme}'); true`);
    await sleep(260);
    const data = JSON.parse(
      await js(w, `(() => {
        const pick = (sel) => {
          const el = document.querySelector(sel);
          if (!el || !el.getClientRects().length) return null;
          const s = getComputedStyle(el);
          return { radius: s.borderRadius, bg: s.backgroundColor, shadow: s.boxShadow };
        };
        const main = document.querySelector('.main');
        const ms = getComputedStyle(main);
        return JSON.stringify({
          theme: document.documentElement.dataset.themeId || document.documentElement.dataset.theme,
          mainRadius: parseFloat(ms.borderRadius),
          sidebar: pick('.sidebar'),
          content: pick('.content'),
          rail: pick('.rail'),
        });
      })()`)
    );
    if (!(data.mainRadius > 0)) failures.push(`${theme}: у главного окна нет радиуса`);
    for (const [name, part] of Object.entries({ sidebar: data.sidebar, content: data.content, rail: data.rail })) {
      if (!part) continue;
      if (parseFloat(part.radius) !== 0) failures.push(`${theme}: ${name} имеет свой радиус ${part.radius}`);
      if (part.bg !== 'rgba(0, 0, 0, 0)' && part.bg !== 'transparent') failures.push(`${theme}: ${name} имеет свой фон ${part.bg}`);
      if (part.shadow !== 'none') failures.push(`${theme}: ${name} имеет тень ${part.shadow}`);
    }
  }

  // На телефоне тоже одно окно, без карточки контента
  w.setSize(390, 844);
  await sleep(500);
  await js(w, `setTheme('glass'); true`);
  await sleep(300);
  const phone = JSON.parse(
    await js(w, `(() => {
      const c = getComputedStyle(document.querySelector('.content'));
      const m = getComputedStyle(document.querySelector('.main'));
      return JSON.stringify({ contentRadius: c.borderRadius, contentBg: c.backgroundColor, mainRadius: m.borderRadius });
    })()`)
  );
  if (parseFloat(phone.contentRadius) !== 0 || phone.contentBg !== 'rgba(0, 0, 0, 0)' || !(parseFloat(phone.mainRadius) > 0)) {
    failures.push('телефон: контент снова стал отдельной карточкой');
  }

  if (failures.length) throw new Error(failures.slice(0, 8).join('; '));
  console.log(`✔ одно окно без вложенных рамок во всех ${themes.length} темах`);
});
