// Сессии: каждый вход — отдельная запись на сервере, поэтому его можно отключить, не дожидаясь конца токена.
// Токены версий до 2.7 записей не имеют: они работают, пока человек не сменит пароль или не выйдет везде.
import crypto from 'node:crypto';
import { readToken, signToken, TOKEN_TTL_MS } from './auth.js';
import { sessions, users } from './db.js';
import { hub } from './hub.js';

const TOUCH_EVERY_MS = 5 * 60_000; // «последний раз в сети» с такой точностью, чтобы не писать в базу на каждый запрос
const TICKET_TTL_MS = 30_000;

setInterval(() => sessions.dropOlderThan(Date.now() - TOKEN_TTL_MS), 60 * 60_000).unref();

/** Название устройства для списка: из подписи приложения или браузера */
export function deviceName(userAgent = '') {
  const app = /Sozvon\/(\d+\.\d+)/.exec(userAgent);
  const os = /Windows/.test(userAgent) ? 'Windows' : /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Mac OS/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : '';
  return [app ? `Созвон ${app[1]}` : 'Браузер', os].filter(Boolean).join(' · ');
}

/** Новый вход: запись о сессии и токен к ней */
export function openSession(userId, userAgent) {
  const id = crypto.randomBytes(16).toString('hex');
  sessions.add(id, userId, deviceName(userAgent));
  return signToken(userId, id);
}

/** Кто стоит за токеном: { user, sid }; sid нет у токенов старых версий. null — вход недействителен */
export function sessionOf(token) {
  const data = readToken(token);
  const user = data && users.byId(data.uid);
  if (!user) return null;
  if (!data.sid) return user.legacy_revoked ? null : { user, sid: null };
  const session = sessions.byId(data.sid);
  if (session?.user_id !== user.id) return null;
  if (Date.now() - session.last_seen > TOUCH_EVERY_MS) sessions.touch(session.id);
  return { user, sid: session.id };
}

/** Отключить одну сессию: доступ и открытые соединения пропадают сразу */
export function closeSession(userId, sid) {
  sessions.remove(sid);
  hub.dropSockets(userId, (ws) => ws.sid === sid);
}

/** Отключить всё, кроме сессии keepSid (null — всё), и токены старых версий */
export function closeOtherSessions(userId, keepSid = null) {
  sessions.removeAllBut(userId, keepSid);
  users.revokeLegacyTokens(userId);
  hub.dropSockets(userId, (ws) => !keepSid || ws.sid !== keepSid);
}

// Билет на соединение WebSocket: адрес с токеном мог бы осесть в журналах, а билет живёт полминуты и один раз
const tickets = new Map(); // билет -> { sid, userId, expires }

export function issueTicket({ user, sid }) {
  for (const [key, t] of tickets) if (t.expires < Date.now()) tickets.delete(key);
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, { userId: user.id, sid, expires: Date.now() + TICKET_TTL_MS });
  return ticket;
}

/** Обменять билет на { user, sid }; второй раз тот же билет не сработает */
export function redeemTicket(ticket) {
  const t = tickets.get(ticket);
  tickets.delete(ticket);
  if (!t || t.expires < Date.now()) return null;
  const user = users.byId(t.userId);
  return user && (!t.sid || sessions.byId(t.sid)) ? { user, sid: t.sid } : null;
}
