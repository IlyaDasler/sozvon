// Мобильные настройки: каждый видимый раздел открывается кнопкой, без переполнения.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('set' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('set', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(800);
  await js(w, `openSettings(); true`);
  await sleep(500);

  const rows = JSON.parse(await js(w, `JSON.stringify([...document.querySelectorAll('#set-nav > button[data-tab]')]
    .filter((b) => b.getClientRects().length && getComputedStyle(b).display !== 'none')
    .map((b) => ({ tab: b.dataset.tab, sub: b.dataset.sub || '' })))`));
  console.log('settings-tabs', JSON.stringify(rows));
  if (!rows.length) throw new Error('в настройках нет разделов');
  for (const row of rows) {
    await js(w, `document.querySelector('#set-nav > button[data-tab="${row.tab}"][data-sub="${row.sub}"]').click(); true`);
    await sleep(350);
    const d = JSON.parse(await js(w, `(() => {
      const card = document.querySelector('#settings .set-card').getBoundingClientRect();
      const panes = [...document.querySelectorAll('#settings .set-pane')].filter((p) => p.getClientRects().length && getComputedStyle(p).display !== 'none');
      return JSON.stringify({
        body: document.body.className,
        cardLeft: Math.round(card.left), cardRight: Math.round(card.right),
        vw: innerWidth, doc: document.documentElement.scrollWidth,
        panes: panes.map((p) => p.dataset.pane),
      });
    })()`));
    console.log('settings-section', row.tab, JSON.stringify(d));
    if (!d.body.includes('mobile-settings-section')) throw new Error('раздел не открылся: ' + row.tab);
    if (d.cardLeft < -1 || d.cardRight > d.vw + 1) throw new Error('карточка настроек шире экрана: ' + row.tab);
    if (d.doc > d.vw + 1) throw new Error('горизонтальный скролл в настройках: ' + row.tab);
    if (d.panes.length !== 1) throw new Error('видимых панелей ' + d.panes.length + ' в ' + row.tab);
    await js(w, `document.getElementById('mobile-settings-back').click(); true`);
    await sleep(250);
  }
});
