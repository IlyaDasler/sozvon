const { js, sleep, waitFor, openClient, register, runTest } = require('./e2e-lib');

runTest(async () => {
  const auth = await register('phonelink', 'Привязка телефона');
  const win = await openClient('phonelink', auth, undefined, { waitReady: false });
  await waitFor(win, `Boolean(state.me) && !document.getElementById('main').classList.contains('hidden')`, 'главный экран');
  await js(win, `state.phoneAuth = true; true`);
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

  const statusChecks = JSON.parse(await js(win, `(() => {
    const original = state.me;
    const inspect = () => {
      renderIdentities();
      const phone = [...document.querySelectorAll('#identity-list .identity-row')].find((item) => item.innerText.includes('Телефон'));
      return { text: phone?.innerText || '', button: phone?.querySelector('button')?.textContent, disabled: phone?.querySelector('button')?.disabled };
    };
    state.phoneAuth = true;
    state.me = { ...original };
    delete state.me.hasPhone;
    delete state.me.phoneLinked;
    delete state.me.phoneNumber;
    delete state.me.phone;
    state.me.identities = (state.me.identities || []).filter((identity) => identity.provider !== 'phone');
    const missing = inspect();
    state.me.hasPhone = true;
    const linked = inspect();
    state.me.hasPhone = false;
    const unlinked = inspect();
    state.me = original;
    renderIdentities();
    return JSON.stringify({ missing, linked, unlinked });
  })()`));
  if (!statusChecks.missing.text.includes('статус не предоставлен сервером') ||
      statusChecks.missing.button !== 'Статус недоступен' || !statusChecks.missing.disabled ||
      !statusChecks.linked.text.includes('привязан через Telegram') || statusChecks.linked.button !== 'Привязан' ||
      statusChecks.unlinked.text.includes('не привязан') === false || statusChecks.unlinked.button !== 'Привязать' || statusChecks.unlinked.disabled) {
    throw new Error('Статус привязки телефона не различает true/false/старый API: ' + JSON.stringify(statusChecks));
  }

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
