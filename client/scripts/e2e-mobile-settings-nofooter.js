// Во всех мобильных разделах настроек нет футера «Отмена/Сохранить»;
// звук сохраняется сразу, пароль — отдельным действием без футера.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('nf' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('nf', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500);

  for (const tab of ['look', 'sound', 'notify', 'account', 'privacy']) {
    await js(w, `document.querySelector('#set-nav > button[data-tab="${tab}"]').click(); true`);
    await sleep(400);
    const d = JSON.parse(await js(w, `(() => {
      const foot = document.querySelector('#settings .set-foot');
      return JSON.stringify({ tab: ${JSON.stringify(tab)}, foot: foot ? getComputedStyle(foot).display : 'absent', body: document.body.className });
    })()`));
    console.log('nofooter', JSON.stringify(d));
    if (d.foot !== 'none' && d.foot !== 'absent') throw new Error(tab + ': футер всё ещё виден');
    if (!d.body.includes('mobile-settings-section')) throw new Error(tab + ': раздел не открылся');
    await js(w, `document.getElementById('mobile-settings-back').click(); true`);
    await sleep(250);
  }

  // Звук: ползунок шумоподавления сохраняется без кнопки.
  await js(w, `document.querySelector('#set-nav > button[data-tab="sound"]').click(); true`);
  await sleep(400);
  const before = await js(w, `state.settings.noiseLevel`);
  await js(w, `(() => {
    const r = document.getElementById('set-ns-level');
    r.value = r.value === '2' ? '3' : '2';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(600);
  const after = await js(w, `state.settings.noiseLevel`);
  console.log('audio-autosave', before, after);
  if (before === after) throw new Error('громкость шумоподавления не сохранилась автоматически');
  await js(w, `document.getElementById('mobile-settings-back').click(); true`);
  await sleep(300);

  // Пароль: явная кнопка, поля очищаются, ошибки нет.
  await js(w, `document.querySelector('#set-nav > button[data-tab="account"]').click(); true`);
  await sleep(400);
  const hasBtn = await js(w, `Boolean(document.getElementById('password-change-btn'))`);
  console.log('password-btn', hasBtn);
  if (!hasBtn) throw new Error('нет кнопки смены пароля');
  await js(w, `(() => {
    document.getElementById('set-cur-pass').value = 'test-pass-1';
    document.getElementById('set-new-pass').value = 'test-pass-2';
    document.getElementById('password-change-btn').click();
    return true;
  })()`);
  await sleep(900);
  const pw = JSON.parse(await js(w, `JSON.stringify({
    error: document.getElementById('password-error').textContent,
    cur: document.getElementById('set-cur-pass').value,
    next: document.getElementById('set-new-pass').value,
  })`));
  console.log('password-result', JSON.stringify(pw));
  if (pw.error) throw new Error('смена пароля: ' + pw.error);
  if (pw.cur || pw.next) throw new Error('поля пароля не очистились');
});
