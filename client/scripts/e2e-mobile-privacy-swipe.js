// Приватность: свайп влево/вправо листает подвкладки, работает только в разделе.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

const swipe = async (w, fromX, toX, y = 600) => {
  await js(w, `(() => {
    const pane = document.querySelector('#settings .set-pane[data-pane="privacy"]');
    const target = [...pane.querySelectorAll('.privacy-page:not(.hidden) h3')][0] || pane;
    const make = (x) => new Touch({ identifier: 1, target, clientX: x, clientY: ${y}, pageX: x, pageY: ${y} });
    const s = make(${fromX});
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [s], targetTouches: [s], changedTouches: [s] }));
    const e = make(${toX});
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [e] }));
    return true;
  })()`);
  await sleep(400);
};

const state = (w) => js(w, `(() => {
  const nav = document.getElementById('privacy-subnav');
  const active = nav.querySelector('button.active');
  const shown = [...document.querySelectorAll('#settings .privacy-page')].filter((p) => p.getClientRects().length && getComputedStyle(p).display !== 'none');
  return JSON.stringify({
    active: active?.dataset.privacy || '',
    shown: shown.map((p) => p.dataset.privacyPage),
    scrollLeft: Math.round(nav.scrollLeft),
  });
})()`);

runTest(async () => {
  const a = await register('ps' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('ps', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500);
  await js(w, `document.querySelector('#set-nav > button[data-tab="privacy"]').click(); true`);
  await sleep(500);

  let d = JSON.parse(await state(w));
  if (d.active !== 'data') throw new Error('старт не на «Данные»');
  await swipe(w, 320, 80);
  d = JSON.parse(await state(w));
  console.log('privacy-swipe-profile', JSON.stringify(d));
  if (d.active !== 'profile' || d.shown[0] !== 'profile') throw new Error('свайп влево не открыл профиль');

  await swipe(w, 320, 80);
  d = JSON.parse(await state(w));
  console.log('privacy-swipe-contact', JSON.stringify(d));
  if (d.active !== 'contact') throw new Error('свайп влево не открыл контакты');

  await swipe(w, 320, 80);
  d = JSON.parse(await state(w));
  console.log('privacy-swipe-crypto', JSON.stringify(d));
  if (d.active !== 'crypto') throw new Error('свайп влево не открыл шифрование');

  await swipe(w, 80, 320);
  d = JSON.parse(await state(w));
  if (d.active !== 'contact') throw new Error('свайп вправо не вернул контакты');

  // Вертикальный жест не листает.
  await js(w, `(() => {
    const pane = document.querySelector('#settings .set-pane[data-pane="privacy"]');
    const target = [...pane.querySelectorAll('.privacy-page:not(.hidden) h3')][0] || pane;
    const make = (y) => new Touch({ identifier: 1, target, clientX: 200, clientY: y, pageX: 200, pageY: y });
    const s = make(650);
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [s], targetTouches: [s], changedTouches: [s] }));
    const e = make(300);
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [e] }));
    return true;
  })()`);
  await sleep(300);
  d = JSON.parse(await state(w));
  if (d.active !== 'contact') throw new Error('вертикальный свайп переключил вкладку');
});
