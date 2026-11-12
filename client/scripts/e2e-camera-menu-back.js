// Меню камеры: одно нажатие назад закрывает только меню, экран настроек остаётся.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('cbk' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('cbk', a);
  w.setSize(411, 960); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500);
  await js(w, `document.getElementById('cam-picker-btn').click(); true`);
  await sleep(500);
  let before = await js(w, `JSON.stringify({open:!document.getElementById('camera-picker').classList.contains('hidden'),settings:!document.getElementById('settings').classList.contains('hidden')})`);
  console.log('camera-menu-before', before);
  const handled = await js(w, `window.mobileBack()`);
  await sleep(300);
  const after = await js(w, `JSON.stringify({open:!document.getElementById('camera-picker').classList.contains('hidden'),settings:!document.getElementById('settings').classList.contains('hidden')})`);
  console.log('camera-menu-after', after, 'handled=' + handled);
  if (!JSON.parse(before).open) throw new Error('меню камеры не открылось');
  if (!handled) throw new Error('mobileBack не закрыл меню камеры');
  if (JSON.parse(after).open) throw new Error('меню камеры осталось открытым');
  if (!JSON.parse(after).settings) throw new Error('вместе с меню закрылись настройки');
});
