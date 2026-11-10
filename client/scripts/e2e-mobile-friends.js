// Верхнее меню друзей на телефоне и фолде: одна строка, первый таб не срезан,
// заголовок не делит строку с вкладками, лента прокручивается.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('friends' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('friends', a);
  w.show();
  w.focus();
  await sleep(700);

  const themes = JSON.parse(await js(w, `JSON.stringify(THEMES.map((t) => t.id))`));
  const failures = [];
  for (const size of [[390, 844], [673, 841]]) {
    w.setSize(size[0], size[1]);
    await sleep(450);
    for (const theme of themes) {
      await js(w, `setTheme('${theme}'); selectContact(null); true`);
      await sleep(220);
      const data = JSON.parse(
        await js(w, `(() => {
          const head = document.querySelector('.friends-head').getBoundingClientRect();
          const tabs = document.getElementById('friend-tabs');
          const tr = tabs.getBoundingClientRect();
          const first = tabs.querySelector('button').getBoundingClientRect();
          const active = tabs.querySelector('button.active')?.getBoundingClientRect();
          const s = getComputedStyle(tabs);
          return JSON.stringify({
            head: { top: head.top, bottom: head.bottom, left: head.left, right: head.right },
            tabs: { top: tr.top, bottom: tr.bottom, left: tr.left, right: tr.right, scrollWidth: tabs.scrollWidth, clientWidth: tabs.clientWidth },
            first: { left: first.left, right: first.right },
            active: active ? { left: active.left, right: active.right } : null,
            wrap: s.flexWrap,
            display: s.display,
          });
        })()`)
      );
      const prefix = `${size[0]} ${theme}`;
      if (data.wrap !== 'nowrap') failures.push(`${prefix}: вкладки переносятся (${data.wrap})`);
      if (data.first.left < data.tabs.left - 1) failures.push(`${prefix}: первая вкладка срезана слева`);
      if (data.first.right > data.head.right + 1) failures.push(`${prefix}: первая вкладка вылезает`);
      if (data.tabs.bottom > data.head.bottom + 1) failures.push(`${prefix}: лента ниже шапки`);
      if (data.active && (data.active.left < data.head.left - 1 || data.active.right > data.head.right + 1)) {
        failures.push(`${prefix}: активная вкладка вне шапки`);
      }
    }
  }

  if (failures.length) throw new Error(failures.slice(0, 8).join('; '));
  console.log(`✔ меню друзей ровное на телефоне и фолде во всех ${themes.length} темах`);
});
