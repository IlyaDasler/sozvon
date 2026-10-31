import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import { config } from './config.js';
import { hashPassword, signTicket, verifyPassword, verifyTicket } from './auth.js';
import { closeOtherSessions, closeSession, issueTicket, openSession, sessionOf } from './sessions.js';
import {
  convKeys,
  keyTransfers,
  setPublicKey,
  blocks,
  contacts,
  friendRequests,
  hubs,
  identities,
  messages,
  pins,
  reactions,
  readState,
  relatedUserIds,
  roles,
  roomMessages,
  rooms,
  sessions,
  toMessage,
  toPublicUser,
  toRoomMessage,
  toSelf,
  uploads,
  users,
} from './db.js';
import { hub } from './hub.js';
import { convMembers, dmConv, isPublicKey, isSealed, parseEnvelope, roomConv } from './e2ee.js';
import { fetchPreview, previewableUrl } from './link-preview.js';
import { canonicalEmail } from './email-address.js';
import { FILE_ID_RE, MAX_ATTACHMENTS, MAX_FILE_BYTES, cleanMime, cleanName, fileHeaders, kindOf, toAttachment } from './files.js';
import { checkCode, mailEnabled, sendCode } from './mail.js';
import { STATUSES, broadcastPresence, presenceOf } from './presence.js';
import { PERMS, cleanPerms, has } from './perms.js';
import { buildAuthUrl, enabledProviders, fetchProfile } from './oauth.js';
import { registerTurnUser } from './turn.js';
import { matchCode, newRecoveryCodes, newSecret, otpauthUri, spendRecoveryCode } from './totp.js';
import { voice } from './voice.js';

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_BIO = 190;
const COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    throw new HttpError(400, 'Пароль должен быть от 8 до 128 символов');
}

// Один ящик — один адрес (у Яндекса много доменов, см. email-address.js)
const normEmail = canonicalEmail;
/** Адрес, как его ввели (без пробелов и заглавных), — его показываем человеку */
const shownEmail = (value) => String(value ?? '').trim().toLowerCase();

function validateEmail(email) {
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, 'Проверьте адрес почты');
}

function requireMail() {
  if (!mailEnabled) throw new HttpError(503, 'Письма с кодами пока не отправляются: на сервере не настроена почта. Попробуйте позже');
}

function requireCode(purpose, email, code) {
  const result = checkCode(purpose, email, code);
  if (result === 'expired') throw new HttpError(400, 'Код устарел — запросите новый');
  if (result === 'wrong') throw new HttpError(400, 'Неверный код из письма');
}

function validateDisplayName(name) {
  if (name.length < 1 || name.length > 32) throw new HttpError(400, 'Имя должно быть от 1 до 32 символов');
}

// Защита от перебора: не больше 10 попыток в минуту с одного адреса, отдельно на каждое действие —
// иначе друзья за одним адресом провайдера мешают друг другу войти и зарегистрироваться
const attempts = new Map();
function rateLimit(req, action) {
  const now = Date.now();
  const key = `${action}:${req.ip}`;
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) {
    attempts.set(key, { count: 1, reset: now + 60_000 });
    return;
  }
  if (++entry.count > config.authRateLimit) throw new HttpError(429, 'Слишком много попыток, подождите минуту');
}

// Перебор одного аккаунта с разных адресов: после 10 ошибок вход в него закрыт на 15 минут
const MAX_LOGIN_FAILS = 10;
const LOCK_MS = 15 * 60_000;
const loginFails = new Map(); // id профиля -> { count, reset }

function requireNotLocked(user) {
  const entry = user && loginFails.get(user.id);
  if (entry && entry.reset > Date.now() && entry.count >= MAX_LOGIN_FAILS)
    throw new HttpError(429, 'Слишком много неудачных попыток. Попробуйте через 15 минут или восстановите пароль');
}

function noteLoginFail(user) {
  if (!user) return;
  const now = Date.now();
  const entry = loginFails.get(user.id);
  if (!entry || entry.reset < now) loginFails.set(user.id, { count: 1, reset: now + LOCK_MS });
  else entry.count++;
}

setInterval(() => {
  const now = Date.now();
  for (const map of [attempts, loginFails]) for (const [key, entry] of map) if (entry.reset < now) map.delete(key);
}, 60_000).unref();

/** Второй фактор: код из приложения или резервный (тратится). Код действует один раз */
function passSecondFactor(user, code) {
  const step = /^\d{6}$/.test(code) ? matchCode(user.totp_secret, code, user.totp_last_step) : null;
  if (step !== null) {
    users.setTotpStep(user.id, step);
    return true;
  }
  const left = spendRecoveryCode(JSON.parse(user.totp_recovery || '[]'), code);
  if (left) users.setTotpRecovery(user.id, left);
  return Boolean(left);
}

// Как человека видят другие: статус (online, idle, dnd, offline) и online — для версий до 1.7.3
const withOnline = (row) => {
  const status = presenceOf(row.id, row.status);
  return { ...toPublicUser(row), online: status !== 'offline', status };
};

/** Вход состоялся: новая сессия этого устройства */
const enter = (req, user, extra) => ({ token: openSession(user.id, req.get('user-agent')), user: toSelf(user), ...extra });

function newOAuthUser(provider, profile) {
  // Логин профиля — из почты, а если почту не дали (Яндекс без права на email) — из логина сервиса
  const username = makeUsername(profile.email || profile.login || '', provider);
  const user = users.create({
    username,
    passwordHash: '',
    displayName: (profile.name || username).slice(0, 32),
    avatarColor: COLORS[crypto.randomInt(COLORS.length)],
  });
  identities.add(provider, profile.providerId, user.id, profile.email || '');
  return user;
}

const createOAuthUser = (req, provider, profile) => enter(req, newOAuthUser(provider, profile), { created: true });

const PKCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

// Аватарки хранятся файлами рядом с базой; приложение заранее обрезает их до квадрата 256×256 в формате WebP
const AVATAR_DIR = path.join(config.dataDir, 'avatars');
const AVATAR_MAX_BYTES = 300 * 1024;
const BACKGROUND_MAX_BYTES = 2 * 1024 * 1024; // фон комнаты — во всю ширину окна
const AVATAR_FILE_RE = /^[a-f0-9]{32}\.webp$/;
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// Файлы вложений лежат рядом с базой под именем-id. Загрузку, которую за час так и не прикрепили, удаляем
const FILES_DIR = path.join(config.dataDir, 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });
setInterval(() => {
  for (const id of uploads.stale(Date.now() - 60 * 60_000)) {
    fs.rm(path.join(FILES_DIR, id), { force: true }, () => {});
    uploads.remove(id);
  }
}, 10 * 60_000).unref();

/** Не чаще max раз за windowMs: для людей, которые уже вошли */
function userLimit(req, action, max, windowMs, message) {
  const now = Date.now();
  const key = `${action}:${req.user.id}`;
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) attempts.set(key, { count: 1, reset: now + windowMs });
  else if (++entry.count > max) throw new HttpError(429, message);
}

/** Отказ в загрузке: сначала дочитываем тело (с потолком), иначе приложение увидит обрыв связи вместо причины */
function refuseUpload(req, error) {
  return new Promise((_resolve, reject) => {
    let read = 0;
    const finish = () => reject(error);
    req.on('data', (chunk) => {
      read += chunk.length;
      if (read > 2 * MAX_FILE_BYTES) {
        req.destroy();
        finish();
      }
    });
    req.on('end', finish);
    req.on('close', finish);
  });
}

/** Вложения удалённого сообщения больше не нужны: файл с диска и запись о загрузке */
function removeAttachments(row) {
  for (const a of parseAttachments(row.attachments)) {
    fs.rmSync(path.join(FILES_DIR, a.id), { force: true });
    uploads.remove(a.id);
  }
}
const parseAttachments = (json) => {
  try {
    const list = JSON.parse(json || '[]');
    return Array.isArray(list) ? list.filter((a) => FILE_ID_RE.test(a?.id || '')) : [];
  } catch {
    return [];
  }
};

const MAX_TEXT = 2000;

