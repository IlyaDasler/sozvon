// Сквозное шифрование переписки на стороне сервера. Сервер не видит ни ключей, ни текстов: он хранит
// публичные ключи людей, ключи переписок, запечатанные для каждого участника его публичным ключом,
// и «конверты» сообщений. Здесь — что считается перепиской, кто в ней участвует и как выглядит конверт.
import { rooms, users } from './db.js';

// Переписка: личная — «dm:<меньший id>-<больший id>», комнатная — «room:<id>»
const CONV_RE = /^(?:dm:(\d+)-(\d+)|room:(\d+))$/;

export const dmConv = (a, b) => `dm:${Math.min(a, b)}-${Math.max(a, b)}`;
export const roomConv = (roomId) => `room:${roomId}`;

/** Участники переписки (id) или null, если такой нет */
export function convMembers(conv) {
  const m = CONV_RE.exec(String(conv));
  if (!m) return null;
  if (m[3]) {
    const roomId = Number(m[3]);
    return rooms.byId(roomId) ? rooms.members(roomId).map((u) => u.id) : null;
  }
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a >= b || !users.byId(a) || !users.byId(b)) return null;
  return [a, b];
}

// Публичный ключ — точка P-256 без сжатия: 65 байт, первый — 0x04
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
export function isPublicKey(value) {
  if (typeof value !== 'string' || !B64_RE.test(value) || value.length > 120) return false;
  const raw = Buffer.from(value, 'base64');
  return raw.length === 65 && raw[0] === 4;
}

// Запечатанный ключ — строка разумного размера (внутри JSON с эфемерным ключом, iv и шифром)
export const isSealed = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096;

const MAX_CT = 96 * 1024;

/** Конверт сообщения: { v: 1, epoch, iv, ct } — iv 12 байт, ct до 96 КБ в base64. Иначе null */
export function parseEnvelope(value) {
  if (!value || typeof value !== 'object') return null;
  const { v, epoch, iv, ct } = value;
  if (v !== 1 || !Number.isInteger(epoch) || epoch < 1) return null;
  if (typeof iv !== 'string' || !B64_RE.test(iv) || Buffer.from(iv, 'base64').length !== 12) return null;
  if (typeof ct !== 'string' || !B64_RE.test(ct) || ct.length > MAX_CT) return null;
  return { v, epoch, iv, ct };
}
