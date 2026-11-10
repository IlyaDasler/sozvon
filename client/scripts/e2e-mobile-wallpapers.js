// Портретные обои на телефоне и обычные на фолде: проверяем оба art direction.
const { api, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('wall' + Date.now().toString(36).slice(-4), 'Аня');
  await api('POST', '/hubs', { name: 'Мобильный' }, a.token);
  const w = await openClient('wall', a);
  w.show();
  w.focus();
  await sleep(700);

  const check = async (theme, phase, asset) => {
    await js(w, `setTheme('${theme}'); selectContact(null); true`);
    await waitFor(w, `typeof sozvonDaypart !== 'undefined'`, `${theme}: daypart`);
    await js(w, `sozvonDaypart.show('${phase}'); true`);
    await waitFor(
      w,
      `getComputedStyle(document.querySelector('.lg-aurora')).backgroundImage.includes('${asset}')`,
      `${theme}/${phase}: ${asset}`,
      6000
    );
  };

  w.setSize(390, 844);
  await sleep(450);
  await check('glass', 'day', 'glass-day-mobile.jpg');
  await check('fuji', 'day', 'fuji-day-mobile.jpg');

  await js(w, `setTheme('silenthill'); true`);
  await sleep(400);
  const silent = await js(w, `getComputedStyle(document.querySelector('.main')).backgroundImage`);
  if (!silent.includes('silenthill-bg-mobile.jpg')) throw new Error(`Silenthill без портретного фона: ${silent}`);

  w.setSize(673, 841);
  await sleep(500);
  await check('glass', 'day', 'glass-day.jpg');
  await check('fuji', 'day', 'fuji-day.jpg');
  const fujiBg = await js(w, `getComputedStyle(document.querySelector('.lg-aurora')).backgroundImage`);
  if (fujiBg.includes('-mobile.jpg')) throw new Error(`на фолде остался телефонный кроп: ${fujiBg}`);

  console.log('✔ портретные обои на телефоне, обычные на фолде');
});
