// Звонок из личного чата: панель появляется, кнопка завершения убирает её.
const { befriend, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('cl' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('clb' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const wb = await openClient('clb', b);
  const w = await openClient('cl', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  wb.setSize(390, 844); wb.show(); wb.focus();
  await sleep(700);
  await js(w, `selectContact(${b.user.id}); true`);
  await sleep(700);

  await js(w, `document.getElementById('call-btn').click(); true`);
  await waitFor(w, `!document.getElementById('call-panel').classList.contains('hidden')`, 'панель звонка', 8000);
  await sleep(500);
  const d = JSON.parse(await js(w, `JSON.stringify({
    status: document.getElementById('call-status').textContent.trim(),
    hangup: Boolean(document.getElementById('hangup-btn')),
    nav: getComputedStyle(document.getElementById('mobile-nav')).display,
  })`));
  console.log('call-open', JSON.stringify(d));
  if (!d.hangup) throw new Error('нет кнопки завершения звонка');
  if (d.nav === 'none') throw new Error('нижнее меню пропало во время звонка');

  await js(w, `document.getElementById('hangup-btn').click(); true`);
  await waitFor(w, `document.getElementById('call-panel').classList.contains('hidden')`, 'завершение звонка', 8000);
  console.log('call-closed');
});
