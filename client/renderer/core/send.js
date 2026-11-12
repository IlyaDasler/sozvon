// Отправка личного сообщения из нового мобильного слоя.
// Шифрование выполняет уже загруженный e2ee.js: ключи и формат конверта не дублируем.
import { Api } from '../api.mjs';

export async function sendDm(peerId, text, meId) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (typeof window.encryptOutgoing !== 'function') {
    throw new Error('Шифрование на этом устройстве не готово');
  }
  const conv = `dm:${Math.min(Number(meId), Number(peerId))}-${Math.max(Number(meId), Number(peerId))}`;
  const encrypted = await window.encryptOutgoing(conv, { text: value });
  const saved = await Api.post(`/messages/${peerId}`, encrypted.body);
  return { ...saved, plain: encrypted.plain };
}
