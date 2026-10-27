// Принимает ответ сервиса входа (Яндекс) на http://localhost:<порт>/callback.
// Адрес берётся из параметра redirect_uri ссылки входа, которую выдал сервер.
const http = require('node:http');
const { BrowserWindow, shell } = require('electron');

const LOOPBACK = ['localhost', '127.0.0.1'];
const TIMEOUT_MS = 5 * 60_000;

const page = (ok) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Созвон</title></head>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#17181c;color:#e8eaed;font-family:'Segoe UI',sans-serif">
<div style="text-align:center"><h2>${ok ? 'Готово!' : 'Вход отменён'}</h2>
<p style="color:#9aa0a8">Можно закрыть эту вкладку и вернуться в «Созвон».</p></div>
<script>setTimeout(() => window.close(), 400)</script></body></html>`;

/**
 * Начинает ждать ответ. Возвращает { result, close }:
 * result — промис с параметрами из адреса возврата (code, state, device_id или error).
 */
async function listenForOAuth(authUrl) {
  const auth = new URL(authUrl);
  const redirect = new URL(auth.searchParams.get('redirect_uri') || 'invalid:');
  if (auth.protocol !== 'https:' && !LOOPBACK.includes(auth.hostname))
    throw new Error('Небезопасная ссылка входа');
  if (redirect.protocol !== 'http:' || !LOOPBACK.includes(redirect.hostname) || !redirect.port)
    throw new Error('Неверный адрес возврата');

  let resolve, reject;
  const result = new Promise((res, rej) => ((resolve = res), (reject = rej)));

  const servers = [];
  const close = () => servers.forEach((s) => s.close());
  const timer = setTimeout(() => reject(new Error('Время на вход истекло')), TIMEOUT_MS);
  result.finally(() => {
    clearTimeout(timer);
    close();
  }).catch(() => {});

  const onRequest = (req, res) => {
    const url = new URL(req.url, redirect.origin);
    if (url.pathname !== redirect.pathname) {
      res.writeHead(404).end();
      return;
    }
    const params = Object.fromEntries(url.searchParams);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }).end(page(!params.error));
    resolve(params);
  };

  // localhost может означать и 127.0.0.1, и ::1 — слушаем оба, но только на этом компьютере
  for (const host of ['127.0.0.1', '::1']) {
    const server = http.createServer(onRequest);
    try {
      await new Promise((res, rej) => {
        server.once('error', rej);
        server.listen(Number(redirect.port), host, res);
      });
      servers.push(server);
    } catch (err) {
      if (host === '127.0.0.1') {
        close();
        throw new Error(err.code === 'EADDRINUSE' ? `Порт ${redirect.port} занят другой программой` : err.message);
      }
    }
  }

  return { result, close: () => reject(new Error('Вход отменён')) };
}

// Яндекс открываем в окне приложения — после входа оно закрывается само
const IN_APP_OAUTH_HOSTS = ['oauth.yandex.ru', 'oauth.yandex.com'];

const opensInApp = (authUrl) => IN_APP_OAUTH_HOSTS.includes(new URL(authUrl).hostname);

/** Окно входа внутри приложения: закрывается само, как только сервис вернул ответ */
function openOAuthWindow(authUrl, pending, parent) {
  const auth = new BrowserWindow({
    parent,
    width: 520,
    height: 720,
    title: 'Вход через Яндекс',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    // Отдельный сохраняемый профиль: в следующий раз Яндекс уже помнит вход
    webPreferences: { partition: 'persist:oauth', sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  auth.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  auth.on('page-title-updated', (e) => e.preventDefault());
  // Закрыли окно, не войдя, — вход отменён (после успешного входа это ничего не меняет)
  auth.on('closed', () => pending.close());
  pending.result
    .finally(() => {
      if (!auth.isDestroyed()) auth.close();
    })
    .catch(() => {});
  auth.loadURL(authUrl);
}

module.exports = { listenForOAuth, openOAuthWindow, opensInApp };
