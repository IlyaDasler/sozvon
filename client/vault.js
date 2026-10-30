// Хранилище системы для секретов на диске: токен входа и ключ шифрования. Запись открывается только под этой учётной
// записью Windows, поэтому скопированная папка приложения бесполезна. Ответ синхронный: страница читает настройки при запуске.
const { ipcMain, safeStorage } = require('electron');

function registerVault() {
  ipcMain.on('vault:seal', (event, text) => {
    event.returnValue = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(String(text)).toString('base64') : null;
  });
  ipcMain.on('vault:open', (event, sealed) => {
    try {
      event.returnValue = safeStorage.decryptString(Buffer.from(String(sealed), 'base64'));
    } catch {
      event.returnValue = null; // запись с другого компьютера или испорчена
    }
  });
}

module.exports = { registerVault };
