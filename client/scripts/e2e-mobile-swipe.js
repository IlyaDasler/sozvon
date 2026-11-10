// Свайпы на телефоне: вправо — список чатов, влево — назад, по нижней панели — вкладки.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('swipe' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('swipe', a);
  w.show();
  w.focus();
  w.setSize(390, 844);
  await sleep(700);
  await js(w, `setTheme('glass'); selectContact(null); true`);

  const touch = (type, x, y) => js(w, `(() => {
    const target = document.elementFromPoint(${x}, ${y}) || document.body;
    const t = new Touch({ identifier: 1, target, clientX: ${x}, clientY: ${y}, pageX: ${x}, pageY: ${y} });
    const list = ${type === 'touchend' ? '[]' : '[t]'};
    target.dispatchEvent(new TouchEvent('${type}', { bubbles: true, cancelable: true, touches: list, changedTouches: [t], targetTouches: list }));
    return true;
  })()`);

  // Свайп вправо по центру контента, не от края экрана
  await touch('touchstart', 190, 420);
  await touch('touchend', 330, 428);
  await sleep(450);
  const opened = JSON.parse(await js(w, `JSON.stringify({ list: document.body.classList.contains('mobile-list'), nav: !!document.querySelector('#mobile-nav') })`));
  if (!opened.list) throw new Error('свайп вправо не открыл список: ' + JSON.stringify(opened));

  // Свайп влево — назад к чату
  await touch('touchstart', 330, 420);
  await touch('touchend', 190, 430);
  await sleep(450);
  const closed = JSON.parse(await js(w, `JSON.stringify({ list: document.body.classList.contains('mobile-list') })`));
  if (closed.list) throw new Error('свайп влево не закрыл список: ' + JSON.stringify(closed));

  console.log('✔ свайпы контента: список открыт/закрыт');
});
