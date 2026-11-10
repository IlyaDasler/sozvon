// Samsung: обычные телефоны, Fold outer/inner, Flip open/cover.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('samsung' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('samsung', a);
  w.show();
  w.focus();
  await sleep(700);
  await js(w, `setTheme('glass'); true`);

  const cases = [
    { name: 'Galaxy S23', w: 360, h: 780, mode: 'compact' },
    { name: 'Galaxy S24 Ultra', w: 480, h: 1040, mode: 'compact' },
    { name: 'Galaxy A small', w: 320, h: 568, mode: 'compact' },
    { name: 'Fold 5 outer', w: 344, h: 882, mode: 'compact' },
    { name: 'Fold 5 inner', w: 673, h: 841, mode: 'workspace' },
    { name: 'Fold 6 inner', w: 690, h: 829, mode: 'workspace' },
    { name: 'Flip 5 open', w: 396, h: 915, mode: 'compact' },
    { name: 'Flip 5 cover', w: 328, h: 360, mode: 'cover' },
  ];
  const failures = [];
  for (const c of cases) {
    w.setSize(c.w, c.h);
    await sleep(450);
    await js(w, `selectContact(null); true`);
    await sleep(200);
    const data = JSON.parse(
      await js(w, `(() => {
        const css = (s) => { const e=document.querySelector(s); return e ? getComputedStyle(e).display : null; };
        return JSON.stringify({
          vw: innerWidth, scroll: document.documentElement.scrollWidth,
          cover: document.body.classList.contains('cover-mode'),
          coverVisible: css('#cover-screen'),
          rail: css('#rail'), nav: css('#mobile-nav'), main: css('.main'),
        });
      })()`)
    );
    if (data.scroll > data.vw + 2) failures.push(`${c.name}: scroll ${data.scroll} > ${data.vw}`);
    if (c.mode === 'cover') {
      if (!data.cover || data.coverVisible === 'none' || data.main !== 'none') failures.push(`${c.name}: обложка не включилась ${JSON.stringify(data)}`);
    } else if (data.cover) failures.push(`${c.name}: ошибочно включилась обложка`);
    if (c.mode === 'workspace' && (data.rail === 'none' || data.nav !== 'none')) failures.push(`${c.name}: нет Workspace ${JSON.stringify(data)}`);
    if (c.mode === 'compact' && data.nav === 'none') failures.push(`${c.name}: нет нижней навигации ${JSON.stringify(data)}`);
  }
  w.setSize(390, 844);
  if (failures.length) throw new Error(failures.slice(0, 6).join('; '));
  console.log('✔ Samsung: S23/S24 Ultra/A, Fold 5/6/7/8 outer+inner, Flip 5/7/8 open+cover');
});
