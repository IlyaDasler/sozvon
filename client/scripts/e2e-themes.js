// Новые темы в «Оформлении»: «Стекло» и «Фуджи» должны быть доступны,
// карточка не должна теряться в прокрутке, а у «Стекла» работает выбор фона.
const { register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('th' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('th', a);
  w.setSize(1424, 835);
  w.show();
  w.focus();
  w.webContents.setBackgroundThrottling(false);
  await sleep(700);

  await js(w, `openSettings('look'); true`);
  await waitFor(w, `!document.getElementById('settings').classList.contains('hidden')`, 'настройки оформления');

  const picker = await js(w, `(() => {
    const pane = document.querySelector('#settings .rs-body');
    const fuji = document.querySelector('.theme-card[data-pick="fuji"]');
    const glass2 = document.querySelector('.theme-card[data-pick="glass2"]');
    if (fuji) fuji.scrollIntoView({ block: 'center' });
    if (glass2) glass2.scrollIntoView({ block: 'center' });
    const box = (el) => { const r = el?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom } : null; };
    return JSON.stringify({ fuji: box(fuji), glass2: box(glass2), body: box(pane), overflow: getComputedStyle(pane).overflowY });
  })()`);
  const p = JSON.parse(picker);
  if (!p.fuji || !p.glass2) throw new Error(`карточки новых тем не найдены: ${picker}`);
  if (p.body && (p.glass2.bottom > p.body.bottom + 2 || p.glass2.top < p.body.top - 2)) {
    throw new Error(`карточка «Стекло» не помещается в прокручиваемую область: ${picker}`);
  }

  await js(w, `document.querySelector('.theme-card[data-pick="glass2"]').click(); true`);
  await waitFor(w, `document.documentElement.dataset.themeId === 'glass2'`, 'тема «Стекло» включилась');

  await js(w, `document.querySelector('.theme-card[data-pick="glass2"] .theme-bg-btn').click(); true`);
  await waitFor(w, `!document.getElementById('glass2-bg-modal').classList.contains('hidden')`, 'выбор фона');
  const options = await js(w, `document.querySelectorAll('#glass2-bg-modal .glass2-bg-option').length`);
  if (options !== 3) throw new Error(`фонов «Стекла» должно быть 3, найдено ${options}`);
  await js(w, `document.querySelectorAll('#glass2-bg-modal .glass2-bg-option')[1].click(); true`);
  await waitFor(w, `getComputedStyle(document.documentElement).getPropertyValue('--glass2-bg').includes('glass2-wallpaper-2.jpg')`, 'фон «Стекла» применяется');
  console.log('✔ «Стекло» выбирается, все три фона доступны');
});