// Превью — только для ссылки из самого сообщения (www.… приложение присылает как https://www.…)
const linkInText = (text, url) => text.includes(url) || text.includes(url.replace(/^https:\/\//, ''));

/** Сообщение из запроса: текст, вложения и превью ссылки (previewUrl; не прислали — человек его убрал).
 *  Без текста можно, если есть вложения */
async function messageFrom(req, conv) {
  userLimit(req, 'message', config.messageRateLimit, 10_000, 'Вы пишете слишком быстро, подождите несколько секунд');
  const text = str(req.body.text);
  const enc = req.body.enc == null ? null : parseEnvelope(req.body.enc);
  if (req.body.enc != null && !enc) throw new HttpError(400, 'Неверный зашифрованный конверт');
  if (enc && enc.epoch > convKeys.epoch(conv)) throw new HttpError(400, 'Такой версии ключа у переписки нет');
  if (text.length > MAX_TEXT) throw new HttpError(400, `Сообщение должно быть не длиннее ${MAX_TEXT} символов`);
  const ids = Array.isArray(req.body.attachmentIds) ? req.body.attachmentIds : [];
  if (ids.length > MAX_ATTACHMENTS) throw new HttpError(400, `Можно прикрепить не больше ${MAX_ATTACHMENTS} файлов`);
  if (!ids.every((id) => typeof id === 'string' && FILE_ID_RE.test(id)) || new Set(ids).size !== ids.length)
    throw new HttpError(400, 'Неверные вложения');
  if (!text && !ids.length && !enc) throw new HttpError(400, 'Напишите сообщение или прикрепите файл');
  const rows = ids.length ? uploads.claim(ids, req.user.id) : [];
  if (!rows) throw new HttpError(400, 'Вложение не найдено или уже отправлено — прикрепите файл заново');
  const previewUrl = !enc && previewableUrl(req.body.previewUrl);
  const preview = previewUrl && linkInText(text, req.body.previewUrl) ? await fetchPreview(previewUrl) : null;
  return { text, attachments: rows.map(toAttachment), preview, enc };
}

// ---------- Реакции, закреп и ответ: только id и смайлики, текст остаётся зашифрованным ----------

const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\u200d|\uFE0F){1,8}$/u;

function takeEmoji(value) {
  const emoji = String(value || '').trim();
  if (!EMOJI_RE.test(emoji)) throw new HttpError(400, 'Неизвестный смайлик');
  return emoji;
}

/** Дополняет сообщения реакциями и признаком закрепа */
function withMessageMeta(list, kind, _chatId, me) {
  const react = reactions.ofMessages(kind, list.map((m) => m.id), me);
  for (const m of list) {
    m.reactions = react[m.id] || [];
    m.pinned = pins.has(kind, m.id);
  }
  return list;
}

/** id сообщения, на которое отвечают: оно должно быть из этой же переписки или комнаты. У личных и комнатных счётчики свои */
function replyTarget(value, table, belongs) {
  if (value == null || value === '') return null;
  const id = Number(value);
  if (!id) return null;
  const row = table.byId(id);
  if (!row || !belongs(row)) throw new HttpError(400, 'Сообщение для ответа не найдено');
  return row.id;
}

const isWebp = (buf) =>
  buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';

// Удаляем сразу, до ответа: после «картинка убрана» по старому адресу её уже не должно быть
function removeAvatarFile(id) {
  if (id) fs.rmSync(path.join(AVATAR_DIR, `${id}.webp`), { force: true });
}

// Логин для нового профиля из почты или имени: ivan.petrov@yandex.ru -> ivan.petrov, при совпадении добавляем цифры
function makeUsername(email, fallback) {
  let base = (email.split('@')[0] || fallback).toLowerCase().replace(/[^a-z0-9_.]/g, '_').slice(0, 20);
  if (base.length < 3) base = `${base}${fallback}`.slice(0, 20).padEnd(3, '_');
  if (!users.byUsername(base)) return base;
  for (;;) {
    const candidate = `${base}${crypto.randomInt(10, 10000)}`;
    if (!users.byUsername(candidate)) return candidate;
  }
}

// Друзьям и соседям по комнатам
function notifyRelated(userId, message) {
  for (const id of relatedUserIds(userId)) hub.send(id, message);
}

/** Профиль изменился — всем, кто его видит, и самому человеку: его другие устройства и его же копии в комнатах */
function notifyProfile(row) {
  const message = { type: 'user:updated', user: toPublicUser(row) };
  notifyRelated(row.id, message);
  hub.send(row.id, message);
}

const ROOM_KINDS = ['voice', 'text'];
const MAX_OWNED_HUBS = 10;
const MAX_HUB_ROOMS = 30;
// Участники комнаты — из участников канала, поэтому предел один
const MAX_HUB_MEMBERS = 50;
const MAX_ROOM_MEMBERS = MAX_HUB_MEMBERS;
const MAX_ROLES = 20;
const MAX_TIMEOUT_SECONDS = 28 * 24 * 3600;

function validateRoomName(name) {
  if (name.length < 1 || name.length > 40) throw new HttpError(400, 'Название комнаты — от 1 до 40 символов');
}

const toRoom = (row) => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  hubId: row.hub_id,
  ownerId: row.owner_id,
  createdAt: row.created_at,
  defaultPerms: row.default_perms,
  backgroundUrl: row.background ? `/api/avatars/${row.background}.webp` : null,
  roles: roles.of(row.id).map((r) => ({ id: r.id, name: r.name, color: r.color, perms: r.perms })),
  members: rooms.members(row.id).map((m) => ({
    ...withOnline(m),
    roleId: m.role_id,
    timeoutUntil: m.timeout_until > Date.now() ? m.timeout_until : null,
  })),
  bans: rooms.bans(row.id).map((b) => ({ ...toPublicUser(b), bannedAt: b.banned_at })),
  voice: voice.participants(row.id),
});

// Свежие данные комнаты — всем его участникам
function notifyRoom(roomId) {
  const room = toRoom(rooms.byId(roomId));
  for (const m of room.members) hub.send(m.id, { type: 'room:updated', room });
  return room;
}

function validateHubName(name) {
  if (name.length < 1 || name.length > 40) throw new HttpError(400, 'Название канала — от 1 до 40 символов');
}

const hubIconUrl = (row) => (row.icon ? `/api/avatars/${row.icon}.webp` : null);

const toHub = (row) => ({
  id: row.id,
  name: row.name,
  ownerId: row.owner_id,
  iconColor: row.icon_color,
  iconUrl: hubIconUrl(row),
  createdAt: row.created_at,
  members: hubs.members(row.id).map((m) => ({ ...withOnline(m), manager: Boolean(m.manager), joinedAt: m.joined_at })),
  invited: hubs.invited(row.id),
  bans: hubs.bans(row.id).map((b) => ({ ...toPublicUser(b), bannedAt: b.banned_at })),
});

// Приглашение глазами приглашённого: канал он ещё не видит, поэтому только его вывеска
function toHubInvite(row) {
  const hubRow = hubs.byId(row.hub_id);
  return {
    hub: { id: hubRow.id, name: hubRow.name, iconColor: hubRow.icon_color, iconUrl: hubIconUrl(hubRow), memberCount: hubs.members(hubRow.id).length },
    from: toPublicUser(users.byId(row.by_id)),
    createdAt: row.created_at,
  };
}

// Свежие данные канала — всем его участникам
function notifyHub(hubId) {
  const data = toHub(hubs.byId(hubId));
  for (const m of data.members) hub.send(m.id, { type: 'hub:updated', hub: data });
  return data;
}

