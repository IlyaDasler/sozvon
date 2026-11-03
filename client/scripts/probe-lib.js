const { app } = require('electron');
const { api } = require('./e2e-lib');
app.whenReady().then(async () => {
  try {
    const suffix = Date.now().toString(36).slice(-6);
    const res = await api('POST', '/register', { username: `probe_${suffix}`, password: 'test-pass-1', displayName: 'Probe' });
    console.log('E2ELIB_OK', res.user.id);
  } catch (err) {
    console.log('E2ELIB_FAIL', err.message, err.cause?.code || '');
  }
  app.exit(0);
});
