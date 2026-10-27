import crypto from 'node:crypto';
import { config } from './config.js';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  // У профилей, созданных через Яндекс, пароля может не быть
  if (!stored) return false;
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sign = (payload) => crypto.createHmac('sha256', config.secret).update(payload).digest();

// Токен вида <payload>.<подпись>, оба в base64url
export function signToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload).toString('base64url')}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    // У пропусков регистрации есть поле kind — как токен входа их принимать нельзя
    return data.exp > Date.now() && !data.kind ? data.uid : null;
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
