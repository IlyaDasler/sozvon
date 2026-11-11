// Хранилище ключей с поддержкой системного шифрования.
// На десктопе (Electron) токен входа лежит зашифрованным через safeStorage, иначе
// скопированная папка приложения давала бы доступ к аккаунту. В вебе vault нет.
const vault = globalThis.window?.desktop?.vault;

const isSecret = (key) => key === 'session';

export const storage = {
  read(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      const value = JSON.parse(raw);
      if (isSecret(key) && vault && value?.vault) {
        return JSON.parse(vault.open(value.vault));
      }
      return value;
    } catch {
      return null;
    }
  },

  write(key, value) {
    try {
      if (value === null) {
        localStorage.removeItem(key);
        return;
      }
      const sealed = isSecret(key) ? vault?.seal(JSON.stringify(value)) : null;
      localStorage.setItem(key, JSON.stringify(sealed ? { vault: sealed } : value));
    } catch {
      // Хранилище недоступно — сессия живёт до перезагрузки
    }
  },
};
