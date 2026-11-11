// Профиль сохраняется сразу, без кнопок «Отмена/Сохранить».
const { register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('pa' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('pa', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await waitFor(w, `!document.getElementById('settings').classList.contains('hidden')`, 'настройки', 4000);
  await sleep(300);
  await js(w, `document.getElementById('mobile-profile-open').click(); true`);
  await sleep(500);

  const d = JSON.parse(await js(w, `(() => {
    const foot = document.querySelector('#settings .set-foot');
    return JSON.stringify({
      tab: document.getElementById('settings').dataset.mobileTab,
      foot: foot ? getComputedStyle(foot).display : 'absent',
      name: document.getElementById('set-display')?.value,
    });
  })()`));
  console.log('profile-open', JSON.stringify(d));
  if (d.tab !== 'profile') throw new Error('профиль не открылся: ' + JSON.stringify(d));
  if (d.foot !== 'none') throw new Error('кнопки Сохранить/Отмена всё ещё видны: ' + d.foot);

  const name = 'Имя' + Math.floor(Math.random() * 1000);
  await js(w, `(() => {
    const input = document.getElementById('set-display');
    input.value = ${JSON.stringify(name)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  const saved = await js(w, `state.me.displayName`);
  console.log('autosaved-name', saved);
  if (saved !== name) throw new Error('имя не сохранилось автоматически: ' + saved);

  const bio = 'Автосохранение ' + Date.now();
  await js(w, `(() => {
    const input = document.getElementById('set-bio');
    input.value = ${JSON.stringify(bio)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  const savedBio = await js(w, `state.me.bio`);
  console.log('autosaved-bio', savedBio);
  if (savedBio !== bio) throw new Error('био не сохранилось автоматически: ' + savedBio);

  const color = await js(w, `(() => {
    const buttons = [...document.querySelectorAll('#color-picker button[data-color]')].filter((b) => b.dataset.color);
    const target = buttons.find((b) => b.dataset.color !== state.me.avatarColor);
    if (!target) return '';
    const value = target.dataset.color;
    target.click();
    return value;
  })()`);
  await sleep(900);
  const savedColor = await js(w, `state.me.avatarColor`);
  console.log('autosaved-color', color, savedColor);
  if (!color || savedColor !== color) throw new Error('цвет аватара не сохранился: ' + color + ' → ' + savedColor);

  if (await js(w, `document.getElementById('settings').classList.contains('hidden')`)) throw new Error('настройки закрылись сами');
});
