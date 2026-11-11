// Расшифровка личных переписок, только на чтение. Примитивы — e2ee-crypto.js (общий с десктопом).
// Мобильный слой не создаёт, не перезаписывает и не раздаёт ключи: это делает десктоп.
import { Api } from '../api.mjs';

const primitives = () => {
  if (typeof E2EE === 'undefined') throw new Error('Модуль шифрования не загружен');
  return E2EE;
};

const serverScope = (base) =>
  String(base || '')
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-z0-9.-]/gi, '_')
    .toLowerCase() || 'local';

export const dmConvOf = (meId, peerId) => `dm:${Math.min(meId, peerId)}-${Math.max(meId, peerId)}`;

// Личный ключ этого устройства. Зашифрованный системным хранилищем (десктоп) здесь не открыть —
// тогда null. Ключ, который не совпадает с публичным на сервере, тоже не используем.
export function readIdentity({ base, meId, serverPublicKey }) {
  let value;
  try {
    value = JSON.parse(localStorage.getItem(`e2ee:${serverScope(base)}:identity:${meId}`));
  } catch {
    return null;
  }
  if (!value || value.vault || !value.privateJwk || !value.publicKey) return null;
  if (serverPublicKey && serverPublicKey !== value.publicKey) return null;
  return value;
}

export async function loadConvKeys(conv, identity) {
  const E = primitives();
  const priv = await E.importPrivate(identity.privateJwk);
  const data = await Api.get(`/keys/${conv}`);
  const keys = new Map();
  for (const [epoch, sealed] of Object.entries(data.mine || {})) {
    try {
      keys.set(Number(epoch), await E.open(sealed, priv));
    } catch {
      // Ключ этой версии не открылся — сообщения этой версии покажем как недоступные.
    }
  }
  return { keys, epoch: data.epoch };
}

export async function decryptList(list, conv, keyring) {
  const E = primitives();
  for (const m of list) {
    if (!m.enc) continue;
    const key = keyring.keys.get(m.enc.epoch);
    if (!key) {
      m.locked = 'no-key';
      continue;
    }
    try {
      m.plain = await E.decryptMessage(key, m.enc, { conv, epoch: m.enc.epoch, from: m.fromId });
      delete m.locked;
    } catch {
      m.locked = 'broken';
    }
  }
}
