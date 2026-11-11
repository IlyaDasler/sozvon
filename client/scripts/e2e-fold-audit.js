// Разложенный фолд: Workspace без телефонной панели, настройки без наложений.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

const snap = (w) => js(w, `(() => {
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { d: c.display, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
  return JSON.stringify({
    vw: innerWidth, vh: innerHeight, doc: document.documentElement.scrollWidth,
    nav: q('#mobile-nav'), rail: q('#rail'), sidebar: q('.sidebar'), main: q('#main'), content: q('.content'),
    settings: q('#settings'), card: q('#settings .set-card'), setNav: q('#settings #set-nav'), setBody: q('#settings .set-body'), foot: q('#settings .set-foot'),
    body: document.body.className,
  });
})()`);

runTest(async () => {
  const a = await register('fold' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Фолд' }, a.token);
  const room = await api('POST', '/rooms', { name: 'чат', kind: 'text', hubId: hub.id }, a.token);
  await api('POST', `/rooms/${room.id}/messages`, { text: 'привет' }, a.token);

  const w = await openClient('fold', a);
  w.show(); w.focus();
  for (const [width, height] of [[657, 841], [673, 841], [734, 841], [841, 657], [938, 800]]) {
    w.setSize(width, height + 65);
    await sleep(500);
    let d = JSON.parse(await snap(w));
    console.log('fold', width + 'x' + height, JSON.stringify({ nav: d.nav?.d, rail: d.rail?.d, sidebar: d.sidebar?.d, main: d.main, doc: d.doc }));
    if (d.doc > d.vw + 1) throw new Error(width + ': горизонтальный скролл');
    if (d.nav?.d !== 'none') throw new Error(width + ': нижняя панель на фолде');
    if (d.rail?.d === 'none' || d.sidebar?.d === 'none') throw new Error(width + ': нет Workspace');

    await js(w, `openSettings(); true`);
    await sleep(600);
    d = JSON.parse(await snap(w));
    console.log('fold-settings', width, JSON.stringify({ card: d.card, navPanel: d.setNav, body: d.setBody, foot: d.foot, doc: d.doc }));
    if (!d.card) throw new Error(width + ': настройки не открылись');
    if (d.card.x < -1 || d.card.right > d.vw + 1) throw new Error(width + ': карточка настроек шире экрана');
    if (d.setNav && d.setBody && d.setNav.right > d.setBody.x + 2) throw new Error(width + ': навигация настроек наезжает на контент');
    if (d.foot && d.foot.d !== 'none' && d.foot.y < (d.setBody?.bottom || 0) - 2) throw new Error(width + ': футер наезжает на контент');

    const tabs = JSON.parse(await js(w, `JSON.stringify([...document.querySelectorAll('#settings #set-nav > button[data-tab]')].filter((b) => b.getClientRects().length && getComputedStyle(b).display !== 'none').map((b) => b.dataset.tab))`));
    for (const tab of [...new Set(tabs)]) {
      await js(w, `document.querySelector('#settings #set-nav > button[data-tab="${tab}"]').click(); true`);
      await sleep(250);
      const x = JSON.parse(await js(w, `(() => {
        const body = document.querySelector('#settings .set-body');
        const panes = [...document.querySelectorAll('#settings .set-pane')].filter((p) => p.getClientRects().length && getComputedStyle(p).display !== 'none');
        return JSON.stringify({ panes: panes.map((p) => p.dataset.pane), doc: document.documentElement.scrollWidth, vw: innerWidth, bodyScroll: body.scrollWidth, bodyClient: body.clientWidth });
      })()`));
      if (x.doc > x.vw + 1 || x.bodyScroll > x.bodyClient + 2) throw new Error(width + ' / ' + tab + ': горизонтальный скролл настроек');
      if (x.panes.length !== 1) throw new Error(width + ' / ' + tab + ': панелей ' + x.panes.length);
    }
    await js(w, `closeSettings(); true`);
    await sleep(250);
  }
});
