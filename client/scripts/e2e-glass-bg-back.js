// Фон «Стекло»: модалка открывается без анимации, назад закрывает только её.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('glb' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('glb', a);
  w.setSize(411, 960); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(400);
  await js(w, `document.querySelector('#set-nav button[data-tab="look"]').click(); true`);
  await sleep(400);
  const has = await js(w, `!!document.querySelector('#theme-grid .theme-bg-btn')`);
  if (!has) throw new Error('нет кнопки выбора фона');
  await js(w, `document.querySelector('#theme-grid .theme-bg-btn').click(); true`);
  await sleep(500);
  let d = JSON.parse(await js(w, `JSON.stringify({open:!document.getElementById('glass2-bg-modal').classList.contains('hidden'),settings:!document.getElementById('settings').classList.contains('hidden'),animation:getComputedStyle(document.getElementById('glass2-bg-modal')).animationName})`));
  console.log('glass-bg-open', JSON.stringify(d));
  if (!d.open) throw new Error('модалка не открылась');
  if (d.animation !== 'none') throw new Error('модалка с анимацией: ' + d.animation);
  const handled = await js(w, `window.mobileBack()`);
  await sleep(250);
  d = JSON.parse(await js(w, `JSON.stringify({open:!document.getElementById('glass2-bg-modal').classList.contains('hidden'),settings:!document.getElementById('settings').classList.contains('hidden')})`));
  console.log('glass-bg-after-back', JSON.stringify(d), 'handled=' + handled);
  if (!handled) throw new Error('назад не обработал модалку');
  if (d.open) throw new Error('модалка осталась открытой');
  if (!d.settings) throw new Error('модалка закрыла настройки');
});
