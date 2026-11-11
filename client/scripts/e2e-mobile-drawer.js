// Панель участников: закрывается по скриму и при переходе в другой раздел.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('dr' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Участники' }, a.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  const w = await openClient('dr', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `openHub(${hub.id}); selectRoom(${room.id}); true`);
  await sleep(700);

  const state = () => js(w, `(() => {
    const p = document.getElementById('members-panel');
    const s = document.querySelector('.scrim');
    return JSON.stringify({
      panel: p ? { hidden: p.classList.contains('hidden'), drawer: p.classList.contains('drawer-open'), display: getComputedStyle(p).display } : null,
      scrim: s ? s.classList.contains('is-on') : null,
      body: document.body.className,
    });
  })()`);

  if (!(await js(w, `Boolean(document.querySelector('.members-toggle'))`))) throw new Error('нет кнопки участников');
  await js(w, `document.querySelector('.members-toggle').click(); true`);
  await sleep(400);
  let d = JSON.parse(await state());
  console.log('drawer-open', JSON.stringify(d));
  if (!d.panel.drawer || d.panel.hidden || d.panel.display === 'none') throw new Error('панель участников не открылась');
  if (!d.scrim) throw new Error('скрим не включился');

  await js(w, `document.querySelector('.scrim').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  await sleep(400);
  d = JSON.parse(await state());
  console.log('drawer-scrim', JSON.stringify(d));
  if (d.panel.drawer || !d.panel.hidden || d.scrim) throw new Error('скрим не закрыл панель участников');

  await js(w, `document.querySelector('.members-toggle').click(); true`);
  await sleep(400);
  if (!(JSON.parse(await state()).panel.drawer)) throw new Error('панель не открылась повторно');
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500);
  d = JSON.parse(await state());
  console.log('drawer-nav', JSON.stringify(d));
  if (d.panel.drawer || !d.panel.hidden || d.scrim) throw new Error('панель участников осталась поверх другого раздела: ' + JSON.stringify(d));
});
