const { register, js, sleep, openClient, runTest } = require('./e2e-lib');
runTest(async () => {
  const a = await register('fl' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('fl', a);
  w.setSize(673, 906); w.show(); w.focus();
  await sleep(900);
  const d = await js(w, `(() => {
    const q=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();const c=getComputedStyle(e);return{d:c.display,p:c.position,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bottom:c.bottom,pb:c.paddingBottom}};
    return JSON.stringify({vw:innerWidth,vh:innerHeight,body:document.body.className,nav:q('#mobile-nav'),rail:q('#rail'),sidebar:q('.sidebar'),main:q('#main'),content:q('.content'),hubs:q('#mobile-hubs')});
  })()`);
  console.log('fold-layout', d);
  if (JSON.parse(d).nav.d !== 'none') throw new Error('на разложенном фолде осталась нижняя панель телефона');

  // Настройки на фолде — обычный Workspace, не мобильный список с нижней панелью.
  await js(w, `openSettings(); true`);
  await sleep(700);
  const s = JSON.parse(await js(w, `(() => {
    const card = document.querySelector('#settings .set-card');
    const r = card.getBoundingClientRect();
    return JSON.stringify({ body: document.body.className, nav: getComputedStyle(document.getElementById('mobile-nav')).display, left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, title: document.getElementById('set-title').textContent.trim() });
  })()`));
  console.log('fold-settings', JSON.stringify(s));
  if (s.nav !== 'none') throw new Error('в настройках фолда показана нижняя панель');
  if (s.left < -1 || s.right > s.vw + 1) throw new Error('настройки фолда шире экрана: ' + JSON.stringify(s));
  await js(w, `closeSettings(); true`);
});
