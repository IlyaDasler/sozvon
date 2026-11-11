// Низ длинных разделов настроек: последние кнопки доступны, не под футером/меню.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

const bottomCheck = (w, label) => js(w, `(() => {
  const body = document.querySelector('#settings .set-body');
  body.scrollTop = body.scrollHeight;
  const br = body.getBoundingClientRect();
  const buttons = [...document.querySelectorAll('#settings .set-pane:not(.hidden) button, #settings .set-pane:not(.hidden) [role="button"]')]
    .filter((b) => {
      if (!b.getClientRects().length || getComputedStyle(b).display === 'none') return false;
      const r = b.getBoundingClientRect();
      return r.bottom > br.top + 2 && r.top < br.bottom - 2;
    });
  const last = buttons[buttons.length - 1];
  if (!last) return JSON.stringify({ label: ${JSON.stringify(label)}, none: true });
  const r = last.getBoundingClientRect();
  const top = document.elementFromPoint(Math.round(r.left + Math.min(r.width / 2, 12)), Math.round(r.top + Math.min(r.height / 2, 12)));
  return JSON.stringify({
    label: ${JSON.stringify(label)},
    text: (last.textContent || last.id || last.className).trim().slice(0, 40),
    bottom: Math.round(r.bottom), vh: innerHeight,
    navTop: Math.round(document.getElementById('mobile-nav').getBoundingClientRect().top),
    hit: Boolean(top && (last === top || last.contains(top) || top.contains(last))),
    topEl: top ? (top.id || top.className || top.tagName) : null,
  });
})()`);

runTest(async () => {
  const a = await register('ss' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('ss', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500);

  for (const tab of ['look', 'sound', 'notify', 'account', 'privacy']) {
    await js(w, `document.querySelector('#set-nav > button[data-tab="${tab}"]').click(); true`);
    await sleep(450);
    const check = async (suffix = '') => {
      const d = JSON.parse(await bottomCheck(w, tab + suffix));
      console.log('bottom', JSON.stringify(d));
      if (d.none) return;
      if (d.bottom > d.navTop + 1) throw new Error(tab + ': последняя кнопка под нижним меню: ' + JSON.stringify(d));
      if (!d.hit) throw new Error(tab + ': последняя кнопка перекрыта (' + d.topEl + '): ' + JSON.stringify(d));
    };
    await check();
    if (tab === 'privacy') {
      for (const page of ['profile', 'contact', 'crypto']) {
        await js(w, `showPrivacyPage('${page}'); true`);
        await sleep(250);
        await check('-' + page);
      }
    }
    await js(w, `document.getElementById('mobile-settings-back').click(); true`);
    await sleep(250);
  }
});
