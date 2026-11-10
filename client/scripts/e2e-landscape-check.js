// Телефон боком: нижняя навигация закреплена, .main занимает экран, контент не обрезан.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');
runTest(async () => {
  const a = await register('land' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('land', a);
  w.show(); w.focus(); await sleep(700);
  w.setSize(844, 390);
  await sleep(600);
  const d = JSON.parse(await js(w, `(() => {
    const q = (s) => { const e=document.querySelector(s); if(!e)return null; const r=e.getBoundingClientRect(); const c=getComputedStyle(e); return {display:c.display,pos:c.position,x:r.x,y:r.y,w:r.width,h:r.height}; };
    return JSON.stringify({vw:innerWidth,vh:innerHeight,main:q('.main'),nav:q('#mobile-nav'),content:q('.content')});
  })()`));
  if (d.nav.display === 'none' || d.nav.pos !== 'fixed') throw new Error('нет закреплённой нижней навигации: ' + JSON.stringify(d));
  if (d.main.h < 250) throw new Error('main слишком низкий: ' + JSON.stringify(d));
  if (!d.content || d.content.h < 200) throw new Error('контент обрезан: ' + JSON.stringify(d));
  console.log(`✔ landscape 844×390: main=${Math.round(d.main.h)}, nav=${Math.round(d.nav.h)}`);
});
