// T4: каналы и комнаты в новом слое.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('ch4' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Канал T4' }, a.token);
  await api('POST', '/rooms', { name: 'Общий T4', kind: 'text', hubId: hub.id }, a.token);
  const w = await openClient('ch4', a);
  w.setSize(411, 960); w.show(); w.focus();
  await sleep(700);
  await js(w, `localStorage.setItem('sozvon.mobileShell','1'); location.reload(); true`);
  await sleep(1600);
  await js(w, `([...document.querySelectorAll('.m-nav__item')].find((b)=>b.textContent.trim()==='Каналы')).click(); true`);
  await sleep(900);
  const d = JSON.parse(await js(w, `JSON.stringify({hubs:document.querySelectorAll('.m-hub').length,rooms:document.querySelectorAll('.m-room').length,title:document.querySelector('.m-topbar__title')?.textContent||''})`));
  console.log('t4-channels', JSON.stringify(d));
  if (!d.hubs || !d.rooms) throw new Error('каналы/комнаты не отрисованы');
  await js(w, `([...document.querySelectorAll('.m-room')].find((b)=>b.textContent.includes('Общий T4'))).click(); true`);
  await sleep(900);
  const room = JSON.parse(await js(w, `JSON.stringify({title:document.querySelector('.m-topbar__title')?.textContent||'',msg:document.querySelector('.m-screen--room .m-msg__text')?.textContent||''})`));
  console.log('t4-room', JSON.stringify(room));
  if (room.title !== 'Общий T4') throw new Error('комната не открылась: ' + room.title);
});
