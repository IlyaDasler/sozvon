// Свайпы на телефоне: в каналах влево — назад к списку, вправо — снова список;
// в «Друзьях» свайп листает роллер, а не открывает каналы.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

const touch = (w, type, x, y) => js(w, `(() => {
  const target = document.elementFromPoint(${x}, ${y}) || document.body;
  const t = new Touch({ identifier: 1, target, clientX: ${x}, clientY: ${y}, pageX: ${x}, pageY: ${y} });
  const list = ${type === 'touchend' ? '[]' : '[t]'};
  target.dispatchEvent(new TouchEvent('${type}', { bubbles: true, cancelable: true, touches: list, changedTouches: [t], targetTouches: list }));
  return true;
})()`);

const swipe = async (w, fromX, toX, y = 420) => {
  await touch(w, 'touchstart', fromX, y);
  await touch(w, 'touchend', toX, y + 8);
  await sleep(450);
};

runTest(async () => {
  const a = await register('swipe' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Свайпы' }, a.token);
  const room = await api('POST', '/rooms', { name: 'общий', kind: 'text', hubId: hub.id }, a.token);
  await api('POST', `/rooms/${room.id}/messages`, { text: 'корень' }, a.token);
  const w = await openClient('swipe', a);
  w.show(); w.focus(); w.setSize(390, 844);
  await sleep(800);

  // Друзья: горизонтальный свайп листает роллер и не открывает каналы.
  await swipe(w, 320, 80);
  const friends = JSON.parse(await js(w, `JSON.stringify({
    list: document.body.classList.contains('mobile-list'),
    tab: document.querySelector('#friend-tabs [data-tab].active')?.dataset.tab || '',
    nav: document.querySelector('#mobile-nav button.active')?.dataset.mobile || '',
  })`));
  console.log('friends-swipe', JSON.stringify(friends));
  if (friends.list) throw new Error('свайп в друзьях открыл каналы');
  if (friends.tab !== 'all') throw new Error('свайп в друзьях не переключил вкладку: ' + friends.tab);
  if (friends.nav !== 'home') throw new Error('свайп в друзьях переключил нижнее меню');

  // Каналы: список открыт, свайп влево закрывает его.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(450);
  await js(w, `openHub(${hub.id}); true`);
  await sleep(700);
  await swipe(w, 330, 190);
  const closed = await js(w, `document.body.classList.contains('mobile-list')`);
  console.log('channels-close', closed);
  if (closed) throw new Error('свайп влево не закрыл список каналов');

  // Вправо по пустому чату — снова список.
  await swipe(w, 190, 330);
  const opened = await js(w, `document.body.classList.contains('mobile-list')`);
  console.log('channels-open', opened);
  if (!opened) throw new Error('свайп вправо не открыл список каналов');
});
