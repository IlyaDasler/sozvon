// Поддельные Google, Яндекс и VK ID для тестов. Сервер направляется сюда переменной OAUTH_TEST_BASE.
import http from 'node:http';

export const PROFILES = {
  google: { sub: 'g-1', email: 'ivan.petrov@gmail.com', email_verified: true, name: 'Иван Петров' },
  yandex: { id: 'y-1', default_email: 'ivan@yandex.ru', display_name: 'Ваня' },
  vk: { user: { user_id: '42', first_name: 'Мария', last_name: 'К', email: 'maria@vk.com' } },
};

const AUTH_PATHS = ['/o/oauth2/v2/auth', '/authorize'];
const TOKEN_PATHS = ['/token', '/oauth2/auth'];
const USER_PATHS = ['/v1/userinfo', '/info', '/oauth2/user_info'];

export function startMockOAuth(port = 0) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const [, provider, ...rest] = url.pathname.split('/');
    const path = `/${rest.join('/')}`;

    // Страница входа: сразу «подтверждает» вход и возвращает код на адрес приложения
    if (AUTH_PATHS.includes(path)) {
      if (url.searchParams.get('code_challenge_method') !== 'S256') return json(400, { error: 'pkce_required' });
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', `${provider}-code`);
      back.searchParams.set('state', url.searchParams.get('state'));
      if (provider === 'vk') back.searchParams.set('device_id', 'device-1');
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }

    if (TOKEN_PATHS.includes(path)) {
      if (form.get('code') !== `${provider}-code` || !form.get('code_verifier')) return json(400, { error: 'invalid_grant' });
      if (provider === 'vk' && form.get('device_id') !== 'device-1') return json(400, { error: 'invalid_request' });
      if (provider !== 'vk' && !form.get('client_secret')) return json(401, { error: 'invalid_client' });
      return json(200, { access_token: `${provider}-token`, user_id: 42 });
    }

    if (USER_PATHS.includes(path)) {
      const expected = {
        google: req.headers.authorization === 'Bearer google-token',
        yandex: req.headers.authorization === 'OAuth yandex-token',
        vk: form.get('access_token') === 'vk-token',
      }[provider];
      if (!expected) return json(401, { error: 'invalid_token' });
      return json(200, PROFILES[provider]);
    }

    json(404, { error: 'not_found' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

export const oauthEnv = (mockPort) => ({
  OAUTH_TEST_BASE: `http://127.0.0.1:${mockPort}`,
  GOOGLE_CLIENT_ID: 'google-id',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  YANDEX_CLIENT_ID: 'yandex-id',
  YANDEX_CLIENT_SECRET: 'yandex-secret',
  VK_CLIENT_ID: 'vk-id',
});
