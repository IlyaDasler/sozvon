// Хранилище системы для секретов на диске: токен входа и ключ шифрования. Запись открывается только под этой учётной
// записью Windows, поэтому скопированная папка приложения бесполезна. Ответ синхронный: страница читает настройки при запуске.
const { app, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Копия ключа шифрования на диске, отдельно от localStorage. Обычный кэш приложения
// может быть очищен при обновлении, а файл профиля — нет, поэтому уже авторизованное
// устройство не просит перенести ключ заново.
const identityFile = () => path.join(app.getPath('userData'), 'e2ee-identity.bin');

function registerVault(ipc = ipcMain) {
  ipc.on('vault:seal', (event, text) => {
    event.returnValue = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(String(text)).toString('base64') : null;
  });
  ipc.on('vault:open', (event, sealed) => {
    try {
      event.returnValue = safeStorage.decryptString(Buffer.from(String(sealed), 'base64'));
    } catch {
      event.returnValue = null; // запись с другого компьютера или испорчена
    }
  });
  ipc.on('identity:save', (event, text) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return (event.returnValue = false);
      const file = identityFile();
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, safeStorage.encryptString(String(text)), { mode: 0o600 });
      try { fs.unlinkSync(file); } catch {}
      fs.renameSync(temporary, file);
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });
  ipc.on('identity:load', (event) => {
    try {
      const file = identityFile();
      if (!fs.existsSync(file)) return (event.returnValue = null);
      event.returnValue = safeStorage.decryptString(fs.readFileSync(file));
    } catch {
      event.returnValue = null;
    }
  });
}

module.exports = { registerVault };
