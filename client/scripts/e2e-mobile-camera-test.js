// Проверка камеры: без списка устройств, переключение фронт/тыл, назад закрывает оверлей.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('cam' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('cam', a);
  w.setSize(411, 960); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(400);
  await js(w, `document.getElementById('cam-test-btn').click(); true`);
  await sleep(700);
  const d = JSON.parse(await js(w, `JSON.stringify({
    overlay: !!document.getElementById('mobile-camera-test'),
    list: !!document.querySelector('#camera-picker .camera-list') && !document.getElementById('camera-picker').classList.contains('hidden'),
    toggle: document.querySelector('.m-camera-test__toggle')?.textContent || '',
    state: document.querySelector('.m-camera-test__state')?.textContent || '',
    settings: !document.getElementById('settings').classList.contains('hidden'),
  })`));
  console.log('camera-overlay', JSON.stringify(d));
  if (!d.overlay) throw new Error('нет оверлея проверки камеры');
  if (d.list) throw new Error('открылся список устройств камеры');
  if (!/Переключить на/.test(d.toggle)) throw new Error('нет переключения фронт/тыл: ' + d.toggle);
  const handled = await js(w, `window.mobileBack()`);
  await sleep(300);
  const after = JSON.parse(await js(w, `JSON.stringify({overlay:!!document.getElementById('mobile-camera-test'),settings:!document.getElementById('settings').classList.contains('hidden')})`));
  console.log('camera-overlay-after-back', JSON.stringify(after), 'handled=' + handled);
  if (!handled || after.overlay) throw new Error('назад не закрыл проверку камеры');
  if (!after.settings) throw new Error('вместе с камерой закрылись настройки');
});
