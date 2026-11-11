// Сессия: токен, сервер, восстановление. Без DOM.
// Десктоп хранит сессию через app.js (store.set('session', ...)); формат тот же,
// поэтому мобильный слой и десктоп видят один и тот же вход.
import { Api } from '../api.mjs';
import { storage } from './storage.js';

const KEY = 'session';
const SERVER_KEY = 'server';

export const session = {
  // Сохранённая сессия или null. Не проверяет, что токен ещё действует.
  load() {
    const value = storage.read(KEY);
    if (!value?.token || !value?.base) return null;
    return value;
  },

  // Применяет сессию к клиенту API. Возвращает false, если сессии нет.
  apply(saved = this.load()) {
    if (!saved) return false;
    Api.base = saved.base;
    Api.token = saved.token;
    return true;
  },

  // Сохраняет вход. remember=false — сессия только до закрытия вкладки.
  save({ base, token, remember = true }) {
    storage.write(KEY, { base, token, remember });
    storage.write(SERVER_KEY, base);
    Api.base = base;
    Api.token = token;
  },

  clear() {
    storage.write(KEY, null);
    Api.token = '';
  },

  // Проверяет токен запросом /me. Возвращает профиль или null, если сессия мертва.
  // Сетевая ошибка пробрасывается: сессия при этом не сбрасывается.
  async verify() {
    try {
      return await Api.get('/me');
    } catch (err) {
      if (err.status === 401) this.clear();
      if (err.network) throw err;
      return null;
    }
  },
};
