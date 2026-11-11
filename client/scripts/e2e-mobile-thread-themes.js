// Тред: во всех темах и на телефоне/фолде открывается сразу, без blur/анимации.
const { api, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

const early = (w) => js(w, `(() => {
  const p = document.getElementById('thread-panel');
  const r = p.getBoundingClientRect();
  const c = getComputedStyle(p);
  return JSON.stringify({
    open: p.classList.contains('thread-open'), hidden: p.classList.contains('hidden'),
    pos: c.position, w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight,
    bg: c.backgroundColor, blur: c.backdropFilter || c.webkitBackdropFilter,
    filter: c.filter, opacity: c.opacity, transform: c.transform, animation: c.animationName,
  });
})()`);

runTest(async () => {
  const a = await register('tt' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Темы' }, a.token);
  const room = await api('POST', '/rooms', { name: 'чат', kind: 'text', hubId: hub.id }, a.token);
  const msg = await api('POST', `/rooms/${room.id}/messages`, { text: 'корень' }, a.token);
  const w = await openClient('tt', a);
  w.show(); w.focus();
  await sleep(900);
  await waitFor(w, `e2eeReady()`, 'ключ');

  const sizes = [[390, 844], [673, 906], [932, 454]];
  const themes = ['glass', 'sozvon', 'glass2', 'midnight'];
  for (const [width, height] of sizes) {
    w.setSize(width, height + 65);
    await sleep(400);
    await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]')?.click(); true`);
    await sleep(300);
    await js(w, `document.querySelector('#mobile-nav [data-mobile="home"]')?.click(); true`);
    await sleep(200);
    await js(w, `selectRoom(${room.id}); true`);
    await sleep(600);
    for (const theme of themes) {
      await js(w, `setTheme('${theme}'); true`);
      await sleep(200);
      await js(w, `openThread({ id: ${msg.id}, roomId: ${room.id}, threadRoot: ${msg.id} }, { roomId: ${room.id} }); true`);
      await sleep(50);
      const d = JSON.parse(await early(w));
      console.log('thread-early', width, theme, JSON.stringify(d));
      if (!d.open || d.hidden) throw new Error(width + '/' + theme + ': тред не открылся сразу');
      if (d.blur && d.blur !== 'none') throw new Error(width + '/' + theme + ': blur ' + d.blur);
      if (d.filter && d.filter !== 'none') throw new Error(width + '/' + theme + ': filter ' + d.filter);
      if (d.opacity !== '1') throw new Error(width + '/' + theme + ': opacity ' + d.opacity);
      if (d.animation && d.animation !== 'none') throw new Error(width + '/' + theme + ': animation ' + d.animation);
      if (d.w < d.vw - 2 || d.h < d.vh - 2) throw new Error(width + '/' + theme + ': не полноэкранный ' + JSON.stringify(d));
      await js(w, `closeThread(); true`);
      await sleep(150);
    }
  }
});
