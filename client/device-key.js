// Секрет устройства: привязывает сессию к этому компьютеру. В базе сервера
// хранится только SHA-256, сам секрет лежит в зашифрованном файле профиля.
const { app, ipcMain, safeStorage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const filePath = () => path.join(app.getPath('userData'), 'device-key.bin');
let cached = '';
const E2E_KEY = process.env.SOZVON_E2E_DEVICE_KEY || 'e2e-device-key';

function read() {
  if (cached) return cached;
  if (process.env.SOZVON_E2E === '1') return (cached = E2E_KEY);
  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(filePath())) {
      cached = safeStorage.decryptString(fs.readFileSync(filePath()));
      if (cached) return cached;
    }
  } catch {}
  cached = crypto.randomBytes(32).toString('base64url');
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const file = filePath();
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, safeStorage.encryptString(cached), { mode: 0o600 });
      try { fs.unlinkSync(file); } catch {}
      fs.renameSync(temp, file);
    }
  } catch {}
  return cached;
}

function registerDeviceKey() {
  ipcMain.on('device:key', (event) => { event.returnValue = read(); });
}

module.exports = { registerDeviceKey };
