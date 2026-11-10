// Матрица Android-разрешений и форм-факторов: нет горизонтального переполнения,
// правильный режим навигации, поле ввода не вылезает.
const { api, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('matrix' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Мобильный' }, a.token);
  const room = await api('POST', '/rooms', { hubId: hub.id, name: 'Общий чат', kind: 'text' }, a.token);
  const w = await openClient('matrix', a);
  w.show();
  w.focus();
  await sleep(700);
  await js(w, `setTheme('glass'); true`);

  const cases = [
    { w: 320, h: 568, mode: 'compact' },
    { w: 360, h: 800, mode: 'compact' },
    { w: 390, h: 844, mode: 'compact' },
    { w: 412, h: 915, mode: 'compact' },
    { w: 844, h: 390, mode: 'compact' },
    { w: 344, h: 882, mode: 'compact' },
    { w: 396, h: 935, mode: 'compact' },
    { w: 673, h: 841, mode: 'workspace' },
    { w: 935, h: 800, mode: 'workspace' },
  ];

  const failures = [];
  for (const c of cases) {
    w.setSize(c.w, c.h);
    await sleep(450);
    await js(w, `selectContact(null); true`);
    await sleep(200);
    const home = JSON.parse(
      await js(w, `(() => {
        const main = document.querySelector('.main').getBoundingClientRect();
        const css = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : null; };
        return JSON.stringify({
          vw: innerWidth, vh: innerHeight,
          scroll: document.documentElement.scrollWidth,
          main: { left: main.left, right: main.right, top: main.top, bottom: main.bottom },
          rail: css('#rail'), sidebar: css('.sidebar'), nav: css('#mobile-nav'),
        });
      })()`)
    );
    const p = `${c.w}x${c.h}`;
    if (home.scroll > home.vw + 2) failures.push(`${p}: горизонтальный скролл ${home.scroll}`);
    if (home.main.right > home.vw + 2 || home.main.left < -2) failures.push(`${p}: .main вылезает`);
    if (c.mode === 'compact' && (home.rail !== 'none' || home.sidebar !== 'none' || home.nav === 'none'))
      failures.push(`${p}: ожидали компактный режим, получили ${JSON.stringify(home)}`);
    if (c.mode === 'workspace' && (home.rail === 'none' || home.sidebar === 'none' || home.nav !== 'none'))
      failures.push(`${p}: ожидали Workspace, получили ${JSON.stringify(home)}`);

    // Чат и композер
    await js(w, `openHub(${hub.id}); refreshRooms().then(() => openRoomChat(${room.id})); document.body.classList.remove('mobile-list'); true`);
    await sleep(400);
    const chat = JSON.parse(
      await js(w, `(() => {
        const bar = document.querySelector('#room-view:not(.hidden) .composer-bar') || document.querySelector('.composer-bar');
        const r = bar?.getBoundingClientRect();
        const input = document.getElementById('room-message-input');
        const ir = input?.getBoundingClientRect();
        return JSON.stringify({ bar: r ? { left: r.left, right: r.right } : null, input: ir ? { left: ir.left, right: ir.right } : null, vw: innerWidth });
      })()`)
    );
    if (!chat.bar || chat.bar.right > chat.vw + 2 || chat.bar.left < -2) failures.push(`${p}: композер вылезает ${JSON.stringify(chat)}`);
    if (!chat.input || chat.input.right > chat.vw + 2) failures.push(`${p}: поле ввода вылезает ${JSON.stringify(chat)}`);
  }

  w.setSize(390, 844);
  if (failures.length) throw new Error(failures.slice(0, 8).join('; '));
  console.log('✔ матрица 320/360/390/412/844×390/344/396/673/935 без переполнений');
});
