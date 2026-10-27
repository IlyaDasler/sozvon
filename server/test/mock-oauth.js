// Поддельный Яндекс ID для тестов. Сервер направляется сюда переменной OAUTH_TEST_BASE.
import http from 'node:http';

export const PROFILES = {
  yandex: { id: 'y-1', login: 'vanya.ivanov', default_email: 'ivan.petrov@yandex.ru', display_name: 'Иван Петров' },
};

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
    if (provider !== 'yandex') return json(404, { error: 'not_found' });

    // Страница входа: сразу «подтверждает» вход и возвращает код на адрес приложения
    if (path === '/authorize') {
      if (url.searchParams.get('code_challenge_method') !== 'S256') return json(400, { error: 'pkce_required' });
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'yandex-code');
      back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }

    if (path === '/token') {
      if (form.get('code') !== 'yandex-code' || !form.get('code_verifier')) return json(400, { error: 'invalid_grant' });
      if (!form.get('client_secret')) return json(401, { error: 'invalid_client' });
      return json(200, { access_token: 'yandex-token' });
    }

    if (path === '/info') {
      if (req.headers.authorization !== 'OAuth yandex-token') return json(401, { error: 'invalid_token' });
      return json(200, PROFILES.yandex);
    }

    json(404, { error: 'not_found' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

export const oauthEnv = (mockPort) => ({
  OAUTH_TEST_BASE: `http://127.0.0.1:${mockPort}`,
  YANDEX_CLIENT_ID: 'yandex-id',
  YANDEX_CLIENT_SECRET: 'yandex-secret',
});
