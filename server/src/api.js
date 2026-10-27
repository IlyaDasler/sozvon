import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { hashPassword, signTicket, signToken, verifyPassword, verifyTicket, verifyToken } from './auth.js';
import {
  contacts,
  identities,
  messages,
  relatedUserIds,
  roomMessages,
  rooms,
  toMessage,
  toPublicUser,
  toRoomMessage,
  toSelf,
  users,
} from './db.js';
import { hub } from './hub.js';
import { buildAuthUrl, enabledProviders, fetchProfile } from './oauth.js';
import { registerTurnUser } from './turn.js';
import { voice } from './voice.js';

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128)
    throw new HttpError(400, 'Пароль должен быть от 6 до 128 символов');
}

function validateDisplayName(name) {
  if (name.length < 1 || name.length > 32) throw new HttpError(400, 'Имя должно быть от 1 до 32 символов');
}

// Простая защита от перебора паролей: не больше 10 попыток входа в минуту с одного адреса
const attempts = new Map();
function rateLimit(req) {
  const now = Date.now();
  const entry = attempts.get(req.ip);
  if (!entry || entry.reset < now) {
    attempts.set(req.ip, { count: 1, reset: now + 60_000 });
    return;
  }
  if (++entry.count > config.authRateLimit) throw new HttpError(429, 'Слишком много попыток, подождите минуту');
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of attempts) if (entry.reset < now) attempts.delete(ip);
}, 60_000).unref();

const withOnline = (row) => ({ ...toPublicUser(row), online: hub.isOnline(row.id) });

function createOAuthUser(provider, profile) {
  // Логин профиля — из почты, а если почту не дали (Яндекс без права на email) — из логина сервиса
  const username = makeUsername(profile.email || profile.login || '', provider);
  const user = users.create({
    username,
    passwordHash: '',
    displayName: (profile.name || username).slice(0, 32),
    avatarColor: COLORS[crypto.randomInt(COLORS.length)],
  });
  identities.add(provider, profile.providerId, user.id, profile.email || '');
  return { token: signToken(user.id), user: toSelf(user), created: true };
}

const PKCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

// Аватарки хранятся файлами рядом с базой; приложение заранее обрезает их до квадрата 256×256 в формате WebP
const AVATAR_DIR = path.join(config.dataDir, 'avatars');
const AVATAR_MAX_BYTES = 300 * 1024;
const AVATAR_FILE_RE = /^[a-f0-9]{32}\.webp$/;
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const isWebp = (buf) =>
  buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';

function removeAvatarFile(id) {
  if (id) fs.rm(path.join(AVATAR_DIR, `${id}.webp`), { force: true }, () => {});
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

const ROOM_KINDS = ['voice', 'text'];
const MAX_OWNED_ROOMS = 20;
const MAX_ROOM_MEMBERS = 30;

function validateRoomName(name) {
  if (name.length < 1 || name.length > 40) throw new HttpError(400, 'Название комнаты — от 1 до 40 символов');
}

const toRoom = (row) => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  ownerId: row.owner_id,
  createdAt: row.created_at,
  members: rooms.members(row.id).map(withOnline),
  voice: voice.participants(row.id),
});

// Свежие данные комнаты — всем её участникам
function notifyRoom(roomId) {
  const room = toRoom(rooms.byId(roomId));
  for (const m of room.members) hub.send(m.id, { type: 'room:updated', room });
  return room;
}

