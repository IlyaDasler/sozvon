// Новый слой: «назад» из экрана камеры возвращает в настройки, а не проваливается дальше.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('mbk' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('mbk', a);
  w.setSize(411, 960); w.show(); w.focus();
  await sleep(700);
  await js(w, `localStorage.setItem('sozvon.mobileShell','1'); location.reload(); true`);
  await sleep(1600);
  await js(w, `document.querySelectorAll('.m-nav__item')[1].click(); true`);
  await sleep(400);
  const hasCamera = await js(w, `[...document.querySelectorAll('#m-app *')].some((el)=>el.textContent.trim()==='Проверка камеры')`);
  if (!hasCamera) throw new Error('в настройках нет строки проверки камеры');
  await js(w, `(() => { const el=[...document.querySelectorAll('#m-app *')].find((x)=>x.textContent.trim()==='Проверка камеры'); (el.closest('button, .m-row')||el).click(); return true; })()`);
  await sleep(500);
  let title = await js(w, `document.querySelector('.m-topbar__title')?.textContent || ''`);
  if (title !== 'Проверка камеры') throw new Error('камера не открылась: ' + title);
  const handled = await js(w, `window.mobileBack()`);
  await sleep(300);
  title = await js(w, `document.querySelector('.m-topbar__title')?.textContent || ''`);
  console.log('back-from-camera', JSON.stringify({ handled, title }));
  if (!handled) throw new Error('mobileBack не обработал экран камеры');
  if (title !== 'Настройки') throw new Error('назад из камеры ушёл не в настройки, а в: ' + title);
});
