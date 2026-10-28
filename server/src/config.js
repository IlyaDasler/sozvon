import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const list = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean);

const dataDir = path.resolve(process.env.DATA_DIR || path.join(here, '..', 'data'));
fs.mkdirSync(dataDir, { recursive: true });

// Секрет для подписи токенов: берём из окружения или генерируем один раз и храним рядом с базой
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

const publicIp = process.env.PUBLIC_IP || '';
const turnEmbedded = process.env.TURN_EMBEDDED === '1';
const turnPort = Number(process.env.TURN_PORT) || 3478;

export const config = {
  port: Number(process.env.PORT) || 3000,
  dataDir,
  secret: loadSecret(),
  publicIp,
  // Код приглашения: если задан, зарегистрироваться можно только с ним
  inviteCode: process.env.INVITE_CODE || '',
  // Почтовый ящик для писем с кодами (подтверждение почты при регистрации, сброс пароля).
  // Без него регистрация по почте работает без подтверждения
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },
  // Сколько попыток входа и регистрации в минуту разрешено с одного адреса
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT) || 10,
  stunUrls: list(
    process.env.STUN_URLS ?? (turnEmbedded && publicIp ? `stun:${publicIp}:${turnPort}` : 'stun:stun.l.google.com:19302')
  ),
  turnUrls: list(process.env.TURN_URLS ?? (turnEmbedded && publicIp ? `turn:${publicIp}:${turnPort}?transport=udp` : '')),
  turnSecret: process.env.TURN_SECRET || (turnEmbedded ? loadSecret() : ''),
  turnEmbedded,
  turnPort,
  turnMinPort: Number(process.env.TURN_MIN_PORT) || 49160,
  turnMaxPort: Number(process.env.TURN_MAX_PORT) || 49200,
  // Медиасервер LiveKit для больших комнат: url — для приложений (wss), apiUrl — для этого сервера
  livekit: {
    url: process.env.LIVEKIT_URL || '',
    apiUrl: process.env.LIVEKIT_API_URL || 'http://127.0.0.1:7880',
    key: process.env.LIVEKIT_API_KEY || '',
    secret: process.env.LIVEKIT_API_SECRET || '',
    // С какого числа участников комнаты голос идёт через LiveKit
    minMembers: Number(process.env.LIVEKIT_MIN_MEMBERS) || 5,
  },
  webDir: path.resolve(process.env.WEB_DIR || path.join(here, '..', '..', 'client', 'renderer')),
};
