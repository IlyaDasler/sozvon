// Входящий и соединённый звонок на телефоне: всё в пределах 390 px.
const { register, befriend, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');
runTest(async () => {
  const a = await register('mcA' + Date.now().toString(36).slice(-3), 'Аня');
  const b = await register('mcB' + Date.now().toString(36).slice(-3), 'Борис');
  await befriend(a, b);
  const wa = await openClient('mcA', a);
  const wb = await openClient('mcB', b);
  await sleep(800);
  for (const w of [wa, wb]) {
    w.webContents.setBackgroundThrottling(false);
    await js(w, `document.documentElement.classList.add('pwa'); setTheme('glass'); true`);
    w.setSize(390, 844);
    w.show();
    w.focus();
  }
  await sleep(400);

  await js(wa, `selectContact(${b.user.id}).then(() => startCall())`);
  await waitFor(wb, `!document.getElementById('incoming').classList.contains('hidden')`, 'входящий звонок', 10000);
  const incoming = JSON.parse(await js(wb, `(() => { const p=document.getElementById('incoming').getBoundingClientRect(); return JSON.stringify({left:p.left,right:p.right,vw:innerWidth}); })()`));
  if (incoming.left < -1 || incoming.right > incoming.vw + 1) throw new Error(`входящий вылезает: ${JSON.stringify(incoming)}`);

  await js(wb, `document.getElementById('accept-btn').click(); true`);
  await waitFor(wa, `state.call?.phase === 'connected'`, 'звонок соединён', 20000);
  await sleep(900);
  const accepted = JSON.parse(await js(wa, `(() => { const p=document.getElementById('call-panel').getBoundingClientRect(); return JSON.stringify({left:p.left,right:p.right,vw:innerWidth,controls:document.querySelectorAll('.call-controls button').length}); })()`));
  if (accepted.left < -1 || accepted.right > accepted.vw + 1 || accepted.controls < 6) throw new Error(`панель звонка: ${JSON.stringify(accepted)}`);
  await js(wa, `hangup(); true`);
  console.log('✔ входящий и соединённый звонок вписываются в телефон');
});
