// Вход и регистрация. Без DOM: только запросы и сохранение сессии.
import { Api } from '../api.mjs';
import { session } from './session.js';

// Тот же сервер, что и по умолчанию в app.js (DEFAULT_SERVER).
const DEFAULT_SERVER = 'https://135-106-226-12.sslip.io';

export const auth = {
  server: DEFAULT_SERVER,

  // Адрес сервера без завершающего слэша; пустая строка — адрес по умолчанию.
  setServer(url) {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    this.server = clean || DEFAULT_SERVER;
    return this.server;
  },

  // Провайдеры входа (Яндекс и т.п.). Ошибка сети не должна ронять экран входа.
  async providers() {
    try {
      const res = await fetch(`${this.server}/api/oauth/providers`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok ? await res.json() : [];
    } catch {
      return [];
    }
  },

  // Возвращает профиль. Двухфакторный вход: сервер отвечает needTotp,
  // тогда повторяем с кодом. Исключение пробрасывается вызывающему экрану.
  async login({ username, password, totp = '', remember = true }) {
    Api.base = this.server;
    Api.token = '';
    const result = await Api.post('/login', { username, password, totpCode: totp });
    session.save({ base: this.server, token: result.token, remember });
    return result.user ?? result;
  },

  // Регистрация по почте с кодом приглашения. Сервер может вернуть needCode,
  // если письмо с кодом отправлено не было.
  async register({ email, password, displayName, inviteCode = '', code = '', remember = true }) {
    Api.base = this.server;
    Api.token = '';
    const result = await Api.post('/register', { email, password, displayName, inviteCode, code });
    session.save({ base: this.server, token: result.token, remember });
    return result.user ?? result;
  },
};
