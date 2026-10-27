// Вход через Яндекс ID (OAuth 2.0 с PKCE).
// Приложение открывает страницу входа в браузере, получает код на http://localhost и передаёт его сюда,
// а сервер сам обменивает код на профиль — секреты приложений остаются только на сервере.

const PROVIDERS = {
  yandex: {
    name: 'Яндекс',
    clientId: process.env.YANDEX_CLIENT_ID,
    clientSecret: process.env.YANDEX_CLIENT_SECRET,
    needsSecret: true,
    authUrl: 'https://oauth.yandex.ru/authorize',
    tokenUrl: 'https://oauth.yandex.ru/token',
    userUrl: 'https://login.yandex.ru/info?format=json',
    // Без scope Яндекс выдаёт ровно те права, что отмечены в настройках приложения (почта — по желанию)
    scope: '',
    redirectUri: 'http://localhost:47615/callback',
    extra: { force_confirm: 'yes' },
  },
};

// В тестах все адреса провайдеров заменяются на поддельный сервер: OAUTH_TEST_BASE/<провайдер>/<путь>
function endpoint(id, url) {
  const base = process.env.OAUTH_TEST_BASE;
  if (!base) return url;
  const u = new URL(url);
  return `${base}/${id}${u.pathname}${u.search}`;
}

function oauthError(message) {
  const err = new Error(message);
  err.status = 502;
  return err;
}

function provider(id) {
  const p = Object.hasOwn(PROVIDERS, id) && PROVIDERS[id];
  if (!p || !p.clientId || (p.needsSecret && !p.clientSecret)) {
    const err = new Error('Этот способ входа не настроен на сервере');
    err.status = 404;
    throw err;
  }
  return p;
}

export const enabledProviders = () =>
  Object.entries(PROVIDERS)
    .filter(([, p]) => p.clientId && (!p.needsSecret || p.clientSecret))
    .map(([id, p]) => ({ id, name: p.name }));

export function buildAuthUrl(id, state, codeChallenge) {
  const p = provider(id);
  const url = new URL(endpoint(id, p.authUrl));
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    ...(p.scope && { scope: p.scope }),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...p.extra,
  }).toString();
  return url.toString();
}

async function request(url, options, what) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw oauthError(`Не удалось связаться с сервисом входа (${what})`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    console.warn(`OAuth ${what}: ${res.status}`, data.error, data.error_description);
    throw oauthError('Сервис входа отклонил запрос. Попробуйте ещё раз');
  }
  return data;
}

const form = (fields) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))),
});

/** Обменивает код на профиль: { providerId, email, login, name } */
export async function fetchProfile(id, { code, codeVerifier }) {
  const p = provider(id);
  const token = await request(
    endpoint(id, p.tokenUrl),
    form({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: p.clientId,
      client_secret: p.clientSecret,
    }),
    'yandex token'
  );
  const info = await request(endpoint(id, p.userUrl), { headers: { Authorization: `OAuth ${token.access_token}` } }, 'yandex user');
  return {
    providerId: String(info.id),
    email: info.default_email || '',
    login: info.login || '',
    name: info.display_name || info.real_name || info.login || '',
  };
}
