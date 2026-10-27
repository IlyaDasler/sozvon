import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth.js';
import { contacts, identities, messages, toMessage, toPublicUser, toSelf, users } from './db.js';
import { hub } from './hub.js';
import { buildAuthUrl, enabledProviders, fetchProfile } from './oauth.js';
import { registerTurnUser } from './turn.js';

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
  if (++entry.count > 10) throw new HttpError(429, 'Слишком много попыток, подождите минуту');
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of attempts) if (entry.reset < now) attempts.delete(ip);
}, 60_000).unref();

const withOnline = (row) => ({ ...toPublicUser(row), online: hub.isOnline(row.id) });

const PKCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

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

function notifyContacts(userId, message) {
  for (const c of contacts.list(userId)) hub.send(c.id, message);
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

      // Профиля ещё нет — создаём новый
      if (config.inviteCode && str(req.body.inviteCode) !== config.inviteCode)
        throw new HttpError(
          403,
          'Профиль не найден. Чтобы создать новый, откройте «Зарегистрироваться», введите код приглашения и нажмите кнопку ещё раз'
        );
      const username = makeUsername(profile.email, provider);
      const user = users.create({
        username,
        passwordHash: '',
        displayName: (profile.name || username).slice(0, 32),
        avatarColor: COLORS[crypto.randomInt(COLORS.length)],
      });
      identities.add(provider, profile.providerId, user.id, profile.email);
      return { token: signToken(user.id), user: toSelf(user), created: true };
    })
  );

  api.use(requireAuth);

  api.get('/me', handle((req) => toSelf(req.user)));

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
      notifyContacts(user.id, { type: 'user:updated', user: toPublicUser(row) });
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
    res.status(status).json({ error: status === 500 ? 'Внутренняя ошибка сервера' : err.message });
  });

  return api;
}