export function createApi() {
  const api = express.Router();
  api.use(express.json({ limit: '16kb' }));

  const handle = (fn) => async (req, res, next) => {
    try {
      const result = await fn(req, res);
      if (result !== undefined) res.json(result);
    } catch (err) {
      next(err);
    }
  };

  const userFromRequest = (req) =>
    users.byId(verifyToken((req.get('authorization') || '').replace(/^Bearer\s+/i, '')) ?? -1);

  function requireAuth(req, _res, next) {
    const user = userFromRequest(req);
    if (!user) return next(new HttpError(401, 'Нужно войти заново'));
    req.user = user;
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

  api.get('/health', (_req, res) => res.json({ ok: true, app: 'sozvon', inviteRequired: Boolean(config.inviteCode) }));

  api.post(
    '/register',
    handle((req) => {
      rateLimit(req);
      checkInvite(req.body.inviteCode);
      const username = str(req.body.username).toLowerCase();
      const displayName = str(req.body.displayName) || username;
      if (!USERNAME_RE.test(username))
        throw new HttpError(400, 'Логин: 3–24 символа, латинские буквы, цифры, точка или _');
      validatePassword(req.body.password);
      validateDisplayName(displayName);
      if (users.byUsername(username)) throw new HttpError(409, 'Этот логин уже занят');

      const user = users.create({
        username,
        passwordHash: hashPassword(req.body.password),
        displayName,
        avatarColor: COLORS[crypto.randomInt(COLORS.length)],
      });
      return { token: signToken(user.id), user: toSelf(user) };
    })
  );

  api.post(
    '/login',
    handle((req) => {
      rateLimit(req);
      const user = users.byUsername(str(req.body.username).toLowerCase());
      if (!user || typeof req.body.password !== 'string' || !verifyPassword(req.body.password, user.password_hash))
        throw new HttpError(401, 'Неверный логин или пароль');
      return { token: signToken(user.id), user: toSelf(user) };
    })
  );

  // ---------- Вход через Google / Яндекс / VK ----------

  // Картинки открываются без токена (тег img его не передаёт), но имя файла случайное и меняется при каждой загрузке
  api.get('/avatars/:file', (req, res, next) => {
    if (!AVATAR_FILE_RE.test(req.params.file)) return next(new HttpError(404, 'Не найдено'));
    res.sendFile(req.params.file, { root: AVATAR_DIR, maxAge: '365d', immutable: true }, (err) => {
      if (err && !res.headersSent) next(new HttpError(404, 'Не найдено'));
    });
  });

  api.get('/oauth/providers', (_req, res) => res.json(enabledProviders()));

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
      rateLimit(req);
      const provider = req.params.provider;
      const { code, codeVerifier, deviceId, state, mode } = req.body;
      if (typeof code !== 'string' || !code || !PKCE_RE.test(str(codeVerifier)))
        throw new HttpError(400, 'Неверные параметры входа');

      const linkingUser = mode === 'link' ? userFromRequest(req) : null;
      if (mode === 'link' && !linkingUser) throw new HttpError(401, 'Нужно войти заново');

      const profile = await fetchProfile(provider, {
        code,
        codeVerifier,
        deviceId: typeof deviceId === 'string' ? deviceId : undefined,
        state: str(state),
      });
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
        return { token: signToken(user.id), user: toSelf(user) };
      }

      // Профиля ещё нет. Без кода приглашения выдаём пропуск: код можно ввести, не входя в сервис заново
      if (config.inviteCode && str(req.body.inviteCode) !== config.inviteCode) {
        const err = new HttpError(403, 'Аккаунт подтверждён. Введите код приглашения, чтобы создать профиль');
        err.extra = { needInvite: true, ticket: signTicket({ provider, ...profile }) };
        throw err;
      }
      return createOAuthUser(provider, profile);
    })
  );

  // Завершение регистрации через сервис: пропуск из предыдущего шага + код приглашения
  api.post(
    '/signup/complete',
    handle((req) => {
      rateLimit(req);
      checkInvite(req.body.inviteCode);
      const ticket = verifyTicket(req.body.ticket);
      if (!ticket) throw new HttpError(400, 'Время на регистрацию истекло. Войдите через сервис ещё раз');
      const existing = identities.find(ticket.provider, ticket.providerId);
      if (existing) {
        const user = users.byId(existing.user_id);
        return { token: signToken(user.id), user: toSelf(user) };
      }
      return createOAuthUser(ticket.provider, ticket);
    })
  );

  api.use(requireAuth);

  api.get('/me', handle((req) => toSelf(req.user)));

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
      notifyRelated(row.id, { type: 'user:updated', user: toPublicUser(row) });
      return toSelf(row);
    })
  );

  api.delete(
    '/me/avatar',
    handle((req) => {
      removeAvatarFile(req.user.avatar);
      users.updateAvatar(req.user.id, null);
      const row = users.byId(req.user.id);
      notifyRelated(row.id, { type: 'user:updated', user: toPublicUser(row) });
      return toSelf(row);
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
    handle((req) => {
      const { user } = req;
      const displayName = req.body.displayName === undefined ? user.display_name : str(req.body.displayName);
      const avatarColor = req.body.avatarColor === undefined ? user.avatar_color : str(req.body.avatarColor);
      validateDisplayName(displayName);
      if (!COLOR_RE.test(avatarColor)) throw new HttpError(400, 'Неверный цвет');

      if (req.body.newPassword) {
        // Если пароля ещё нет (профиль через Google / Яндекс / VK), задаём его без проверки текущего
        if (
          user.password_hash &&
          (typeof req.body.currentPassword !== 'string' || !verifyPassword(req.body.currentPassword, user.password_hash))
        )
          throw new HttpError(400, 'Текущий пароль указан неверно');
        validatePassword(req.body.newPassword);
        users.updatePassword(user.id, hashPassword(req.body.newPassword));
      }

      users.updateProfile(user.id, displayName, avatarColor);
      const row = users.byId(user.id);
      notifyRelated(user.id, { type: 'user:updated', user: toPublicUser(row) });
      return toSelf(row);
    })
  );

  api.get('/contacts', handle((req) => contacts.list(req.user.id).map(withOnline)));

  api.post(
    '/contacts',
    handle((req) => {
      const other = users.byUsername(str(req.body.username).toLowerCase());
      if (!other) throw new HttpError(404, 'Пользователь с таким логином не найден');
      if (other.id === req.user.id) throw new HttpError(400, 'Нельзя добавить самого себя');
      contacts.add(req.user.id, other.id);
      hub.send(other.id, { type: 'contact:added', user: withOnline(req.user) });
      return withOnline(other);
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
      return messages.between(req.user.id, other.id, before).map(toMessage);
    })
  );

  api.post(
    '/messages/:id',
    handle((req) => {
      const other = requireContact(req);
      const text = str(req.body.text);
      if (!text || text.length > 2000) throw new HttpError(400, 'Сообщение должно быть от 1 до 2000 символов');
      const message = toMessage(messages.add(req.user.id, other.id, text));
      hub.send(other.id, { type: 'message', message });
      hub.send(req.user.id, { type: 'message', message });
      return message;
    })
  );

  // ---------- Комнаты ----------

  function requireRoom(req) {
    const room = rooms.byId(Number(req.params.id));
    if (!room || !rooms.isMember(room.id, req.user.id)) throw new HttpError(404, 'Комната не найдена');
    return room;
  }

  function requireOwner(req, room) {
    if (room.owner_id !== req.user.id) throw new HttpError(403, 'Это может только создатель комнаты');
  }

  // Добавлять в комнату можно только своих друзей
  function addMembers(req, room, ids) {
    const count = rooms.members(room.id).length;
    const fresh = [...new Set(ids.map(Number))].filter((id) => !rooms.isMember(room.id, id));
    for (const id of fresh) {
      if (!contacts.has(req.user.id, id)) throw new HttpError(400, 'Добавлять в комнату можно только своих друзей');
    }
    if (count + fresh.length > MAX_ROOM_MEMBERS)
      throw new HttpError(400, `В комнате может быть не больше ${MAX_ROOM_MEMBERS} человек`);
    for (const id of fresh) rooms.addMember(room.id, id);
    return fresh;
  }

  api.get('/rooms', handle((req) => rooms.of(req.user.id).map(toRoom)));

  api.post(
    '/rooms',
    handle((req) => {
      const name = str(req.body.name);
      const kind = req.body.kind;
      validateRoomName(name);
      if (!ROOM_KINDS.includes(kind)) throw new HttpError(400, 'Тип комнаты: голосовая или текстовая');
      if (rooms.ownedCount(req.user.id) >= MAX_OWNED_ROOMS)
        throw new HttpError(400, `Можно создать не больше ${MAX_OWNED_ROOMS} комнат`);
      const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
      // Проверяем друзей до создания, чтобы не оставить пустую комнату при ошибке
      if (memberIds.some((id) => !contacts.has(req.user.id, Number(id))))
        throw new HttpError(400, 'Добавлять в комнату можно только своих друзей');
      const room = rooms.create(req.user.id, name, kind);
      addMembers(req, room, memberIds);
      return notifyRoom(room.id);
    })
  );

  api.patch(
    '/rooms/:id',
    handle((req) => {
      const room = requireRoom(req);
      requireOwner(req, room);
      const name = str(req.body.name);
      validateRoomName(name);
      rooms.rename(room.id, name);
      return notifyRoom(room.id);
    })
  );

  api.delete(
    '/rooms/:id',
    handle((req) => {
      const room = requireRoom(req);
      requireOwner(req, room);
      const members = rooms.members(room.id);
      voice.closeRoom(room.id);
      rooms.remove(room.id);
      for (const m of members) hub.send(m.id, { type: 'room:removed', roomId: room.id });
      return { ok: true };
    })
  );

  api.post(
    '/rooms/:id/members',
    handle((req) => {
      const room = requireRoom(req);
      const ids = Array.isArray(req.body.userIds) ? req.body.userIds : [req.body.userId];
      addMembers(req, room, ids);
      return notifyRoom(room.id);
    })
  );

  // Создатель убирает любого участника, остальные могут выйти сами
  api.delete(
    '/rooms/:id/members/:userId',
    handle((req) => {
      const room = requireRoom(req);
      const userId = Number(req.params.userId);
      if (userId === room.owner_id)
        throw new HttpError(400, 'Создатель не может выйти из своей комнаты — её можно только удалить');
      if (userId !== req.user.id) requireOwner(req, room);
      if (!rooms.isMember(room.id, userId)) throw new HttpError(404, 'Этого человека нет в комнате');
      if (voice.get(room.id, userId)) voice.leave(room.id, userId, 'removed');
      rooms.removeMember(room.id, userId);
      hub.send(userId, { type: 'room:removed', roomId: room.id });
      notifyRoom(room.id);
      return { ok: true };
    })
  );

  api.get(
    '/rooms/:id/messages',
    handle((req) => {
      const room = requireRoom(req);
      const before = Number(req.query.before) || undefined;
      return roomMessages.list(room.id, before).map(toRoomMessage);
    })
  );

  api.post(
    '/rooms/:id/messages',
    handle((req) => {
      const room = requireRoom(req);
      const text = str(req.body.text);
      if (!text || text.length > 2000) throw new HttpError(400, 'Сообщение должно быть от 1 до 2000 символов');
      const message = toRoomMessage(roomMessages.add(room.id, req.user.id, text));
      for (const m of rooms.members(room.id)) hub.send(m.id, { type: 'room:message', message });
      return message;
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
          ? 'Слишком большой запрос'
          : err.type === 'entity.parse.failed'
            ? 'Неверный формат запроса'
            : err.message;
    res.status(status).json({ error: message, ...(status < 500 && err.extra) });
  });

  return api;
}
