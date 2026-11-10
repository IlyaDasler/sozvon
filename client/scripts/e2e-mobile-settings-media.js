// Настройки не должны включать камеру/микрофон до явного действия.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('nomedia' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('nomedia', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(700);
  await js(w, `(() => {
    window.__mediaCalls = [];
    const md = navigator.mediaDevices;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => { window.__mediaCalls.push(JSON.stringify(c)); return orig(c); };
    return true;
  })()`);
  await js(w, `openSettings(); true`);
  await sleep(1200);
  const calls = JSON.parse(await js(w, `JSON.stringify(window.__mediaCalls)`));
  if (calls.length) throw new Error('настройки запросили медиа: ' + calls.join(', '));
  const open = await js(w, `!document.getElementById('settings').classList.contains('hidden')`);
  if (!open) throw new Error('настройки не открылись');
  console.log('✔ настройки открываются без getUserMedia');
});