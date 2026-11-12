// Тред: открывается без blur/анимации, не ворует фокус, не тормозит.
const fs = require('node:fs');
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('thr' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Тред-канал' }, a.token);
  const room = await api('POST', '/rooms', { name: 'Тред-комната', kind: 'text', hubId: hub.id }, a.token);
  const root = await api('POST', `/rooms/${room.id}/messages`, { text: 'Корень обсуждения' }, a.token);
  const w = await openClient('thr', a);
  w.setSize(1228, 838); w.show(); w.focus();
  await sleep(1000);

  for (const [width, height, label] of [[1228, 838, 'wide'], [390, 844, 'phone']]) {
    w.setSize(width, height);
    await sleep(250);
    const started = Date.now();
    await js(w, `openRoom(${room.id}); true`);
    await sleep(700);
    await js(w, `openThread({ id: ${root.id}, threadRoot: ${root.id}, roomId: ${room.id} }, { roomId: ${room.id} }); true`);
    await sleep(1200);
    const d = JSON.parse(await js(w, `JSON.stringify((() => {
      const p = document.getElementById('thread-panel');
      const c = getComputedStyle(p);
      const head = getComputedStyle(p.querySelector('.thread-head'));
      return {
        open: p.classList.contains('thread-open'),
        backdrop: c.backdropFilter || c.webkitBackdropFilter,
        headBackdrop: head.backdropFilter || head.webkitBackdropFilter,
        animation: c.animationName,
        active: document.activeElement?.id || '',
        msgs: p.querySelectorAll('.thread-list .msg').length,
        body: document.body.className,
        rect:p.getBoundingClientRect().toJSON(),z:getComputedStyle(p).zIndex,drawer:p.classList.contains('drawer-open'),scrim:document.querySelector('.scrim.is-on')!==null,op:getComputedStyle(p).opacity,disp:getComputedStyle(p).display,text:p.innerText.slice(0,120),top:document.elementFromPoint(innerWidth/2,innerHeight/2)?.id||document.elementFromPoint(innerWidth/2,innerHeight/2)?.className,
        filters: [...document.querySelectorAll('*')].filter((el)=>{const c=getComputedStyle(el);return (c.filter&&c.filter!=='none')||(c.backdropFilter&&c.backdropFilter!=='none')}).slice(0,20).map((el)=>({id:el.id,cls:(el.className||'').toString().slice(0,60),filter:getComputedStyle(el).filter,back:getComputedStyle(el).backdropFilter})),
      };
    })())`));
    console.log('thread-' + label, JSON.stringify({ ...d, ms: Date.now() - started }));
    if (!d.open) throw new Error(label + ': тред не открылся');
    if (d.rect.width < 100 || d.rect.height < 100) throw new Error(label + ': панель треда нулевая');
    if (d.drawer || d.scrim) throw new Error(label + ': тред всё ещё drawer/scrim ' + JSON.stringify(d));
    if ((d.top || '').toString().includes('scrim')) throw new Error(label + ': scrim перекрывает тред');
    if (d.backdrop !== 'none' || d.headBackdrop !== 'none') throw new Error(label + ': остался blur ' + JSON.stringify(d));
    if (d.animation !== 'none') throw new Error(label + ': осталась анимация ' + d.animation);
    if (d.active === 'thread-input') throw new Error(label + ': тред украл фокус');
    fs.writeFileSync(`C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/thread-${label}.png`, (await w.webContents.capturePage()).toPNG());
    await js(w, `document.getElementById('thread-close').click(); true`);
    await sleep(200);
  }
});
