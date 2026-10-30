// Двухфакторный вход: коды из приложения-аутентификатора (RFC 6238) и одноразовые резервные коды
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;
const RECOVERY_CODES = 10;

const currentStep = () => Math.floor(Date.now() / STEP_MS);

function base32(bytes) {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g).map((chunk) => ALPHABET[parseInt(chunk.padEnd(5, '0'), 2)]).join('');
}

function fromBase32(text) {
  let bits = '';
  for (const c of text) bits += ALPHABET.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g).map((chunk) => parseInt(chunk, 2)));
}

function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = crypto.createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const at = hash[19] & 15;
  return String((hash.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export const newSecret = () => base32(crypto.randomBytes(20));

/** Адрес для QR-кода: его понимают все приложения-аутентификаторы */
export const otpauthUri = (secret, account) => `otpauth://totp/${encodeURIComponent(`Созвон:${account}`)}?secret=${secret}&issuer=${encodeURIComponent('Созвон')}`;

/**
 * Шаг времени, для которого подошёл код, иначе null. Часы могут расходиться на шаг в каждую сторону.
 * lastStep — последний принятый: один и тот же код дважды не сработает, даже если его подсмотрели
 */
export function matchCode(secret, code, lastStep) {
  const now = currentStep();
  for (const step of [now - 1, now, now + 1]) if (step > lastStep && code === codeAt(secret, step)) return step;
  return null;
}

const hashCode = (code) => crypto.createHash('sha256').update(code.trim().toLowerCase()).digest('hex');

/** Резервные коды: { codes } показать один раз, { hashes } хранить */
export function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_CODES }, () => crypto.randomBytes(5).toString('hex').replace(/(.{5})/, '$1-'));
  return { codes, hashes: codes.map(hashCode) };
}

/** Хэши без использованного кода, либо null, если такого кода нет */
export function spendRecoveryCode(hashes, code) {
  const hash = hashCode(code);
  return hashes.includes(hash) ? hashes.filter((h) => h !== hash) : null;
}
