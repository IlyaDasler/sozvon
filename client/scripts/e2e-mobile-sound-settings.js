// Звук и видео: микрофон, динамики, шумоподавление, камера и проверка звука на месте.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('sd' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('sd', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500);
  await js(w, `document.querySelector('#set-nav > button[data-tab="sound"]').click(); true`);
  await sleep(500);

  console.log('has-label', await js(w, `JSON.stringify({ count: document.querySelectorAll('#set-ns-value').length, html: document.querySelector('#sound-noise-block')?.outerHTML.slice(0, 300) || 'no block' })`));
  const d = JSON.parse(await js(w, `(() => {
    const vis = (s) => { const e=document.querySelector(s); return Boolean(e && e.getClientRects().length && getComputedStyle(e).display !== 'none'); };
    const range = document.getElementById('set-ns-level');
    const label = document.getElementById('set-ns-value');
    return JSON.stringify({
      mic: vis('#set-mic'), speaker: vis('#set-speaker'),
      noise: vis('#set-ns-level'), label: label?.textContent.trim(),
      camera: vis('#cam-picker-btn') || vis('#cam-test-btn'),
      monitor: vis('#mic-monitor-btn'), micTest: vis('#mic-test-btn'), speakerTest: vis('#speaker-test-btn'),
      doc: document.documentElement.scrollWidth, vw: innerWidth,
      value: range.value,
    });
  })()`));
  console.log('sound-settings', JSON.stringify(d));
  if (!d.mic || !d.speaker) throw new Error('нет выбора микрофона/динамиков');
  if (!d.noise) throw new Error('нет шумоподавления');
  if (!d.label) throw new Error('нет подписи уровня шумоподавления: ' + d.label);
  if (!d.camera) throw new Error('нет настроек камеры');
  if (!d.monitor || !d.micTest || !d.speakerTest) throw new Error('нет проверки звука');
  if (d.doc > d.vw + 1) throw new Error('горизонтальный скролл в звуке');

  await js(w, `(() => {
    const r = document.getElementById('set-ns-level');
    r.value = '3';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(500);
  const after = JSON.parse(await js(w, `JSON.stringify({ label: document.getElementById('set-ns-value').textContent.trim(), level: state.settings.noiseLevel })`));
  console.log('noise-updated', JSON.stringify(after));
  if (after.label !== 'Сильное' || after.level !== 3) throw new Error('шумоподавление не обновилось: ' + JSON.stringify(after));
});
