// Роллер друзей листается свайпом влево/вправо, а не только тапом.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

const active = (w) => js(w, `document.querySelector('#friend-tabs [data-tab].active')?.dataset.tab || ''`);

const swipe = (w, fromX, toX, y = 420) => js(w, `(() => {
  const el = document.getElementById('empty-state');
  const make = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: ${y}, pageX: x, pageY: ${y} });
  const start = make(${fromX});
  el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [start], targetTouches: [start], changedTouches: [start] }));
  const end = make(${toX});
  el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [end] }));
  return true;
})()`);

runTest(async () => {
  const a = await register('fs' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('fs', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  if ((await active(w)) !== 'online') throw new Error('старт не на «В сети»');

  await swipe(w, 320, 80); // влево → следующая
  await sleep(320);
  let tab = await active(w);
  console.log('swipe-left', tab);
  if (tab !== 'all') throw new Error('свайп влево не переключил на «Все»: ' + tab);
  if (await js(w, `document.body.classList.contains('mobile-list')`)) throw new Error('свайп открыл список каналов');

  await swipe(w, 80, 320); // вправо → предыдущая
  await sleep(320);
  tab = await active(w);
  console.log('swipe-right', tab);
  if (tab !== 'online') throw new Error('свайп вправо не вернул на «В сети»: ' + tab);

  // Вертикальный жест не должен листать роллер.
  await js(w, `(() => {
    const el = document.getElementById('empty-state');
    const make = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
    const s = make(200, 600);
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [s], targetTouches: [s], changedTouches: [s] }));
    const e = make(200, 300);
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [e] }));
    return true;
  })()`);
  await sleep(250);
  tab = await active(w);
  console.log('vertical', tab);
  if (tab !== 'online') throw new Error('вертикальный свайп переключил вкладку: ' + tab);

  // Вызов для тестов/жестов доступен и работает.
  const ok = await js(w, `window.friendsSwipe(1)`);
  await sleep(300);
  tab = await active(w);
  console.log('api', ok, tab);
  if (tab !== 'all') throw new Error('friendsSwipe не переключил вкладку');
});
