// Плавность нижнего меню при свайпе: вкладка не откатывается, капсула едет монотонно.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

const swipe = async (w, dir) => {
  await js(w, `(() => {
    const nav = document.getElementById('mobile-nav');
    const r = nav.getBoundingClientRect();
    const y = Math.round(r.top + r.height / 2);
    const startX = ${dir} < 0 ? Math.round(r.right - 30) : Math.round(r.left + 30);
    const endX = ${dir} < 0 ? Math.round(r.left + 30) : Math.round(r.right - 30);
    const make = (x) => new Touch({ identifier: 1, target: nav, clientX: x, clientY: y, pageX: x, pageY: y });
    const s = make(startX);
    nav.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [s], targetTouches: [s], changedTouches: [s] }));
    const e = make(endX);
    nav.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [e] }));
    return true;
  })()`);
};

const pillX = (w) => js(w, `(() => {
  const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#mobile-nav .mobile-nav-pill')).transform);
  return Math.round(m.m41 * 10) / 10;
})()`);

runTest(async () => {
  const a = await register('sm' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('sm', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  const run = async (dir) => {
    const samples = [];
    for (let i = 0; i < 18; i += 1) {
      samples.push(JSON.parse(await js(w, `JSON.stringify({ a: document.querySelector('#mobile-nav button.active')?.dataset.mobile || '', x: (() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#mobile-nav .mobile-nav-pill')).transform); return Math.round(m.m41); })() })`)));
      if (i === 1) await swipe(w, dir);
      await sleep(30);
    }
    return samples;
  };

  let s = await run(-1);
  console.log('samples-left', JSON.stringify(s.map((x) => x.x)));
  const activeAfter = s.slice(3).map((x) => x.a).filter(Boolean);
  if (new Set(activeAfter).size !== 1 || activeAfter[0] !== 'channels') throw new Error('вкладка откатывалась при свайпе: ' + JSON.stringify(activeAfter));
  const startX = s[0].x;
  const endX = s[s.length - 1].x;
  if (endX <= startX) throw new Error('капсула не доехала: ' + startX + ' → ' + endX);
  const late = s.slice(8).map((x) => x.x);
  if (Math.max(...late) - Math.min(...late) > 4) throw new Error('капсула дёргается после свайпа: ' + JSON.stringify(late));

  s = await run(1);
  console.log('samples-right', JSON.stringify(s.map((x) => x.x)));
  const backActive = s.slice(3).map((x) => x.a).filter(Boolean);
  if (new Set(backActive).size !== 1 || backActive[0] !== 'home') throw new Error('обратный свайп откатывался: ' + JSON.stringify(backActive));
});
