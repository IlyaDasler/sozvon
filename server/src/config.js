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

export const config = {
  port: Number(process.env.PORT) || 3000,
  dataDir,
  secret: loadSecret(),
  stunUrls: list(process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302'),
  turnUrls: list(process.env.TURN_URLS),
  turnSecret: process.env.TURN_SECRET || '',
  webDir: path.resolve(process.env.WEB_DIR || path.join(here, '..', '..', 'client', 'renderer')),
};
