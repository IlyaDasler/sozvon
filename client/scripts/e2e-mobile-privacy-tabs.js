// Приватность: горизонтальные вкладки, активная всегда видна, контент не перекрыт.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('pt' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('pt', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500);
  await js(w, `document.querySelector('#set-nav > button[data-tab="privacy"]').click(); true`);
  await sleep(500);

  const d = JSON.parse(await js(w, `(() => {
    const nav = document.getElementById('privacy-subnav');
    const pane = nav.closest('.set-pane');
    const buttons = [...nav.querySelectorAll('button')];
    const rows = new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
    const active = nav.querySelector('button.active');
    return JSON.stringify({
      parent: pane?.dataset.pane || null,
      display: getComputedStyle(nav).display,
      flexWrap: getComputedStyle(nav).flexWrap,
      rows: rows.size,
      buttons: buttons.map((b) => ({ text: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height), active: b.classList.contains('active') })),
      activeColor: active ? getComputedStyle(active).color : null,
      scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth,
      navBottom: Math.round(nav.getBoundingClientRect().bottom),
      pageTop: Math.round([...pane.querySelectorAll('.privacy-page:not(.hidden)')][0].getBoundingClientRect().top),
    });
  })()`));
  console.log('privacy-tabs', JSON.stringify(d));
  if (d.parent !== 'privacy') throw new Error('вкладки не в разделе приватности');
  if (d.display !== 'flex' || d.rows !== 1) throw new Error('вкладки не в одну горизонтальную строку: ' + JSON.stringify(d));
  if (d.buttons.length !== 4) throw new Error('вкладок не 4');
  if (d.buttons.some((b) => b.h < 44)) throw new Error('вкладка ниже 44px');
  if (d.pageTop < d.navBottom - 1) throw new Error('контент заходит под вкладки');

  for (const page of ['profile', 'contact', 'crypto', 'data']) {
    await js(w, `document.querySelector('#privacy-subnav [data-privacy="${page}"]').click(); true`);
    await sleep(350);
    const x = JSON.parse(await js(w, `(() => {
      const nav = document.getElementById('privacy-subnav');
      const b = nav.querySelector('[data-privacy="${page}"]');
      const nr = nav.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const shown = [...document.querySelectorAll('#settings .privacy-page')].filter((p) => p.getClientRects().length && getComputedStyle(p).display !== 'none');
      return JSON.stringify({ active: nav.querySelector('button.active')?.dataset.privacy, shown: shown.map((p) => p.dataset.privacyPage), visible: br.left >= nr.left - 1 && br.right <= nr.right + 1 });
    })()`));
    console.log('privacy-tab', page, JSON.stringify(x));
    if (x.active !== page || x.shown.length !== 1 || x.shown[0] !== page) throw new Error('вкладка не переключилась: ' + page);
    if (!x.visible) throw new Error('активная вкладка не видна в роллере: ' + page);
  }
});
