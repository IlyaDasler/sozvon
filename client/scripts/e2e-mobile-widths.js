// Матрица ширин: 320/360/430/673/916, ключевые экраны без горизонтального скролла.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('wd' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Ширины' }, a.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  await api('POST', `/rooms/${room.id}/messages`, { text: 'корень' }, a.token);
  const w = await openClient('wd', a);
  w.show(); w.focus();
  await sleep(900);

  const check = async (label, workspace = false) => {
    const d = JSON.parse(await js(w, `(() => {
      const doc = document.documentElement.scrollWidth;
      const nav = document.getElementById('mobile-nav');
      const nr = nav.getBoundingClientRect();
      return JSON.stringify({ vw: innerWidth, vh: innerHeight, doc, nav: getComputedStyle(nav).display, navLeft: Math.round(nr.left), navRight: Math.round(nr.right), rail: getComputedStyle(document.getElementById('rail')).display, sidebar: getComputedStyle(document.querySelector('.sidebar')).display });
    })()`));
    console.log('width', label, JSON.stringify(d));
    if (d.doc > d.vw + 1) throw new Error(label + ': горизонтальный скролл ' + d.doc + '>' + d.vw);
    if (workspace) {
      if (d.nav !== 'none') throw new Error(label + ': на фолде осталась нижняя панель');
      if (d.rail === 'none') throw new Error(label + ': на фолде нет рейла');
      return;
    }
    if (d.nav === 'none') throw new Error(label + ': меню скрыто');
    if (d.navLeft < -1 || d.navRight > d.vw + 1) throw new Error(label + ': меню вылезает ' + JSON.stringify(d));
  };

  for (const [width, height] of [[320, 640], [360, 740], [430, 932], [673, 841], [932, 454]]) {
    w.setSize(width, height + 65);
    await sleep(500);
    await js(w, `document.querySelector('#mobile-nav [data-mobile="home"]')?.click(); true`);
    await sleep(300);
    await check(width + 'x' + height + '-home', width === 673);

    await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]')?.click(); true`);
    await sleep(400);
    await check(width + 'x' + height + '-channels', width === 673);

    await js(w, `selectRoom(${room.id}); true`);
    await sleep(600);
    await check(width + 'x' + height + '-room', width === 673);

    await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]')?.click(); true`);
    await sleep(500);
    await check(width + 'x' + height + '-settings', width === 673);
    await js(w, `closeSettings(); true`);
    await sleep(250);
  }
});
