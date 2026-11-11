// Новый мобильный слой: включение флагом, только #m-app, старый слой скрыт.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');
const fs = require('node:fs');
const path = require('node:path');

runTest(async () => {
  const a = await register('ml' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('ml', a);
  w.setSize(411, 960); w.show(); w.focus();
  await sleep(700);
  await js(w, `localStorage.setItem('sozvon.mobileShell','1'); location.reload(); true`);
  await sleep(2000);
  const d = JSON.parse(await js(w, `JSON.stringify({
    html: document.getElementById('m-app')?.innerText.slice(0, 400) || '',
    count: document.querySelectorAll('#m-app').length,
    oldMain: getComputedStyle(document.getElementById('main')).visibility,
    oldNav: getComputedStyle(document.getElementById('mobile-nav')).visibility,
    shell: document.body.classList.contains('m-shell'),
  })`));
  console.log('m-smoke', JSON.stringify(d));
  if (d.count !== 1) throw new Error('ожидался один #m-app, найдено ' + d.count);
  if (!d.shell) throw new Error('нет класса m-shell');
  if (d.oldMain !== 'hidden' || d.oldNav !== 'hidden') throw new Error('старый слой не скрыт: ' + JSON.stringify(d));
  const dir = 'C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/m-layer';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'contacts.png'), (await w.webContents.capturePage()).toPNG());
});
