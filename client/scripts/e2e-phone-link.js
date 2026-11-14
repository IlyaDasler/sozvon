const { js, sleep, waitFor, openClient, register, runTest } = require('./e2e-lib');

runTest(async () => {
  const auth = await register('phonelink', 'Привязка телефона');
  const win = await openClient('phonelink', auth, undefined, { waitReady: false });
  await sleep(800);
  await js(win, `openSettings(); showSettingsTab('account'); true`);
  await sleep(400);

  const row = await js(win, `(() => {
    const rows = [...document.querySelectorAll('#identity-list .identity-row')];
    const phone = rows.find((r) => r.innerText.includes('Телефон'));
    if (!phone) return 'нет строки телефона';
    if (!phone.querySelector('.provider-badge') || !phone.querySelector('.provider-badge').textContent.includes('✆')) return 'нет иконки телефона';
    phone.querySelector('button').click();
    return 'ok';
  })()`);
  if (row !== 'ok') throw new Error(row);

  await waitFor(win, `!document.getElementById('phone-link-form').classList.contains('hidden')`, 'форма привязки телефона');
  const form = await js(win, `JSON.stringify({
    visible: getComputedStyle(document.getElementById('phone-link-form')).display,
    input: Boolean(document.getElementById('link-phone')),
    start: Boolean(document.getElementById('link-phone-start')),
    error: document.getElementById('settings-error').textContent,
  })`);
  const data = JSON.parse(form);
  if (data.visible === 'none' || !data.input || !data.start || data.error) throw new Error('форма не открылась: ' + form);

  console.log('✔ кнопка телефона открывает форму, иконка на месте');
  win.destroy();
});
