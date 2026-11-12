// Шумоподавление: плавный ползунок, подписи-кнопки удалены.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('nz' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('nz', a);
  w.setSize(411, 960); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(400);
  await js(w, `document.querySelector('#set-nav button[data-tab="sound"]').click(); true`);
  await sleep(400);
  const before = JSON.parse(await js(w, `JSON.stringify({step:document.getElementById('set-ns-level').step,ticks:!!document.querySelector('.noise-ticks')})`));
  console.log('noise-before', JSON.stringify(before));
  if (before.step !== '0.01' || before.ticks) throw new Error('ползунок/подписи не исправлены');
  await js(w, `(() => { const n=document.getElementById('set-ns-level'); n.value='2.4'; n.dispatchEvent(new Event('input',{bubbles:true})); n.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await sleep(300);
  const after = JSON.parse(await js(w, `JSON.stringify({value:document.getElementById('set-ns-level').value,label:document.getElementById('set-ns-value').textContent,ticks:!!document.querySelector('.noise-ticks')})`));
  console.log('noise-after', JSON.stringify(after));
  if (after.value !== '2') throw new Error('значение не округлилось до целого: ' + after.value);
  if (after.label !== 'Среднее') throw new Error('подпись не обновилась: ' + after.label);
  if (after.ticks) throw new Error('подписи-кнопки остались');
});
