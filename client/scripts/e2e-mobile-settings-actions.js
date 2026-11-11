// Все разделы настроек открываются, не дублируются и возвращаются назад.
const { register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

const rootRows = (w) => js(w, `(() => [...document.querySelectorAll('#set-nav > button[data-tab]')]
  .filter((b) => b.getClientRects().length && getComputedStyle(b).display !== 'none')
  .map((b) => ({ tab: b.dataset.tab, text: b.textContent.trim(), sub: b.dataset.sub || '' })))()`);

runTest(async () => {
  const a = await register('sa' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('sa', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await waitFor(w, `!document.getElementById('settings').classList.contains('hidden')`, 'настройки', 4000);
  await sleep(350);

  const rows = await rootRows(w);
  console.log('settings-root', JSON.stringify(rows));
  const texts = rows.map((r) => r.text);
  if (new Set(texts).size !== texts.length) throw new Error('дубли строк в настройках: ' + texts.join(','));
  if (texts.includes('Устройства') || texts.includes('Шифрование')) throw new Error('остались дублирующие строки: ' + texts.join(','));
  for (const label of ['Оформление', 'Звук и видео', 'Уведомления', 'Аккаунт', 'Данные и приватность']) {
    if (!texts.includes(label)) throw new Error('нет раздела ' + label + ': ' + texts.join(','));
  }

  for (const row of rows) {
    await js(w, `document.querySelector('#set-nav > button[data-tab="${row.tab}"][data-sub="${row.sub}"]').click(); true`);
    await sleep(400);
    const d = JSON.parse(await js(w, `JSON.stringify({
      title: document.getElementById('set-title').textContent.trim(),
      body: document.body.className,
      root: Boolean(document.getElementById('mobile-settings-overview')?.getClientRects().length),
    })`));
    console.log('section', row.tab, JSON.stringify(d));
    if (!d.body.includes('mobile-settings-section')) throw new Error(row.text + ': раздел не открылся');
    if (d.root) throw new Error(row.text + ': корень настроек не скрылся');
    await js(w, `document.getElementById('mobile-settings-back').click(); true`);
    await sleep(300);
  }

  // Приватность: все подвкладки переключаются и не наезжают друг на друга.
  await js(w, `document.querySelector('#set-nav > button[data-tab="privacy"]').click(); true`);
  await sleep(400);
  const privTabs = await js(w, `(() => [...document.querySelectorAll('#privacy-subnav button')].filter((b) => b.getClientRects().length).map((b) => b.dataset.page || b.textContent.trim()))()`);
  console.log('privacy-tabs', JSON.stringify(privTabs));
  if (!privTabs.length) throw new Error('нет подвкладок приватности');
  for (const page of privTabs) {
    await js(w, `(() => { const b = [...document.querySelectorAll('#privacy-subnav button')].find((x) => (x.dataset.page || x.textContent.trim()) === ${JSON.stringify(page)}); if (b) b.click(); return true; })()`);
    await sleep(300);
    const d = JSON.parse(await js(w, `(() => {
      const pages = [...document.querySelectorAll('#settings .privacy-page')].filter((p) => p.getClientRects().length && getComputedStyle(p).display !== 'none');
      return JSON.stringify({ shown: pages.map((p) => p.dataset.privacyPage), active: document.querySelector('#privacy-subnav button.active')?.dataset.page || '' });
    })()`));
    console.log('privacy', page, JSON.stringify(d));
    if (d.shown.length !== 1) throw new Error('страниц приватности видно ' + d.shown.length + ': ' + d.shown.join(','));
  }
});
