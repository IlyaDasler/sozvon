// Свайп по нижнему меню: влево/вправо листает вкладки, вне меню не работает.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

const swipeNav = async (w, dx) => {
  await js(w, `(() => {
    const nav = document.getElementById('mobile-nav');
    const r = nav.getBoundingClientRect();
    const y = Math.round(r.top + r.height / 2);
    const startX = ${dx} < 0 ? Math.round(r.right - 30) : Math.round(r.left + 30);
    const endX = ${dx} < 0 ? Math.round(r.left + 30) : Math.round(r.right - 30);
    const make = (x) => new Touch({ identifier: 1, target: nav, clientX: x, clientY: y, pageX: x, pageY: y });
    const s = make(startX);
    nav.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [s], targetTouches: [s], changedTouches: [s] }));
    const e = make(endX);
    nav.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [e] }));
    return true;
  })()`);
  await sleep(450);
};

const active = (w) => js(w, `document.querySelector('#mobile-nav button.active')?.dataset.mobile || ''`);

runTest(async () => {
  const a = await register('ns' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('ns', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  if ((await active(w)) !== 'home') throw new Error('старт не на «Друзьях»');

  await swipeNav(w, -1);
  if ((await active(w)) !== 'channels') throw new Error('свайп влево не открыл каналы: ' + await active(w));
  console.log('nav-swipe channels');

  await swipeNav(w, -1);
  if ((await active(w)) !== 'notifications') throw new Error('свайп влево не открыл уведомления');
  console.log('nav-swipe notifications');

  await swipeNav(w, -1);
  if ((await active(w)) !== 'settings') throw new Error('свайп влево не открыл настройки');
  if (await js(w, `document.getElementById('settings').classList.contains('hidden')`)) throw new Error('настройки не открылись');
  console.log('nav-swipe settings');

  await swipeNav(w, 1);
  if ((await active(w)) !== 'notifications') throw new Error('свайп вправо не вернул уведомления');
  if (!(await js(w, `document.getElementById('settings').classList.contains('hidden')`))) throw new Error('настройки остались открытыми');
  console.log('nav-swipe back notifications');

  await swipeNav(w, 1);
  if ((await active(w)) !== 'channels') throw new Error('свайп вправо не вернул каналы');
  console.log('nav-swipe back channels');

  await swipeNav(w, 1);
  if ((await active(w)) !== 'home') throw new Error('свайп вправо не вернул друзей');
  await swipeNav(w, 1);
  if ((await active(w)) !== 'home') throw new Error('свайп вправо на первом пункте ушёл за границу');
  console.log('nav-swipe home edge');

  // Свайп по контенту не должен переключать нижнее меню.
  await js(w, `(() => {
    const el = document.getElementById('empty-state');
    const r = el.getBoundingClientRect();
    const y = Math.round(r.top + 300);
    const make = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
    const s = make(Math.round(r.right - 40));
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [s], targetTouches: [s], changedTouches: [s] }));
    const e = make(Math.round(r.left + 40));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [e] }));
    return true;
  })()`);
  await sleep(400);
  if ((await active(w)) !== 'home') throw new Error('свайп по контенту переключил нижнее меню');
  if (await js(w, `document.body.classList.contains('mobile-list')`)) throw new Error('свайп по контенту открыл каналы');
  console.log('nav-swipe outside ignored');
});
