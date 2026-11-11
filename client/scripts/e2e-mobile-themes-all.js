const { register, js, sleep, openClient, runTest } = require('./e2e-lib');
runTest(async () => {
  const a = await register('themes' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('themes', a);
  w.show(); w.focus(); w.setSize(390, 844); await sleep(700);
  await js(w, `openSettings(); true`); await sleep(300);
  const sections = ['profile','look','sound','notify','account','privacy'];
  for (const tab of sections) {
    await js(w, `document.querySelector('#set-nav [data-tab="${tab}"]').click(); true`);
    await sleep(250);
    const r = JSON.parse(await js(w, `JSON.stringify({body:document.body.className,title:document.getElementById('set-title').textContent,pane:getComputedStyle(document.querySelector('.set-pane[data-pane="${tab}"]')).display})`));
    if (!r.body.includes('mobile-settings-section') || r.pane === 'none') throw new Error(`${tab}: ${JSON.stringify(r)}`);
    await js(w, `window.sozvonBack(); true`); await sleep(250);
  }
  await js(w, `document.querySelector('#set-nav [data-tab="look"]').click(); true`); await sleep(300);
  const ids = JSON.parse(await js(w, `JSON.stringify([...document.querySelectorAll('#theme-grid [data-pick]')].map(e=>e.dataset.pick))`));
  if (ids.length < 8) throw new Error('мало тем: ' + ids.length);
  for (const id of ids) {
    await js(w, `document.querySelector('[data-pick="${id}"]').click(); true`);
    await sleep(200);
    const got = await js(w, `document.documentElement.dataset.themeId`);
    if (got !== id) throw new Error(`тема ${id} -> ${got}`);
  }
  console.log(`✔ ${sections.length} разделов, ${ids.length} тем применяются`);
});