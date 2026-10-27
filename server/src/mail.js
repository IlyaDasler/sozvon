// Письма с кодами: подтверждение почты при регистрации и сброс пароля.
// Работает, только если в настройках сервера задан почтовый ящик (SMTP_HOST, SMTP_USER, SMTP_PASS).
// MAIL_TEST_FILE (для тестов) — вместо отправки дописывать письма в этот файл.
import crypto from 'node:crypto';
import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { config } from './config.js';

const CODE_TTL_MS = 15 * 60_000;
const RESEND_MS = 60_000;
const MAX_TRIES = 5;

const testFile = process.env.MAIL_TEST_FILE || '';
const smtp = config.smtp;
export const mailEnabled = Boolean(testFile || (smtp.host && smtp.user && smtp.pass));

const transport =
  mailEnabled && !testFile
    ? nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: { user: smtp.user, pass: smtp.pass },
      })
    : null;

// "purpose:email" -> { code, expires, sentAt, tries }
const codes = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, c] of codes) if (c.expires < now) codes.delete(key);
}, 60_000).unref();

const SUBJECTS = {
  register: 'Код для регистрации в Созвоне',
  reset: 'Код для смены пароля в Созвоне',
};

/** Отправляет шестизначный код. Повторно — не чаще раза в минуту */
export async function sendCode(purpose, email) {
  const key = `${purpose}:${email}`;
  const prev = codes.get(key);
  if (prev && Date.now() - prev.sentAt < RESEND_MS) {
    const err = new Error('Код уже отправлен. Повторно — через минуту');
    err.status = 429;
    throw err;
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const text = `${SUBJECTS[purpose]}: ${code}\n\nКод действует 15 минут. Если это были не вы, просто удалите письмо.`;
  if (testFile) {
    fs.appendFileSync(testFile, `${JSON.stringify({ to: email, purpose, code })}\n`);
  } else {
    try {
      await transport.sendMail({ from: `Созвон <${smtp.from}>`, to: email, subject: SUBJECTS[purpose], text });
    } catch (err) {
      console.warn('Письмо не отправлено:', err.message);
      const e = new Error('Не удалось отправить письмо. Проверьте адрес почты');
      e.status = 502;
      throw e;
    }
  }
  codes.set(key, { code, expires: Date.now() + CODE_TTL_MS, sentAt: Date.now(), tries: 0 });
}

/** Проверяет код; верный код одноразовый */
export function checkCode(purpose, email, code) {
  const key = `${purpose}:${email}`;
  const c = codes.get(key);
  if (!c || c.expires < Date.now()) return 'expired';
  if (++c.tries > MAX_TRIES) {
    codes.delete(key);
    return 'expired';
  }
  if (typeof code !== 'string' || code.trim() !== c.code) return 'wrong';
  codes.delete(key);
  return 'ok';
}
