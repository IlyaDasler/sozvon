process.env.SOZVON_E2E = '1';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.E2E_USER_DATA) app.setPath('userData', process.env.E2E_USER_DATA);
const { openClient, js } = require('./e2e-lib');

const commandFile = process.env.E2E_COMMAND_FILE;
const resultFile = process.env.E2E_RESULT_FILE;

function write(payload) {
  const temp = `${resultFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload) + '\n');
  fs.renameSync(temp, resultFile);
}

app.whenReady().then(async () => {
  const auth = JSON.parse(process.env.E2E_AUTH || '{}');
  const win = await openClient(process.env.E2E_NAME || 'child', auth);
  write({ ready: true });
  setInterval(async () => {
    if (!commandFile || !fs.existsSync(commandFile)) return;
    let command;
    try { command = JSON.parse(fs.readFileSync(commandFile, 'utf8')); } catch { return; }
    try { fs.unlinkSync(commandFile); } catch {}
    if (command.type === 'close') {
      write({ id: command.id, result: true });
      app.quit();
      return;
    }
    try {
      write({ id: command.id, result: await js(win, command.code) });
    } catch (error) {
      write({ id: command.id, error: String(error?.message || error) });
    }
  }, 150).unref();
}).catch((error) => {
  write({ error: String(error?.stack || error) });
  app.quit();
});
