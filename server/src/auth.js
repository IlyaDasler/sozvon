import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// scrypt считает десятки миллисекунд: в отдельном потоке, иначе вход одного останавливает сервер для всех
const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Для тех, у кого пароля нет: проверка длится столько же, и по времени ответа не понять, есть ли такой профиль
const NO_PASSWORD = `scrypt$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(64).toString('base64')}`;

export async function verifyPassword(password, stored) {
  // У профилей, созданных через Яндекс, пароля может не быть
  const [, salt, hash] = (stored || NO_PASSWORD).split('$');
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual) && Boolean(stored);
}

const sign = (payload) => crypto.createHmac('sha256', config.secret).update(payload).digest();

// Токен вида <payload>.<подпись>, оба в base64url
export function signToken(userId, sessionId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, sid: sessionId, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload).toString('base64url')}`;
}

/** Подпись и срок верны — { uid, sid }, иначе null; действует ли сессия, решает sessions.js */
export function readToken(token) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    // У пропусков регистрации есть поле kind — как токен входа их принимать нельзя
    return data.exp > Date.now() && !data.kind ? data : null;
  } catch {
    return null;
  }
}

const TICKET_TTL_MS = 10 * 60 * 1000;

/** Пропуск на создание профиля: аккаунт сервиса уже подтверждён, не хватает только кода приглашения */
export function signTicket(data) {
  const payload = Buffer.from(JSON.stringify({ ...data, kind: 'oauth-signup', exp: Date.now() + TICKET_TTL_MS })).toString(
    'base64url'
  );
  return `${payload}.${sign(payload).toString('base64url')}`;
}

export function verifyTicket(ticket) {
  if (typeof ticket !== 'string') return null;
  const [payload, sig] = ticket.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.kind === 'oauth-signup' && data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}
