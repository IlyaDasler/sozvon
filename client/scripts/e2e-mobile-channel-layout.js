// Каналы: гармошка комнат и drag&drop с папками.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

const drag = async (w, fromSel, toSel) => {
  const from = await js(w, `(() => { const e = document.querySelector(${JSON.stringify(fromSel)}); const r = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) }); })()`);
  const to = await js(w, `(() => { const e = document.querySelector(${JSON.stringify(toSel)}); const r = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`);
  const f = JSON.parse(from);
  const t = JSON.parse(to);
  await js(w, `(() => {
    const head = document.querySelector(${JSON.stringify(fromSel)});
    head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'touch', clientX: ${f.x}, clientY: ${f.y} }));
    return true;
  })()`);
  await sleep(450);
  await js(w, `(() => {
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: ${t.x}, clientY: ${t.y} }));
    return true;
  })()`);
  await sleep(80);
  await js(w, `(() => {
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: ${t.x}, clientY: ${t.y} }));
    return true;
  })()`);
  await sleep(500);
};

runTest(async () => {
  const a = await register('cl' + Date.now().toString(36).slice(-4), 'Аня');
  const h1 = await api('POST', '/hubs', { name: 'Первый' }, a.token);
  const h2 = await api('POST', '/hubs', { name: 'Второй' }, a.token);
  const h3 = await api('POST', '/hubs', { name: 'Третий' }, a.token);
  await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: h1.id }, a.token);
  await api('POST', '/rooms', { name: 'голос', kind: 'voice', hubId: h1.id }, a.token);

  const w = await openClient('cl', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(700);

  const cards = () => js(w, `document.querySelectorAll('#mobile-hubs .mobile-hub-card').length`);
  if ((await cards()) < 3) throw new Error('не все каналы отрисованы');

  // Гармошка.
  await js(w, `document.querySelector('#mobile-hubs .mobile-hub-card__toggle').click(); true`);
  await sleep(300);
  let d = JSON.parse(await js(w, `(() => { const c=document.querySelector('#mobile-hubs .mobile-hub-card'); return JSON.stringify({ collapsed:c.classList.contains('collapsed'), rooms:c.querySelectorAll('.mobile-hub-room').length, expanded:c.querySelector('.mobile-hub-card__toggle').getAttribute('aria-expanded'), h:Math.round(c.getBoundingClientRect().height) }); })()`));
  console.log('accordion-collapsed', JSON.stringify(d));
  if (!d.collapsed || d.rooms !== 0 || d.expanded !== 'false' || d.h > 90) throw new Error('гармошка не свернула комнаты: ' + JSON.stringify(d));
  await js(w, `document.querySelector('#mobile-hubs .mobile-hub-card__toggle').click(); true`);
  await sleep(300);
  d = JSON.parse(await js(w, `(() => { const c=document.querySelector('#mobile-hubs .mobile-hub-card'); return JSON.stringify({ rooms:c.querySelectorAll('.mobile-hub-room').length, h:Math.round(c.getBoundingClientRect().height) }); })()`));
  console.log('accordion-expanded', JSON.stringify(d));
  if (d.rooms < 1) throw new Error('гармошка не развернула комнаты');

  // Drag первого канала на второй → папка.
  await drag(w, '#mobile-hubs .mobile-hub-card:nth-of-type(1) .mobile-hub-card__head', '#mobile-hubs .mobile-hub-card:nth-of-type(2) .mobile-hub-card__head');
  d = JSON.parse(await js(w, `JSON.stringify({ folders: document.querySelectorAll('#mobile-hubs .mobile-hub-folder').length, inside: document.querySelectorAll('#mobile-hubs .mobile-hub-folder .mobile-hub-card').length, title: document.querySelector('#mobile-hubs .mobile-hub-folder__title')?.textContent || '' })`));
  console.log('folder-created', JSON.stringify(d));
  if (d.folders !== 1 || d.inside !== 2) throw new Error('папка не создалась: ' + JSON.stringify(d));

  // Вытаскиваем канал из папки в drop-зону.
  const out = await js(w, `(() => {
    const head = document.querySelector('#mobile-hubs .mobile-hub-folder .mobile-hub-card__head');
    const r = head.getBoundingClientRect();
    head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 2, pointerType: 'touch', clientX: Math.round(r.left + 40), clientY: Math.round(r.top + r.height / 2) }));
    return true;
  })()`);
  await sleep(450);
  const drop = await js(w, `(() => { const e = document.querySelector('.mobile-hub-dropout'); if (!e) return null; const r=e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2), has:true }); })()`);
  console.log('dropout', drop);
  if (!drop) throw new Error('нет зоны «Вынуть из папки»');
  const dp = JSON.parse(drop);
  await js(w, `(() => { document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 2, pointerType: 'touch', clientX: ${dp.x}, clientY: ${dp.y} })); document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 2, pointerType: 'touch', clientX: ${dp.x}, clientY: ${dp.y} })); return true; })()`);
  await sleep(600);
  d = JSON.parse(await js(w, `JSON.stringify({ folders: document.querySelectorAll('#mobile-hubs .mobile-hub-folder').length, cards: document.querySelectorAll('#mobile-hubs .mobile-hub-card').length })`));
  console.log('folder-dissolved', JSON.stringify(d));
  if (d.folders !== 0 || d.cards !== 3) throw new Error('папка не растворилась после извлечения: ' + JSON.stringify(d));
});
