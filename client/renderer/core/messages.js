// Переписка с контактом: загрузка и расшифровка. Без DOM и без записи на сервер.
import { Api } from '../api.mjs';
import { dmConvOf, decryptList, loadConvKeys, readIdentity } from './crypto.js';

const markLocked = (list, reason) => {
  for (const m of list) if (m.enc && !m.plain) m.locked = reason;
};

export const messages = {
  // Первая страница переписки, по возрастанию id. Зашифрованные — расшифрованы или помечены.
  async dmHistory({ meId, peerId, serverPublicKey }) {
    const list = (await Api.get(`/messages/${peerId}`)).sort((a, b) => a.id - b.id);
    const encrypted = list.filter((m) => m.enc);
    if (!encrypted.length) return list;

    const identity = readIdentity({ base: Api.base, meId, serverPublicKey });
    if (!identity) {
      markLocked(encrypted, 'no-identity');
      return list;
    }

    const conv = dmConvOf(meId, peerId);
    let keyring;
    try {
      keyring = await loadConvKeys(conv, identity);
      // Ключ мог быть раздан уже после загрузки — перечитываем один раз.
      if (encrypted.some((m) => !keyring.keys.has(m.enc.epoch))) {
        keyring = await loadConvKeys(conv, identity);
      }
    } catch {
      markLocked(encrypted, 'no-key');
      return list;
    }

    await decryptList(encrypted, conv, keyring);
    return list;
  },
};
