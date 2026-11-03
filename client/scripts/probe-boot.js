console.log('BOOT start');
const { app } = require('electron');
console.log('BOOT electron');
const lib = require('./e2e-lib');
console.log('BOOT lib');
app.whenReady().then(async () => {
  console.log('BOOT ready');
  try {
    const suffix = Date.now().toString(36).slice(-6);
    const res = await lib.api('POST', '/register', { username: `probe_${suffix}`, password: 'test-pass-1', displayName: 'Probe' });
    console.log('BOOT OK', res.user.id);
  } catch (err) {
    console.log('BOOT FAIL', err.message, err.cause?.code || '');
  }
  app.exit(0);
});
