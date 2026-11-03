const { app } = require('electron');
require('./e2e-lib');
app.whenReady().then(async () => {
  try {
    console.log('BOOT fetch start');
    const res = await fetch('http://127.0.0.1:3000/api/health');
    console.log('BOOT fetch status', res.status);
  } catch (err) {
    console.log('BOOT fetch fail', err.message, err.cause?.code || '');
  }
  app.exit(0);
});