export function createApi() {
  const api = express.Router();
  const json = express.json({ limit: '16kb' });
  api.use((req, res, next) => (req.path === '/uploads' ? next() : json(req, res, next)));

  const handle = (fn) => async (req, res, next) => {
    try {
      const result = await fn(req, res);
      if (result !== undefined) res.json(result);
    } catch (err) {
      next(err);
    }
  };

  const sessionFromRequest = (req) => sessionOf((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));

  function requireAuth(req, _res, next) {
    const session = sessionFromRequest(req);
    if (!session) return next(new HttpError(401, 'Нужно войти заново'));
    req.user = session.user;
    req.sid = session.sid;
    next();
  }

  const checkInvite = (code) => {
    if (config.inviteCode && str(code) !== config.inviteCode)
      throw new HttpError(403, 'Неверный код приглашения. Спросите его у владельца сервера');
  };

  function requireContact(req) {
    const other = users.byId(Number(req.params.id));
    if (!other || !contacts.has(req.user.id, other.id)) throw new HttpError(404, 'Пользователь не найден в друзьях');
    return other;
  }

  // emailCodes — сервер умеет отправлять письма: при регистрации по почте нужен код, работает «Забыли пароль?»
  api.get('/health', (_req, res) =>
    res.json({ ok: true, app: 'sozvon', inviteRequired: Boolean(config.inviteCode), emailCodes: mailEnabled })
  );

  // Код подтверждения почты для регистрации
  api.post(
    '/register/code',
    handle(async (req) => {
      rateLimit(req, 'code');
      requireMail();
      checkInvite(req.body.inviteCode);
      const email = normEmail(req.body.email);
      validateEmail(email);
      if (users.byEmail(email)) throw new HttpError(409, 'Эта почта уже зарегистрирована — войдите или восстановите пароль');
      await sendCode('register', email);
      return { ok: true };
    })
  );

  // Сброс пароля: код приходит на почту профиля. Есть ли такой профиль — не сообщаем
  api.post(
    '/password/code',
    handle(async (req) => {
      rateLimit(req, 'code');
      requireMail();
      const email = normEmail(req.body.email);
      validateEmail(email);
      if (users.byEmail(email)) await sendCode('reset', email);
      return { ok: true };
    })
  );

  api.post(
    '/password/reset',
    handle(async (req) => {
      rateLimit(req, 'reset');
      const email = normEmail(req.body.email);
      validateEmail(email);
      validatePassword(req.body.password);
      const user = users.byEmail(email);
      if (!user) throw new HttpError(400, 'Неверный код из письма');
      requireCode('reset', email, req.body.code);
      users.updatePassword(user.id, await hashPassword(req.body.password));
      closeOtherSessions(user.id); // забыл пароль — возможно, не сам: отключаем всех
      loginFails.delete(user.id);
      // Письмо не заменяет второй фактор: дальше обычный вход с кодом
      if (user.totp_secret) return { ok: true, needLogin: true };
      return enter(req, users.byId(user.id));
    })
  );

  async function registerByEmail(req) {
    const email = normEmail(req.body.email);
    validateEmail(email);
    validatePassword(req.body.password);
    const displayName = str(req.body.displayName) || email.split('@')[0].slice(0, 32);
    validateDisplayName(displayName);
    if (users.byEmail(email)) throw new HttpError(409, 'Эта почта уже зарегистрирована — войдите или восстановите пароль');
    requireMail();
    requireCode('register', email, req.body.code);
    const user = users.create({
      username: makeUsername(email, 'user'),
      passwordHash: await hashPassword(req.body.password),
      displayName,
      avatarColor: COLORS[crypto.randomInt(COLORS.length)],
      email,
      emailShown: shownEmail(req.body.email),
    });
    return enter(req, user, { created: true });
  }

  api.post(
    '/register',
    handle(async (req) => {
      rateLimit(req, 'register');
      checkInvite(req.body.inviteCode);
      if (req.body.email !== undefined) return registerByEmail(req);
      const username = str(req.body.username).toLowerCase();
      const displayName = str(req.body.displayName) || username;
      if (!USERNAME_RE.test(username))
        throw new HttpError(400, 'Логин: 3–24 символа, латинские буквы, цифры, точка или _');
      validatePassword(req.body.password);
      validateDisplayName(displayName);
      if (users.byUsername(username)) throw new HttpError(409, 'Этот логин уже занят');

      const user = users.create({
        username,
        passwordHash: await hashPassword(req.body.password),
        displayName,
        avatarColor: COLORS[crypto.randomInt(COLORS.length)],
      });
      return enter(req, user);
    })
  );

  api.post(
    '/login',
    handle(async (req) => {
      rateLimit(req, 'login');
      // Войти можно и по почте, и по логину
      const login = str(req.body.username).toLowerCase();
      const user = login.includes('@') ? users.byEmail(normEmail(login)) : users.byUsername(login);
      requireNotLocked(user);
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      if (!(await verifyPassword(password, user?.password_hash)) || !user) {
        noteLoginFail(user);
        throw new HttpError(401, 'Неверная почта, логин или пароль');
      }
      if (user.totp_secret) {
        const code = str(req.body.totpCode);
        if (!code) {
          const err = new HttpError(403, 'Введите код из приложения-аутентификатора');
          err.extra = { needTotp: true };
          throw err;
        }
        if (!passSecondFactor(user, code)) {
          noteLoginFail(user);
          throw new HttpError(401, 'Неверный код');
        }
      }
      loginFails.delete(user.id);
      return enter(req, user);
    })
  );

  // ---------- Вход через Яндекс ----------

  // Картинки открываются без токена (тег img его не передаёт), но имя файла случайное и меняется при каждой загрузке
  api.get('/avatars/:file', (req, res, next) => {
    if (!AVATAR_FILE_RE.test(req.params.file)) return next(new HttpError(404, 'Не найдено'));
    res.sendFile(req.params.file, { root: AVATAR_DIR, maxAge: '365d', immutable: true }, (err) => {
      if (err && !res.headersSent) next(new HttpError(404, 'Не найдено'));
    });
  });

  // Вложение по ссылке вида /api/files/<id>/<имя>; имя в адресе — только чтобы сохранялось с нормальным названием
  api.get('/files/:id/:name', (req, res, next) => {
    const row = FILE_ID_RE.test(req.params.id) && uploads.byId(req.params.id);
    if (!row) return next(new HttpError(404, 'Файл не найден'));
    res.set(fileHeaders(row));
    res.sendFile(row.id, { root: FILES_DIR }, (err) => {
      if (err && !res.headersSent) next(new HttpError(404, 'Файл не найден'));
    });
  });

  api.get('/oauth/providers', (_req, res) => res.json(enabledProviders()));

  // Вход через сервис в браузере: сервер сам принимает ответ сервиса и возвращает на страницу с одноразовым кодом.
  // В приложении код принимает localhost:47615, а в браузере принять его некому — ведём через сервер.
  // Токен в адрес не кладём: адреса оседают в истории браузера и журналах.
  const WEB_FLOW_TTL = 10 * 60_000;
  const WEB_CODE_TTL = 60_000;
  const STATE_COOKIE = 'sozvon_oauth';
  const webFlows = new Map(); // state -> { provider, verifier, expires }
  const webCodes = new Map(); // код на странице -> { userId } или { ticket }, и expires
  const publicBase = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const forgetExpired = (map) => {
    for (const [key, entry] of map) if (entry.expires < Date.now()) map.delete(key);
  };

  api.get('/oauth/:provider/web', (req, res) => {
    try {
      rateLimit(req, 'oauth');
      const provider = req.params.provider;
      const state = crypto.randomBytes(16).toString('base64url');
      const verifier = crypto.randomBytes(48).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const url = buildAuthUrl(provider, state, challenge, `${publicBase(req)}/api/oauth/${provider}/callback`);
      forgetExpired(webFlows);
      webFlows.set(state, { provider, verifier, expires: Date.now() + WEB_FLOW_TTL });
      // Вернуться может только тот браузер, что начал вход: иначе по чужой ссылке человек окажется в чужом профиле
      const secure = req.protocol === 'https' ? '; Secure' : '';
      res.set('Set-Cookie', `${STATE_COOKIE}=${state}; Path=/api/oauth; Max-Age=600; HttpOnly; SameSite=Lax${secure}`);
      res.redirect(url);
    } catch (err) {
      res.redirect(`/?oauth_error=${encodeURIComponent(err.message || 'Вход через сервис недоступен')}`);
    }
  });

  api.get('/oauth/:provider/callback', async (req, res) => {
    const back = (params) => res.redirect(`/?${new URLSearchParams(params)}`);
    const pass = (entry) => {
      const code = crypto.randomBytes(24).toString('base64url');
      forgetExpired(webCodes);
      webCodes.set(code, { ...entry, expires: Date.now() + WEB_CODE_TTL });
      back({ oauth_code: code });
    };
    const state = String(req.query.state || '');
    const flow = webFlows.get(state);
    webFlows.delete(state);
    const sameBrowser = (req.get('cookie') || '').split(/;\s*/).includes(`${STATE_COOKIE}=${state}`);
    res.set('Set-Cookie', `${STATE_COOKIE}=; Path=/api/oauth; Max-Age=0; HttpOnly; SameSite=Lax`);
    if (req.query.error || !flow || flow.expires < Date.now() || !sameBrowser)
      return back({ oauth_error: 'Вход отменён или устарел. Попробуйте ещё раз' });
    try {
      const profile = await fetchProfile(flow.provider, { code: String(req.query.code || ''), codeVerifier: flow.verifier });
      const existing = identities.find(flow.provider, profile.providerId);
      if (existing) return pass({ userId: existing.user_id });
      // Без кода приглашения профиль не создаём — вернём пропуск, приложение попросит код
      if (config.inviteCode) return pass({ ticket: signTicket({ provider: flow.provider, ...profile }) });
      return pass({ userId: newOAuthUser(flow.provider, profile).id });
    } catch (err) {
      return back({ oauth_error: err.message || 'Не удалось войти через сервис' });
    }
  });

  // Страница меняет код из адреса на обычный вход: сессия видна в «Устройствах»
  api.post(
    '/oauth/web/exchange',
    handle((req) => {
      rateLimit(req, 'oauth');
      const code = str(req.body.code);
      const entry = webCodes.get(code);
      webCodes.delete(code);
      if (!entry || entry.expires < Date.now()) throw new HttpError(400, 'Вход устарел. Попробуйте ещё раз');
      if (entry.ticket) return { ticket: entry.ticket };
      return enter(req, users.byId(entry.userId));
    })
  );

  api.get(
    '/oauth/:provider/url',
    handle((req) => {
      const state = str(req.query.state);
      const challenge = str(req.query.challenge);
      if (!PKCE_RE.test(state) || !PKCE_RE.test(challenge)) throw new HttpError(400, 'Неверные параметры входа');
      return { url: buildAuthUrl(req.params.provider, state, challenge) };
    })
  );

  // mode: 'login' — войти или создать профиль, 'link' — привязать сервис к текущему профилю
  api.post(
    '/oauth/:provider',
    handle(async (req) => {
      rateLimit(req, 'oauth');
      const provider = req.params.provider;
      const { code, codeVerifier, mode } = req.body;
      if (typeof code !== 'string' || !code || !PKCE_RE.test(str(codeVerifier)))
        throw new HttpError(400, 'Неверные параметры входа');

      const linkingUser = mode === 'link' ? sessionFromRequest(req)?.user : null;
      if (mode === 'link' && !linkingUser) throw new HttpError(401, 'Нужно войти заново');

      const profile = await fetchProfile(provider, { code, codeVerifier });
      const existing = identities.find(provider, profile.providerId);

      if (linkingUser) {
        if (existing && existing.user_id !== linkingUser.id)
          throw new HttpError(409, 'Этот аккаунт уже привязан к другому профилю');
        if (!existing) {
          identities.remove(linkingUser.id, provider);
          identities.add(provider, profile.providerId, linkingUser.id, profile.email);
        }
        return toSelf(linkingUser);
      }

      if (existing) {
        const user = users.byId(existing.user_id);
        return enter(req, user);
      }

      // Профиля ещё нет. Без кода приглашения выдаём пропуск: код можно ввести, не входя в сервис заново
      if (config.inviteCode && str(req.body.inviteCode) !== config.inviteCode) {
        const err = new HttpError(403, 'Аккаунт подтверждён. Введите код приглашения, чтобы создать профиль');
        err.extra = { needInvite: true, ticket: signTicket({ provider, ...profile }) };
        throw err;
      }
      return createOAuthUser(req, provider, profile);
    })
  );

  // Завершение регистрации через сервис: пропуск из предыдущего шага + код приглашения
  api.post(
    '/signup/complete',
    handle((req) => {
      rateLimit(req, 'oauth');
      checkInvite(req.body.inviteCode);
      const ticket = verifyTicket(req.body.ticket);
      if (!ticket) throw new HttpError(400, 'Время на регистрацию истекло. Войдите через сервис ещё раз');
      const existing = identities.find(ticket.provider, ticket.providerId);
      if (existing) {
        const user = users.byId(existing.user_id);
        return enter(req, user);
      }
      return createOAuthUser(req, ticket.provider, ticket);
    })
  );

  api.use(requireAuth);

  // Предпросмотр ссылки для поля ввода: заголовок, описание, картинка. null — превью нет
  api.get(
    '/link-preview',
    handle(async (req) => {
      const url = previewableUrl(req.query.url);
      if (!url) throw new HttpError(400, 'Неверная ссылка');
      return (await fetchPreview(url)) ?? null;
    })
  );

  // Загрузка вложения: тело запроса — сам файл, имя — в адресе (?name=), тип — в Content-Type
  api.post(
    '/uploads',
    handle(async (req, res) => {
      userLimit(req, 'upload', config.uploadRateLimit, 60_000, 'Слишком много файлов подряд, подождите минуту');
      const tooBig = new HttpError(413, `Файл больше ${MAX_FILE_BYTES / 1024 / 1024} МБ`);
      const declared = Number(req.get('content-length')) || 0;
      const left = config.storageQuotaBytes - uploads.usedBy(req.user.id);
      res.set('Connection', 'close'); // отказали на середине — остаток не читаем
      if (declared > MAX_FILE_BYTES) return refuseUpload(req, tooBig);
      if (declared > left) return refuseUpload(req, new HttpError(413, 'Закончилось место для ваших файлов. Удалите старые сообщения с вложениями'));

      // Файл идёт сразу на диск: целиком в памяти несколько загрузок съели бы память сервера
      const id = crypto.randomBytes(16).toString('hex');
      const file = path.join(FILES_DIR, id);
      let size = 0;
      const meter = new Transform({
        transform(chunk, _encoding, done) {
          size += chunk.length;
          done(size > Math.min(MAX_FILE_BYTES, left) ? tooBig : null, chunk);
        },
      });
      try {
        await pipeline(req, meter, fs.createWriteStream(file));
      } catch (err) {
        fs.rm(file, { force: true }, () => {});
        throw err.status ? err : new HttpError(400, 'Файл не загрузился');
      }
      if (!size) {
        fs.rm(file, { force: true }, () => {});
        throw new HttpError(400, 'Пустой файл');
      }
      res.removeHeader('Connection');
      const mime = cleanMime(req.get('content-type'));
      const row = { id, ownerId: req.user.id, name: cleanName(req.query.name), mime, size, kind: kindOf(mime) };
      uploads.add(row);
      return toAttachment(row);
    })
  );

  api.get('/me', handle((req) => toSelf(req.user)));

  // ---------- Устройства ----------

  api.get(
    '/sessions',
    handle((req) =>
      sessions.of(req.user.id).map((s) => ({ id: s.id, device: s.device, createdAt: s.created_at, lastSeen: s.last_seen, current: s.id === req.sid }))
    )
  );

  api.delete(
    '/sessions/:id',
    handle((req) => {
      if (sessions.byId(req.params.id)?.user_id !== req.user.id) throw new HttpError(404, 'Устройство не найдено');
      closeSession(req.user.id, req.params.id);
      return { ok: true };
    })
  );

  // Выйти на всех остальных устройствах. Токен старой версии тоже отключается — такому приложению выдаём новый
  api.post(
    '/sessions/revoke-others',
    handle((req) => {
      closeOtherSessions(req.user.id, req.sid);
      return req.sid ? { ok: true } : { ok: true, token: openSession(req.user.id, req.get('user-agent')) };
    })
  );

  // ---------- Двухфакторный вход ----------

  async function requirePassword(req) {
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (req.user.password_hash && !(await verifyPassword(password, req.user.password_hash))) throw new HttpError(400, 'Пароль указан неверно');
  }

  // Секрет для приложения-аутентификатора. Заработает, когда человек подтвердит его кодом
  api.post(
    '/me/2fa/setup',
    handle(async (req) => {
      if (req.user.totp_secret) throw new HttpError(409, 'Двухфакторный вход уже включён');
      await requirePassword(req);
      const secret = newSecret();
      users.setTotpPending(req.user.id, secret);
      return { secret, uri: otpauthUri(secret, req.user.username) };
    })
  );

  api.post(
    '/me/2fa/enable',
    handle((req) => {
      const secret = req.user.totp_pending;
      const step = secret ? matchCode(secret, str(req.body.code), 0) : null;
      if (step === null) throw new HttpError(400, 'Неверный код. Проверьте время на телефоне и попробуйте ещё раз');
      const { codes, hashes } = newRecoveryCodes();
      users.enableTotp(req.user.id, step, hashes);
      closeOtherSessions(req.user.id, req.sid); // с этого момента вход только с кодом
      return { recoveryCodes: codes, user: toSelf(users.byId(req.user.id)) };
    })
  );

  api.post(
    '/me/2fa/disable',
    handle((req) => {
      if (!req.user.totp_secret) return toSelf(req.user);
      if (!passSecondFactor(req.user, str(req.body.code))) throw new HttpError(400, 'Неверный код');
      users.disableTotp(req.user.id);
      return toSelf(users.byId(req.user.id));
    })
  );

  // Билет на соединение WebSocket: токен не попадает в адрес
  api.post('/ws-ticket', handle((req) => ({ ticket: issueTicket({ user: req.user, sid: req.sid }) })));

  api.put(
    '/me/avatar',
    express.raw({ type: 'image/webp', limit: AVATAR_MAX_BYTES }),
    handle((req) => {
      if (!Buffer.isBuffer(req.body) || !isWebp(req.body)) throw new HttpError(400, 'Нужна картинка в формате WebP');
      const id = crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(path.join(AVATAR_DIR, `${id}.webp`), req.body);
      removeAvatarFile(req.user.avatar);
      users.updateAvatar(req.user.id, id);
      const row = users.byId(req.user.id);
      notifyProfile(row);
      return toSelf(row);
    })
  );

  api.delete(
    '/me/avatar',
    handle((req) => {
      removeAvatarFile(req.user.avatar);
      users.updateAvatar(req.user.id, null);
      const row = users.byId(req.user.id);
      notifyProfile(row);
      return toSelf(row);
    })
  );

  // Свой статус: активен, неактивен, не беспокоить, невидимый. Другие устройства узнают о нём сразу
  api.put(
    '/me/status',
    handle((req) => {
      const status = str(req.body.status);
      if (!STATUSES.includes(status)) throw new HttpError(400, 'Неизвестный статус');
      users.setStatus(req.user.id, status);
      hub.send(req.user.id, { type: 'me:status', status });
      broadcastPresence(req.user.id);
      return toSelf(users.byId(req.user.id));
    })
  );

  api.post(
    '/me/email/code',
    handle(async (req) => {
      rateLimit(req, 'code');
      requireMail();
      const email = normEmail(req.body.email);
      validateEmail(email);
      const owner = users.byEmail(email);
      if (owner && owner.id !== req.user.id) throw new HttpError(409, 'Эта почта уже привязана к другому профилю');
      await sendCode('link', email);
      return { ok: true };
    })
  );

  api.put(
    '/me/email',
    handle((req) => {
      rateLimit(req, 'code');
      const email = normEmail(req.body.email);
      validateEmail(email);
      const owner = users.byEmail(email);
      if (owner && owner.id !== req.user.id) throw new HttpError(409, 'Эта почта уже привязана к другому профилю');
      requireCode('link', email, req.body.code);
      users.setEmail(req.user.id, email, shownEmail(req.body.email));
      return toSelf(users.byId(req.user.id));
    })
  );

  // Отвязать почту можно, если останется другой способ войти: логин с паролем или Яндекс
  api.delete(
    '/me/email',
    handle((req) => {
      if (!req.user.password_hash && !identities.of(req.user.id).length)
        throw new HttpError(400, 'Сначала задайте пароль или привяжите Яндекс, иначе вы не сможете войти в профиль');
      users.setEmail(req.user.id, null);
      return toSelf(users.byId(req.user.id));
    })
  );

  api.delete(
    '/me/identities/:provider',
    handle((req) => {
      const linked = identities.of(req.user.id);
      if (!req.user.password_hash && linked.length <= 1)
        throw new HttpError(400, 'Сначала задайте пароль, иначе вы не сможете войти в профиль');
      identities.remove(req.user.id, req.params.provider);
      return toSelf(req.user);
    })
  );

  api.patch(
    '/me',
    handle(async (req) => {
      const { user } = req;
      const displayName = req.body.displayName === undefined ? user.display_name : str(req.body.displayName);
      const avatarColor = req.body.avatarColor === undefined ? user.avatar_color : str(req.body.avatarColor);
      validateDisplayName(displayName);
      if (!COLOR_RE.test(avatarColor)) throw new HttpError(400, 'Неверный цвет');
      const bio = req.body.bio === undefined ? user.bio || '' : str(req.body.bio);
      if (bio.length > MAX_BIO) throw new HttpError(400, `«О себе» — не длиннее ${MAX_BIO} символов`);
      const bannerColor = req.body.bannerColor === undefined ? user.banner_color : req.body.bannerColor && str(req.body.bannerColor).toLowerCase();
      if (bannerColor && !COLOR_RE.test(bannerColor)) throw new HttpError(400, 'Неверный цвет баннера');
      const nameColor = req.body.nameColor === undefined ? user.name_color : req.body.nameColor && str(req.body.nameColor).toLowerCase();
      if (nameColor && !COLOR_RE.test(nameColor)) throw new HttpError(400, 'Неверный цвет ника');

      let newToken;
      if (req.body.newPassword) {
        // Если пароля ещё нет (профиль создан через Яндекс), задаём его без проверки текущего
        if (
          user.password_hash &&
          (typeof req.body.currentPassword !== 'string' || !(await verifyPassword(req.body.currentPassword, user.password_hash)))
        )
          throw new HttpError(400, 'Текущий пароль указан неверно');
        validatePassword(req.body.newPassword);
        users.updatePassword(user.id, await hashPassword(req.body.newPassword));
        // Пароль могли менять после кражи: отключаем остальные устройства, это остаётся в сети
        closeOtherSessions(user.id, req.sid);
        if (!req.sid) newToken = openSession(user.id, req.get('user-agent'));
      }

      users.updateProfile(user.id, { displayName, avatarColor, bio, bannerColor: bannerColor || null, nameColor: nameColor || null });
      const row = users.byId(user.id);
      notifyProfile(row);
      return { ...toSelf(row), ...(newToken && { token: newToken }) };
    })
  );

  api.get('/contacts', handle((req) => contacts.list(req.user.id).map((row) => ({ ...withOnline(row), chatTheme: row.chat_theme || null }))));

  // Тема личного чата «у обоих»: ставит любой из двоих друзей, оба видят сразу. null — по умолчанию
  api.put(
    '/contacts/:id/theme',
    handle((req) => {
      const other = Number(req.params.id);
      if (!contacts.has(req.user.id, other)) throw new HttpError(404, 'Этого человека нет в друзьях');
      const theme = req.body.theme ?? null;
      if (theme !== null && !/^[a-z-]{1,24}$/.test(theme)) throw new HttpError(400, 'Неизвестная тема');
      contacts.setTheme(req.user.id, other, theme);
      hub.send(other, { type: 'chat:theme', userId: req.user.id, theme, by: req.user.id });
      hub.send(req.user.id, { type: 'chat:theme', userId: other, theme, by: req.user.id });
      return { ok: true, theme };
    })
  );

  const toRequest = (row) => ({ ...toPublicUser(row), requestedAt: row.requested_at });

  // Добавить в друзья — значит отправить заявку. Если он уже звал вас, вы сразу друзья
  api.post(
    '/contacts',
    handle((req) => {
      const other = users.byUsername(str(req.body.username).toLowerCase());
      if (!other) throw new HttpError(404, 'Пользователь с таким логином не найден');
      if (other.id === req.user.id) throw new HttpError(400, 'Нельзя добавить самого себя');
      if (blocks.has(req.user.id, other.id)) throw new HttpError(403, 'Вы заблокировали этого человека — сначала разблокируйте');
      if (blocks.has(other.id, req.user.id)) throw new HttpError(403, 'Этому человеку нельзя отправить заявку');
      if (contacts.has(req.user.id, other.id)) throw new HttpError(409, 'Вы уже друзья');
      if (friendRequests.has(other.id, req.user.id)) return acceptFriend(req.user, other);
      if (friendRequests.has(req.user.id, other.id)) throw new HttpError(409, 'Заявка уже отправлена — ждём ответа');
      friendRequests.add(req.user.id, other.id);
      hub.send(other.id, { type: 'friend:request', user: toRequest({ ...req.user, requested_at: Date.now() }) });
      return { ...toPublicUser(other), friendship: 'pending' };
    })
  );

  function acceptFriend(me, other) {
    contacts.add(me.id, other.id);
    hub.send(other.id, { type: 'contact:added', user: withOnline(me) });
    hub.send(me.id, { type: 'contact:added', user: withOnline(other), accepted: true });
    return { ...withOnline(other), friendship: 'friends' };
  }

  api.get(
    '/friend-requests',
    handle((req) => ({
      incoming: friendRequests.incoming(req.user.id).map(toRequest),
      outgoing: friendRequests.outgoing(req.user.id).map(toRequest),
    }))
  );

  api.post(
    '/friend-requests/:userId/accept',
    handle((req) => {
      const other = users.byId(Number(req.params.userId));
      if (!other || !friendRequests.has(other.id, req.user.id)) throw new HttpError(404, 'Заявка не найдена');
      return acceptFriend(req.user, other);
    })
  );

  // Отклонить входящую или отменить свою — заявка пропадает у обоих
  api.delete(
    '/friend-requests/:userId',
    handle((req) => {
      const otherId = Number(req.params.userId);
      friendRequests.remove(otherId, req.user.id);
      friendRequests.remove(req.user.id, otherId);
      hub.send(otherId, { type: 'friend:request:removed', userId: req.user.id });
      return { ok: true };
    })
  );

  api.get('/blocks', handle((req) => blocks.of(req.user.id).map((row) => ({ ...toPublicUser(row), blockedAt: row.blocked_at }))));

  api.post(
    '/blocks',
    handle((req) => {
      const other = users.byId(Number(req.body.userId));
      if (!other) throw new HttpError(404, 'Пользователь не найден');
      if (other.id === req.user.id) throw new HttpError(400, 'Себя заблокировать нельзя');
      const wasFriend = contacts.has(req.user.id, other.id);
      const hadRequest = friendRequests.has(other.id, req.user.id) || friendRequests.has(req.user.id, other.id);
      blocks.add(req.user.id, other.id);
      if (wasFriend) hub.send(other.id, { type: 'contact:removed', userId: req.user.id });
      if (hadRequest) hub.send(other.id, { type: 'friend:request:removed', userId: req.user.id });
      return { ...toPublicUser(other), blockedAt: Date.now() };
    })
  );

  api.delete(
    '/blocks/:userId',
    handle((req) => {
      blocks.remove(req.user.id, Number(req.params.userId));
      return { ok: true };
    })
  );

  api.delete(
    '/contacts/:id',
    handle((req) => {
      const other = requireContact(req);
      contacts.remove(req.user.id, other.id);
      hub.send(other.id, { type: 'contact:removed', userId: req.user.id });
      return { ok: true };
    })
  );

  api.get(
    '/messages/:id',
    handle((req) => {
      const other = requireContact(req);
      const before = Number(req.query.before) || undefined;
      return withMessageMeta(messages.between(req.user.id, other.id, before).map(toMessage), 'dm', other.id, req.user.id);
    })
  );

  api.post(
    '/messages/:id',
    handle(async (req) => {
      const other = requireContact(req);
      const { text, ...extra } = await messageFrom(req, dmConv(req.user.id, other.id));
      const me = req.user.id;
      const replyTo = replyTarget(req.body.replyToId, messages, (r) =>
        (r.from_id === me && r.to_id === other.id) || (r.from_id === other.id && r.to_id === me)
      );
      const message = withMessageMeta(
        [toMessage(messages.add(me, other.id, text, { ...extra, replyTo }))],
        'dm',
        other.id,
        me
      )[0];
      hub.send(other.id, { type: 'message', message });
      hub.send(me, { type: 'message', message });
      return message;
    })
  );

  // Удалить своё сообщение из переписки с :peerId. Дружба для этого не нужна — своё удалить можно и после неё
  api.delete(
    '/messages/:peerId/:id',
    handle((req) => {
      const peerId = Number(req.params.peerId);
      const row = messages.byId(Number(req.params.id));
      const me = req.user.id;
      const inThisChat = row && ((row.from_id === me && row.to_id === peerId) || (row.from_id === peerId && row.to_id === me));
      if (!inThisChat) throw new HttpError(404, 'Сообщение не найдено');
      if (row.from_id !== me) throw new HttpError(403, 'Удалить можно только своё сообщение');
      messages.remove(row.id);
      removeAttachments(row);
      const event = { type: 'message:deleted', id: row.id, fromId: row.from_id, toId: row.to_id };
      hub.send(peerId, event);
      hub.send(me, event);
      return { ok: true };
    })
  );

  // Правка своего сообщения: приходит новый зашифрованный конверт, открытого текста сервер не видит
  api.patch(
    '/messages/:peerId/:id',
    handle((req) => {
      const peerId = Number(req.params.peerId);
      const me = req.user.id;
      const row = messages.byId(Number(req.params.id));
      const inChat = row && ((row.from_id === me && row.to_id === peerId) || (row.from_id === peerId && row.to_id === me));
      if (!inChat) throw new HttpError(404, 'Сообщение не найдено');
      if (row.from_id !== me) throw new HttpError(403, 'Изменить можно только своё сообщение');
      const enc = req.body.enc == null ? null : parseEnvelope(req.body.enc);
      if (!enc) throw new HttpError(400, 'Неверный зашифрованный конверт');
      if (enc.epoch > convKeys.epoch(dmConv(me, peerId))) throw new HttpError(400, 'Такой версии ключа у переписки нет');
      const message = withMessageMeta([toMessage(messages.setEnc(row.id, enc))], 'dm', peerId, me)[0];
      const event = { type: 'message:edited', message };
      hub.send(peerId, event);
      hub.send(me, event);
      return message;
    })
  );

  // Реакция: ставим и снимаем один и тот же смайлик
  api.post(
    '/messages/:peerId/:id/reactions',
    handle((req) => {
      const peerId = Number(req.params.peerId);
      const me = req.user.id;
      const row = messages.byId(Number(req.params.id));
      const inChat = row && ((row.from_id === me && row.to_id === peerId) || (row.from_id === peerId && row.to_id === me));
      if (!inChat) throw new HttpError(404, 'Сообщение не найдено');
      reactions.toggle('dm', row.id, me, takeEmoji(req.body.emoji));
      const list = reactions.of('dm', row.id, me);
      const event = { type: 'message:reactions', id: row.id };
      hub.send(peerId, { ...event, peerId: me, reactions: reactions.of('dm', row.id, peerId) });
      hub.send(me, { ...event, peerId, reactions: list });
      return list;
    })
  );

  // ---------- Что прочитано ----------

  api.get('/unread', handle((req) => readState.unread(req.user.id)));

  // Прочитал переписку до конца. Остальные устройства человека снимают отметку
  api.post(
    '/read',
    handle((req) => {
      const [, kind, id] = /^(dm|room):(\d+)$/.exec(str(req.body.conv)) || [];
      if (!kind) throw new HttpError(400, 'Неверная переписка');
      if (kind === 'room' && !rooms.isMember(Number(id), req.user.id)) throw new HttpError(404, 'Комната не найдена');
      if (kind === 'dm') readState.readDm(req.user.id, Number(id));
      else readState.readRoom(req.user.id, Number(id));
      hub.send(req.user.id, { type: 'read', conv: req.body.conv });
      return { ok: true };
    })
  );

  // Закреплённые сообщения переписки
  api.get(
    '/messages/:peerId/pins',
    handle((req) => {
      const peerId = Number(req.params.peerId);
      const me = req.user.id;
      // Закреп записан на собеседника того, кто закрепил, — в этой переписке это может быть любой из двоих
      const list = [...pins.of('dm', peerId), ...pins.of('dm', me)]
        .map((id) => messages.byId(id))
        .filter((row) => row && ((row.from_id === me && row.to_id === peerId) || (row.from_id === peerId && row.to_id === me)))
        .map(toMessage);
      return withMessageMeta(list, 'dm', peerId, me);
    })
  );

  api.put(
    '/messages/:peerId/:id/pin',
    handle((req) => {
      const peerId = Number(req.params.peerId);
      const me = req.user.id;
      const row = messages.byId(Number(req.params.id));
      const inChat = row && ((row.from_id === me && row.to_id === peerId) || (row.from_id === peerId && row.to_id === me));
      if (!inChat) throw new HttpError(404, 'Сообщение не найдено');
      pins.add('dm', peerId, row.id, me);
      const event = { type: 'message:pinned', id: row.id, pinned: true };
      hub.send(peerId, { ...event, peerId: me });
      hub.send(me, { ...event, peerId });
      return { ok: true };
    })
  );

  api.delete(
    '/messages/:peerId/:id/pin',
    handle((req) => {
      const peerId = Number(req.params.peerId);
      const me = req.user.id;
      const row = messages.byId(Number(req.params.id));
      if (!row) throw new HttpError(404, 'Сообщение не найдено');
      pins.remove('dm', row.id);
      const event = { type: 'message:pinned', id: row.id, pinned: false };
      hub.send(peerId, { ...event, peerId: me });
      hub.send(me, { ...event, peerId });
      return { ok: true };
    })
  );

  // ---------- Сквозное шифрование ----------

  // Свой публичный ключ. Сменили — старые копии ключей переписок (запечатанные старым ключом) удаляем,
  // а друзья и соседи по комнатам узнают новый и запечатают ключи заново
  api.put(
    '/me/key',
    handle((req) => {
      if (!isPublicKey(req.body.publicKey)) throw new HttpError(400, 'Неверный публичный ключ');
      if (req.user.public_key !== req.body.publicKey) {
        setPublicKey(req.user.id, req.body.publicKey);
        if (req.user.public_key) convKeys.dropUser(req.user.id);
        const row = users.byId(req.user.id);
        notifyProfile(row);
      }
      return toSelf(users.byId(req.user.id));
    })
  );

  /** Переписка и её участники; не участник — для него её нет */
  function requireConv(req) {
    const members = convMembers(req.params.conv);
    if (!members || !members.includes(req.user.id)) throw new HttpError(404, 'Переписка не найдена');
    return { conv: req.params.conv, members };
  }

  // Мои копии ключа по версиям; у кого из участников (с публичным ключом) нет последней версии;
  // нужно ли сменить ключ — у последней версии есть копия у того, кто уже не участник
  api.get(
    '/keys/:conv',
    handle((req) => {
      const { conv, members } = requireConv(req);
      const epoch = convKeys.epoch(conv);
      const holders = new Set(epoch ? convKeys.holders(conv, epoch) : []);
      const withKey = members.filter((id) => users.byId(id)?.public_key);
      return {
        epoch,
        mine: convKeys.mine(conv, req.user.id),
        missing: epoch ? withKey.filter((id) => !holders.has(id)) : [],
        rotate: [...holders].some((id) => !members.includes(id)),
      };
    })
  );

  // Новая версия ключа (epoch = текущая + 1, с копией для себя) или копии существующей версии тем,
  // у кого их нет (делиться может только тот, у кого эта версия есть). Уже выданные копии не перезаписываем
  api.post(
    '/keys/:conv',
    handle((req) => {
      const { conv, members } = requireConv(req);
      const epoch = Number(req.body.epoch);
      const sealed = req.body.sealed && typeof req.body.sealed === 'object' ? req.body.sealed : {};
      const ids = Object.keys(sealed).map(Number);
      if (!ids.length || !ids.every((id) => members.includes(id)) || !Object.values(sealed).every(isSealed))
        throw new HttpError(400, 'Запечатать ключ можно только участникам переписки');
      const current = convKeys.epoch(conv);
      if (!Number.isInteger(epoch) || epoch < 1 || epoch > current + 1) throw new HttpError(409, 'Версия ключа устарела — обновите ключи');
      if (epoch === current + 1) {
        if (!ids.includes(req.user.id)) throw new HttpError(400, 'Новую версию ключа запечатайте и для себя');
      } else if (!convKeys.has(conv, epoch, req.user.id)) throw new HttpError(403, 'Поделиться можно только ключом, который есть у вас');
      try {
        convKeys.add(conv, epoch, sealed, req.user.id);
      } catch {
        throw new HttpError(409, 'Ключ уже обновили — обновите ключи');
      }
      for (const id of members) hub.send(id, { type: 'keys:updated', conv });
      return { ok: true, epoch };
    })
  );

  // Перенос ключа на новое устройство: старое кладёт ключ, зашифрованный кодом; id — хэш кода
  api.post(
    '/key-transfer',
    handle((req) => {
      const id = str(req.body.id);
      const blob = req.body.blob;
      if (!/^[a-f0-9]{64}$/.test(id) || typeof blob !== 'string' || !blob || blob.length > 16 * 1024)
        throw new HttpError(400, 'Неверные данные переноса');
      keyTransfers.put(id, req.user.id, blob);
      return { ok: true };
    })
  );

  api.get(
    '/key-transfer/:id',
    handle((req) => {
      const blob = /^[a-f0-9]{64}$/.test(req.params.id) && keyTransfers.take(req.params.id, req.user.id);
      if (!blob) throw new HttpError(404, 'Код не подошёл или устарел — создайте новый на старом устройстве');
      return { blob };
    })
  );

  // ---------- Комнаты ----------

  function requireRoom(req) {
    const room = rooms.byId(Number(req.params.id));
    if (!room || !rooms.isMember(room.id, req.user.id)) throw new HttpError(404, 'Комната не найдена');
    return room;
  }

  // Кто действует: его права и старшинство
  function actor(req, room) {
    const { isOwner, rank } = rooms.standing(room, req.user.id);
    return { isOwner, perms: rooms.permsOf(room, req.user.id), rank };
  }

  function requirePerm(req, room, perm, message) {
    const who = actor(req, room);
    if (!has(who.perms, perm)) {
      // Время окончания клиент показывает сам — в часовом поясе человека
      if (!who.isOwner && rooms.timeoutOf(room.id, req.user.id))
        throw new HttpError(403, 'Вас кикнули на время — пока можно только читать чат');
      throw new HttpError(403, message);
    }
    return who;
  }

  // Удалить комнату может её создатель и тот, кто управляет её каналом
  function requireRoomRemover(req, room) {
    const hubRow = room.hub_id && hubs.byId(room.hub_id);
    if (room.owner_id !== req.user.id && !(hubRow && hubs.rankOf(hubRow, req.user.id) >= 2))
      throw new HttpError(403, 'Удалить комнату может только её создатель или тот, кто управляет каналом');
  }

  // Над участником может действовать только тот, кто старше по роли
  function requireOutranks(who, room, userId) {
    if (who.rank <= rooms.standing(room, userId).rank)
      throw new HttpError(403, 'Нельзя: у этого участника такие же или более высокие права');
  }

  // Звать в комнату можно своих друзей и участников её канала. Друг, которого ещё нет в канале,
  // входит в неё только с этой комнатой — так зовут версии до 2.0
  function addMembers(req, room, ids) {
    const count = rooms.members(room.id).length;
    const fresh = [...new Set(ids.map(Number))].filter((id) => !rooms.isMember(room.id, id));
    for (const id of fresh) {
      if (!hubs.isMember(room.hub_id, id) && !contacts.has(req.user.id, id))
        throw new HttpError(400, 'Добавлять в комнату можно только своих друзей');
      if (rooms.isBanned(room.id, id)) throw new HttpError(400, `${users.byId(id).display_name} заблокирован в этой комнате`);
      if (hubs.isBanned(room.hub_id, id)) throw new HttpError(400, `${users.byId(id).display_name} заблокирован в этом канале`);
    }
    if (count + fresh.length > MAX_ROOM_MEMBERS)
      throw new HttpError(400, `В комнате может быть не больше ${MAX_ROOM_MEMBERS} человек`);
    const newcomers = fresh.filter((id) => !hubs.isMember(room.hub_id, id));
    for (const id of newcomers) hubs.addMemberOnly(room.hub_id, id);
    for (const id of fresh) rooms.addMember(room.id, id);
    if (newcomers.length) notifyHub(room.hub_id);
    return fresh;
  }

  function roleFields(req, allowAdmin) {
    const name = str(req.body.name);
    if (name.length < 1 || name.length > 24) throw new HttpError(400, 'Название роли — от 1 до 24 символов');
    const color = COLOR_RE.test(req.body.color) ? req.body.color : '#8b919c';
    const perms = cleanPerms(req.body.perms);
    if (perms & PERMS.admin && !allowAdmin) throw new HttpError(403, 'Право администратора раздаёт только создатель комнаты');
    return { name, color, perms };
  }

  // Права поменялись — кто потерял доступ к голосу, того отключаем
  function enforceVoice(room) {
    for (const p of voice.participants(room.id))
      if (!has(rooms.permsOf(room, p.userId), PERMS.connect)) voice.leave(room.id, p.userId, 'no-access');
  }

  api.get('/rooms', handle((req) => rooms.of(req.user.id).map(toRoom)));

  api.post(
    '/rooms',
    handle((req) => {
      const name = str(req.body.name);
      const kind = req.body.kind;
      validateRoomName(name);
      if (!ROOM_KINDS.includes(kind)) throw new HttpError(400, 'Тип комнаты: голосовая или текстовая');
      const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
      // Проверяем друзей до создания, чтобы не оставить пустую комнату при ошибке
      if (memberIds.some((id) => !contacts.has(req.user.id, Number(id))))
        throw new HttpError(400, 'Добавлять в комнату можно только своих друзей');
      // Версии до 2.0 не знают о каналах: их комната попадает в канал создателя и только к тем, кого позвали
      const legacy = req.body.hubId == null;
      const hubRow = legacy ? hubs.defaultFor(req.user) : requireHub(req, Number(req.body.hubId));
      if (!legacy) requireHubManager(req, hubRow);
      if (hubs.rooms(hubRow.id).length >= MAX_HUB_ROOMS)
        throw new HttpError(400, `В канале может быть не больше ${MAX_HUB_ROOMS} комнат`);
      const room = rooms.create(req.user.id, name, kind, hubRow.id, { everyone: !legacy });
      addMembers(req, room, memberIds);
      // Канал мог только что появиться — новые версии на других устройствах должны о нём узнать
      if (legacy) notifyHub(hubRow.id);
      return notifyRoom(room.id);
    })
  );

  // Название и права по умолчанию
  api.patch(
    '/rooms/:id',
    handle((req) => {
      const room = requireRoom(req);
      requirePerm(req, room, PERMS.manage, 'Нет права настраивать комнату');
      if ('name' in req.body) {
        const name = str(req.body.name);
        validateRoomName(name);
        rooms.rename(room.id, name);
      }
      if ('defaultPerms' in req.body) {
        rooms.setDefaultPerms(room.id, cleanPerms(req.body.defaultPerms) & ~PERMS.admin);
        enforceVoice(rooms.byId(room.id));
      }
      return notifyRoom(room.id);
    })
  );

  api.delete(
    '/rooms/:id',
    handle((req) => {
      const room = requireRoom(req);
      requireRoomRemover(req, room);
      const members = rooms.members(room.id);
      voice.closeRoom(room.id);
      removeAvatarFile(room.background);
      rooms.remove(room.id);
      for (const m of members) hub.send(m.id, { type: 'room:removed', roomId: room.id });
      return { ok: true };
    })
  );

  api.post(
    '/rooms/:id/members',
    handle((req) => {
      const room = requireRoom(req);
      requirePerm(req, room, PERMS.invite, 'Нет права приглашать в эту комнату');
      const ids = Array.isArray(req.body.userIds) ? req.body.userIds : [req.body.userId];
      addMembers(req, room, ids);
      return notifyRoom(room.id);
    })
  );

  function removeFromRoom(room, userId, reason) {
    if (voice.get(room.id, userId)) voice.leave(room.id, userId, reason);
    rooms.removeMember(room.id, userId);
    hub.send(userId, { type: 'room:removed', roomId: room.id, reason });
    notifyRoom(room.id);
  }

  // Выйти может каждый сам; выгнать — тот, у кого есть право и кто старше по роли
  api.delete(
    '/rooms/:id/members/:userId',
    handle((req) => {
      const room = requireRoom(req);
      const userId = Number(req.params.userId);
      if (userId === room.owner_id)
        throw new HttpError(400, 'Создатель не может выйти из своей комнаты — её можно только удалить');
      if (!rooms.isMember(room.id, userId)) throw new HttpError(404, 'Этого человека нет в комнате');
      if (userId !== req.user.id) requireOutranks(requirePerm(req, room, PERMS.kick, 'Нет права выгонять участников'), room, userId);
      removeFromRoom(room, userId, userId === req.user.id ? 'left' : 'kicked');
      return { ok: true };
    })
  );

  // Роль участника: roleId или null — права по умолчанию
  api.put(
    '/rooms/:id/members/:userId/role',
    handle((req) => {
      const room = requireRoom(req);
      const who = requirePerm(req, room, PERMS.manage, 'Нет права назначать роли');
      const userId = Number(req.params.userId);
      if (!rooms.isMember(room.id, userId)) throw new HttpError(404, 'Этого человека нет в комнате');
      if (userId === room.owner_id) throw new HttpError(400, 'Создатель комнаты и так может всё');
      if (userId !== req.user.id) requireOutranks(who, room, userId);
      const roleId = req.body.roleId == null ? null : Number(req.body.roleId);
      if (roleId !== null) {
        const role = roles.byId(roleId);
        if (!role || role.room_id !== room.id) throw new HttpError(404, 'Роль не найдена');
        if (role.perms & PERMS.admin && !who.isOwner) throw new HttpError(403, 'Назначать администраторов может только создатель комнаты');
      }
      rooms.setRole(room.id, userId, roleId);
      enforceVoice(room);
      return notifyRoom(room.id);
    })
  );

  api.post(
    '/rooms/:id/roles',
    handle((req) => {
      const room = requireRoom(req);
      const who = requirePerm(req, room, PERMS.manage, 'Нет права настраивать роли');
      if (roles.of(room.id).length >= MAX_ROLES) throw new HttpError(400, `В комнате может быть не больше ${MAX_ROLES} ролей`);
      roles.create(room.id, roleFields(req, who.isOwner));
      return notifyRoom(room.id);
    })
  );

  function requireRole(req, room, who) {
    const role = roles.byId(Number(req.params.roleId));
    if (!role || role.room_id !== room.id) throw new HttpError(404, 'Роль не найдена');
    if (role.perms & PERMS.admin && !who.isOwner) throw new HttpError(403, 'Роль администратора меняет только создатель комнаты');
    return role;
  }

  api.patch(
    '/rooms/:id/roles/:roleId',
    handle((req) => {
      const room = requireRoom(req);
      const who = requirePerm(req, room, PERMS.manage, 'Нет права настраивать роли');
      const role = requireRole(req, room, who);
      roles.update(role.id, roleFields(req, who.isOwner));
      enforceVoice(room);
      return notifyRoom(room.id);
    })
  );

  api.delete(
    '/rooms/:id/roles/:roleId',
    handle((req) => {
      const room = requireRoom(req);
      const who = requirePerm(req, room, PERMS.manage, 'Нет права настраивать роли');
      roles.remove(requireRole(req, room, who).id);
      enforceVoice(room);
      return notifyRoom(room.id);
    })
  );

  // Бан: человек пропадает из комнаты, и вернуть его нельзя, пока не разбанят
  api.post(
    '/rooms/:id/bans',
    handle((req) => {
      const room = requireRoom(req);
      const who = requirePerm(req, room, PERMS.ban, 'Нет права банить');
      const userId = Number(req.body.userId);
      if (userId === req.user.id) throw new HttpError(400, 'Себя забанить нельзя');
      if (!rooms.isMember(room.id, userId)) throw new HttpError(404, 'Этого человека нет в комнате');
      requireOutranks(who, room, userId);
      rooms.ban(room.id, userId, req.user.id);
      removeFromRoom(room, userId, 'banned');
      return toRoom(rooms.byId(room.id));
    })
  );

  api.delete(
    '/rooms/:id/bans/:userId',
    handle((req) => {
      const room = requireRoom(req);
      requirePerm(req, room, PERMS.ban, 'Нет права снимать бан');
      rooms.unban(room.id, Number(req.params.userId));
      return notifyRoom(room.id);
    })
  );

  // Кик на время: участник остаётся в комнате, но только читает чат; потом права роли возвращаются сами
  api.post(
    '/rooms/:id/timeouts',
    handle((req) => {
      const room = requireRoom(req);
      const who = requirePerm(req, room, PERMS.kick, 'Нет права кикать участников');
      const userId = Number(req.body.userId);
      const seconds = Number(req.body.seconds);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TIMEOUT_SECONDS)
        throw new HttpError(400, 'Кикнуть можно не больше чем на 4 недели');
      if (userId === req.user.id) throw new HttpError(400, 'Себя кикнуть нельзя');
      if (!rooms.isMember(room.id, userId)) throw new HttpError(404, 'Этого человека нет в комнате');
      requireOutranks(who, room, userId);
      rooms.setTimeout(room.id, userId, Date.now() + seconds * 1000);
      enforceVoice(room);
      return notifyRoom(room.id);
    })
  );

  api.delete(
    '/rooms/:id/timeouts/:userId',
    handle((req) => {
      const room = requireRoom(req);
      const who = requirePerm(req, room, PERMS.kick, 'Нет права снимать кик');
      const userId = Number(req.params.userId);
      if (!rooms.isMember(room.id, userId)) throw new HttpError(404, 'Этого человека нет в комнате');
      requireOutranks(who, room, userId);
      rooms.setTimeout(room.id, userId, null);
      return notifyRoom(room.id);
    })
  );

  // Отключить от голосового канала, не выгоняя из комнаты
  api.delete(
    '/rooms/:id/voice/:userId',
    handle((req) => {
      const room = requireRoom(req);
      const userId = Number(req.params.userId);
      if (userId !== req.user.id) requireOutranks(requirePerm(req, room, PERMS.kick, 'Нет права отключать участников'), room, userId);
      voice.leave(room.id, userId, 'disconnected');
      return { ok: true };
    })
  );

  api.get(
    '/rooms/:id/messages',
    handle((req) => {
      const room = requireRoom(req);
      const before = Number(req.query.before) || undefined;
      return withMessageMeta(roomMessages.list(room.id, before).map(toRoomMessage), 'room', room.id, req.user.id);
    })
  );

  api.post(
    '/rooms/:id/messages',
    handle(async (req) => {
      const room = requireRoom(req);
      requirePerm(req, room, PERMS.write, 'Вам нельзя писать в эту комнату');
      const { text, ...extra } = await messageFrom(req, roomConv(room.id));
      const replyTo = replyTarget(req.body.replyToId, roomMessages, (r) => r.room_id === room.id);
      const message = withMessageMeta(
        [toRoomMessage(roomMessages.add(room.id, req.user.id, text, { ...extra, replyTo }))],
        'room',
        room.id,
        req.user.id
      )[0];
      for (const m of rooms.members(room.id)) hub.send(m.id, { type: 'room:message', message });
      return message;
    })
  );

  // Правка своего сообщения в комнате: новый конверт, сервер текста не видит
  api.patch(
    '/rooms/:id/messages/:messageId',
    handle((req) => {
      const room = requireRoom(req);
      const row = roomMessages.byId(Number(req.params.messageId));
      if (!row || row.room_id !== room.id) throw new HttpError(404, 'Сообщение не найдено');
      if (row.from_id !== req.user.id) throw new HttpError(403, 'Изменить можно только своё сообщение');
      const enc = req.body.enc == null ? null : parseEnvelope(req.body.enc);
      if (!enc) throw new HttpError(400, 'Неверный зашифрованный конверт');
      if (enc.epoch > convKeys.epoch(roomConv(room.id))) throw new HttpError(400, 'Такой версии ключа у комнаты нет');
      const message = withMessageMeta([toRoomMessage(roomMessages.setEnc(row.id, enc))], 'room', room.id, req.user.id)[0];
      for (const m of rooms.members(room.id)) hub.send(m.id, { type: 'room:message:edited', message });
      return message;
    })
  );

  api.post(
    '/rooms/:id/messages/:messageId/reactions',
    handle((req) => {
      const room = requireRoom(req);
      const row = roomMessages.byId(Number(req.params.messageId));
      if (!row || row.room_id !== room.id) throw new HttpError(404, 'Сообщение не найдено');
      reactions.toggle('room', row.id, req.user.id, takeEmoji(req.body.emoji));
      const list = reactions.of('room', row.id, req.user.id);
      const event = { type: 'room:message:reactions', id: row.id, roomId: room.id, reactions: list };
      for (const m of rooms.members(room.id)) hub.send(m.id, event);
      return list;
    })
  );

  api.get(
    '/rooms/:id/pins',
    handle((req) => {
      const room = requireRoom(req);
      const list = pins
        .of('room', room.id)
        .map((id) => roomMessages.byId(id))
        .filter(Boolean)
        .map(toRoomMessage);
      return withMessageMeta(list, 'room', room.id, req.user.id);
    })
  );

  api.put(
    '/rooms/:id/messages/:messageId/pin',
    handle((req) => {
      const room = requireRoom(req);
      const row = roomMessages.byId(Number(req.params.messageId));
      if (!row || row.room_id !== room.id) throw new HttpError(404, 'Сообщение не найдено');
      pins.add('room', room.id, row.id, req.user.id);
      const event = { type: 'room:message:pinned', id: row.id, pinned: true, roomId: room.id };
      for (const m of rooms.members(room.id)) hub.send(m.id, event);
      return { ok: true };
    })
  );

  api.delete(
    '/rooms/:id/messages/:messageId/pin',
    handle((req) => {
      const room = requireRoom(req);
      const row = roomMessages.byId(Number(req.params.messageId));
      if (!row || row.room_id !== room.id) throw new HttpError(404, 'Сообщение не найдено');
      pins.remove('room', row.id);
      const event = { type: 'room:message:pinned', id: row.id, pinned: false, roomId: room.id };
      for (const m of rooms.members(room.id)) hub.send(m.id, event);
      return { ok: true };
    })
  );

  // Своё сообщение удаляет автор; чужое — тот, кто настраивает комнату и старше автора
  api.delete(
    '/rooms/:id/messages/:messageId',
    handle((req) => {
      const room = requireRoom(req);
      const row = roomMessages.byId(Number(req.params.messageId));
      if (!row || row.room_id !== room.id) throw new HttpError(404, 'Сообщение не найдено');
      if (row.from_id !== req.user.id)
        requireOutranks(requirePerm(req, room, PERMS.manage, 'Удалять чужие сообщения может только тот, кто настраивает комнату'), room, row.from_id);
      roomMessages.remove(row.id);
      removeAttachments(row);
      for (const m of rooms.members(room.id)) hub.send(m.id, { type: 'room:message:deleted', roomId: room.id, id: row.id });
      return { ok: true };
    })
  );

  // ---------- Каналы ----------

  function requireHub(req, id = Number(req.params.id)) {
    const hubRow = hubs.byId(id);
    if (!hubRow || !hubs.isMember(hubRow.id, req.user.id)) throw new HttpError(404, 'Канал не найден');
    return hubRow;
  }

  /** Создатель или управляющий; возвращает старшинство */
  function requireHubManager(req, hubRow) {
    const rank = hubs.rankOf(hubRow, req.user.id);
    if (rank < 2) throw new HttpError(403, 'Нет права управлять каналом');
    return rank;
  }

  function requireHubOutranks(req, hubRow, userId) {
    if (requireHubManager(req, hubRow) <= hubs.rankOf(hubRow, userId))
      throw new HttpError(403, 'Нельзя: у этого участника такие же или более высокие права');
  }

  function requireHubOwner(req, hubRow) {
    if (hubRow.owner_id !== req.user.id) throw new HttpError(403, 'Это может только создатель канала');
  }

  // Из канала — значит из всех его комнат: вышел сам (left), выгнали (kicked) или забанили (banned)
  function removeFromHub(hubRow, userId, reason) {
    for (const room of hubs.rooms(hubRow.id)) if (rooms.isMember(room.id, userId)) removeFromRoom(room, userId, 'hub');
    hubs.removeMember(hubRow.id, userId);
    hub.send(userId, { type: 'hub:removed', hubId: hubRow.id, reason });
    return notifyHub(hubRow.id);
  }

  api.get('/hubs', handle((req) => hubs.of(req.user.id).map(toHub)));

  // Создать канал: в нём сразу голосовая и текстовая комнаты, чтобы было куда зайти
  api.post(
    '/hubs',
    handle((req) => {
      const name = str(req.body.name);
      validateHubName(name);
      const iconColor = COLOR_RE.test(req.body.iconColor) ? req.body.iconColor : COLORS[crypto.randomInt(COLORS.length)];
      if (hubs.ownedCount(req.user.id) >= MAX_OWNED_HUBS)
        throw new HttpError(400, `Можно создать не больше ${MAX_OWNED_HUBS} каналов`);
      const hubRow = hubs.create(req.user.id, name, iconColor);
      rooms.create(req.user.id, 'Голосовая', 'voice', hubRow.id);
      rooms.create(req.user.id, 'Общий чат', 'text', hubRow.id);
      for (const room of hubs.rooms(hubRow.id)) notifyRoom(room.id);
      return notifyHub(hubRow.id);
    })
  );

  api.patch(
    '/hubs/:id',
    handle((req) => {
      const hubRow = requireHub(req);
      requireHubManager(req, hubRow);
      const name = 'name' in req.body ? str(req.body.name) : hubRow.name;
      validateHubName(name);
      const iconColor = 'iconColor' in req.body ? str(req.body.iconColor) : hubRow.icon_color;
      if (!COLOR_RE.test(iconColor)) throw new HttpError(400, 'Неверный цвет');
      hubs.update(hubRow.id, { name, iconColor });
      return notifyHub(hubRow.id);
    })
  );

  // Свой фон комнаты — WebP, который приложение заранее уменьшило; ставит и убирает тот, кто настраивает комнату
  api.put(
    '/rooms/:id/background',
    express.raw({ type: 'image/webp', limit: BACKGROUND_MAX_BYTES }),
    handle((req) => {
      const room = requireRoom(req);
      requirePerm(req, room, PERMS.manage, 'Нет права настраивать комнату');
      if (!Buffer.isBuffer(req.body) || !isWebp(req.body)) throw new HttpError(400, 'Нужна картинка в формате WebP');
      const id = crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(path.join(AVATAR_DIR, `${id}.webp`), req.body);
      removeAvatarFile(room.background);
      rooms.setBackground(room.id, id);
      return notifyRoom(room.id);
    })
  );

  api.delete(
    '/rooms/:id/background',
    handle((req) => {
      const room = requireRoom(req);
      requirePerm(req, room, PERMS.manage, 'Нет права настраивать комнату');
      removeAvatarFile(room.background);
      rooms.setBackground(room.id, null);
      return notifyRoom(room.id);
    })
  );

  // Картинка канала — как аватарка: приложение заранее обрезает её до квадрата WebP
  api.put(
    '/hubs/:id/icon',
    express.raw({ type: 'image/webp', limit: AVATAR_MAX_BYTES }),
    handle((req) => {
      const hubRow = requireHub(req);
      requireHubManager(req, hubRow);
      if (!Buffer.isBuffer(req.body) || !isWebp(req.body)) throw new HttpError(400, 'Нужна картинка в формате WebP');
      const id = crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(path.join(AVATAR_DIR, `${id}.webp`), req.body);
      removeAvatarFile(hubRow.icon);
      hubs.setIcon(hubRow.id, id);
      return notifyHub(hubRow.id);
    })
  );

  api.delete(
    '/hubs/:id/icon',
    handle((req) => {
      const hubRow = requireHub(req);
      requireHubManager(req, hubRow);
      removeAvatarFile(hubRow.icon);
      hubs.setIcon(hubRow.id, null);
      return notifyHub(hubRow.id);
    })
  );

  // Удалить канал может только создатель; комнаты пропадают вместе с ним
  api.delete(
    '/hubs/:id',
    handle((req) => {
      const hubRow = requireHub(req);
      requireHubOwner(req, hubRow);
      const members = hubs.members(hubRow.id);
      const hubRooms = hubs.rooms(hubRow.id).map((room) => ({ id: room.id, members: rooms.members(room.id) }));
      for (const room of hubRooms) voice.closeRoom(room.id);
      hubs.remove(hubRow.id);
      removeAvatarFile(hubRow.icon);
      for (const room of hubRooms) for (const m of room.members) hub.send(m.id, { type: 'room:removed', roomId: room.id });
      for (const m of members) hub.send(m.id, { type: 'hub:removed', hubId: hubRow.id, reason: 'deleted' });
      return { ok: true };
    })
  );

  // Пригласить друзей: вступят, когда сами примут приглашение
  api.post(
    '/hubs/:id/invites',
    handle((req) => {
      const hubRow = requireHub(req);
      requireHubManager(req, hubRow);
      const ids = [...new Set((Array.isArray(req.body.userIds) ? req.body.userIds : [req.body.userId]).map(Number))].filter(
        (id) => !hubs.isMember(hubRow.id, id)
      );
      for (const id of ids) {
        if (!contacts.has(req.user.id, id)) throw new HttpError(400, 'Звать в канал можно только своих друзей');
        if (hubs.isBanned(hubRow.id, id)) throw new HttpError(400, `${users.byId(id).display_name} заблокирован в этом канале`);
      }
      if (hubs.members(hubRow.id).length + ids.length > MAX_HUB_MEMBERS)
        throw new HttpError(400, `В канале может быть не больше ${MAX_HUB_MEMBERS} человек`);
      for (const id of ids) {
        hubs.addInvite(hubRow.id, id, req.user.id);
        hub.send(id, { type: 'hub:invite', invite: toHubInvite(hubs.invite(hubRow.id, id)) });
      }
      return notifyHub(hubRow.id);
    })
  );

  api.get('/hub-invites', handle((req) => hubs.invitesOf(req.user.id).map(toHubInvite)));

  // Принять приглашение: канал и все его комнаты, кроме тех, где забанен
  api.post(
    '/hub-invites/:hubId/accept',
    handle((req) => {
      const hubId = Number(req.params.hubId);
      if (!hubs.byId(hubId) || !hubs.invite(hubId, req.user.id) || hubs.isBanned(hubId, req.user.id))
        throw new HttpError(404, 'Приглашение не найдено');
      if (hubs.members(hubId).length >= MAX_HUB_MEMBERS)
        throw new HttpError(400, `В канале может быть не больше ${MAX_HUB_MEMBERS} человек`);
      for (const room of hubs.join(hubId, req.user.id)) notifyRoom(room.id);
      return notifyHub(hubId);
    })
  );

  api.delete(
    '/hub-invites/:hubId',
    handle((req) => {
      const hubId = Number(req.params.hubId);
      hubs.removeInvite(hubId, req.user.id);
      if (hubs.byId(hubId)) notifyHub(hubId);
      return { ok: true };
    })
  );

  // Выйти самому или выгнать (позвать снова можно); создатель не выходит — канал можно только удалить
  api.delete(
    '/hubs/:id/members/:userId',
    handle((req) => {
      const hubRow = requireHub(req);
      const userId = Number(req.params.userId);
      if (userId === req.user.id) {
        if (userId === hubRow.owner_id) throw new HttpError(400, 'Создатель не может выйти из канала — его можно только удалить');
        return removeFromHub(hubRow, userId, 'left');
      }
      requireHubOutranks(req, hubRow, userId);
      if (!hubs.isMember(hubRow.id, userId)) throw new HttpError(404, 'Этого человека нет в канале');
      return removeFromHub(hubRow, userId, 'kicked');
    })
  );

  // Право управлять каналом раздаёт только создатель
  api.put(
    '/hubs/:id/members/:userId/manager',
    handle((req) => {
      const hubRow = requireHub(req);
      requireHubOwner(req, hubRow);
      const userId = Number(req.params.userId);
      if (userId === hubRow.owner_id) throw new HttpError(400, 'Создатель канала и так может всё');
      if (!hubs.isMember(hubRow.id, userId)) throw new HttpError(404, 'Этого человека нет в канале');
      hubs.setManager(hubRow.id, userId, req.body.manager === true);
      for (const room of hubs.rooms(hubRow.id)) enforceVoice(room);
      return notifyHub(hubRow.id);
    })
  );

  // Бан: человек пропадает из канала и всех его комнат, позвать его нельзя, пока не снимут
  api.post(
    '/hubs/:id/bans',
    handle((req) => {
      const hubRow = requireHub(req);
      const userId = Number(req.body.userId);
      requireHubOutranks(req, hubRow, userId);
      if (!hubs.isMember(hubRow.id, userId)) throw new HttpError(404, 'Этого человека нет в канале');
      hubs.ban(hubRow.id, userId, req.user.id);
      return removeFromHub(hubRow, userId, 'banned');
    })
  );

  api.delete(
    '/hubs/:id/bans/:userId',
    handle((req) => {
      const hubRow = requireHub(req);
      requireHubManager(req, hubRow);
      hubs.unban(hubRow.id, Number(req.params.userId));
      return notifyHub(hubRow.id);
    })
  );

  // Временные логин/пароль для TURN-сервера (coturn, режим use-auth-secret)
  api.get(
    '/ice',
    handle((req) => {
      const iceServers = [];
      if (config.stunUrls.length) iceServers.push({ urls: config.stunUrls });
      if (config.turnUrls.length && config.turnSecret) {
        const expires = Math.floor(Date.now() / 1000) + 24 * 3600;
        const username = `${expires}:${req.user.id}`;
        const credential = crypto.createHmac('sha1', config.turnSecret).update(username).digest('base64');
        registerTurnUser(username, credential, expires * 1000);
        iceServers.push({ urls: config.turnUrls, username, credential });
      }
      return { iceServers };
    })
  );

  api.use((_req, _res, next) => next(new HttpError(404, 'Не найдено')));

  api.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error(err);
    const message =
      status === 500
        ? 'Внутренняя ошибка сервера'
        : err.type === 'entity.too.large'
          ? 'Слишком большой файл: можно до 25 МБ'
          : err.type === 'entity.parse.failed'
            ? 'Неверный формат запроса'
            : err.message;
    res.status(status).json({ error: message, ...(status < 500 && err.extra) });
  });

  return api;
}
