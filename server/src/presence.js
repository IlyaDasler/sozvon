// Статус человека для друзей и соседей по комнатам.
// Выбирает он сам: online — активен, idle — неактивен, dnd — не беспокоить, invisible — невидимый.
// Остальные видят: online, idle, dnd или offline (нет подключений либо невидимый).
// «Активен» сам становится «неактивен», когда приложение сообщает, что за компьютером давно никого нет.
import { relatedUserIds, users } from './db.js';
import { hub } from './hub.js';

export const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

const autoIdle = new Set(); // userId — давно не трогали мышь и клавиатуру
const lastSent = new Map(); // userId -> статус, о котором уже рассказали

const chosenStatus = (status) => (STATUSES.includes(status) ? status : 'online');

/** Что видят другие */
export function presenceOf(userId, chosen = users.byId(userId)?.status) {
  if (!hub.isOnline(userId)) return 'offline';
  const status = chosenStatus(chosen);
  if (status === 'invisible') return 'offline';
  if (status === 'online' && autoIdle.has(userId)) return 'idle';
  return status;
}

/** Рассказывает друзьям и соседям по комнатам, если видимый статус поменялся. online — для версий до 1.7.3 */
export function broadcastPresence(userId) {
  const status = presenceOf(userId);
  if (lastSent.get(userId) === status) return;
  lastSent.set(userId, status);
  const message = { type: 'presence', userId, online: status !== 'offline', status };
  for (const id of relatedUserIds(userId)) hub.send(id, message);
}

export function setAutoIdle(userId, idle) {
  if (idle) autoIdle.add(userId);
  else autoIdle.delete(userId);
  broadcastPresence(userId);
}

/** Последнее подключение закрылось */
export function userGone(userId) {
  autoIdle.delete(userId);
  broadcastPresence(userId);
}
