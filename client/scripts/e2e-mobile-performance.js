// Тир эффектов: low — без blur, high — стекло сохраняется.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');
runTest(async () => {
  const a = await register('perf' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('perf', a);
  w.show(); w.focus(); w.setSize(390, 844); await sleep(700);
  const low = await js(w, `(() => { setPerformanceTier('low'); return getComputedStyle(document.getElementById('mobile-nav')).backdropFilter; })()`);
  const high = await js(w, `(() => { setPerformanceTier('high'); return getComputedStyle(document.getElementById('mobile-nav')).backdropFilter; })()`);
  if (low !== 'none') throw new Error('low tier still blurs: ' + low);
  if (!high || high === 'none') throw new Error('high tier lost glass: ' + high);
  console.log(`✔ tiers: low=${low}, high=${high}`);
});