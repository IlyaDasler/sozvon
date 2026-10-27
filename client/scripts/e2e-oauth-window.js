// Окно входа внутри приложения (Яндекс, VK): после ответа сервиса закрывается само,
// а если его закрыть до входа — вход отменяется. Сервис входа поддельный, на этом же компьютере.
// Запуск: npx electron scripts/e2e-oauth-window.js
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const { listenForOAuth, openOAuthWindow, opensInApp } = require('../oauth-loopback');

const PROVIDER = 3301;
const CALLBACK = 3302;
const authUrl = (state) =>
  `http://127.0.0.1:${PROVIDER}/authorize?state=${state}&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${CALLBACK}/callback`)}`;

app.on('window-all-closed', () => {}); // не выходить, когда окно входа закрылось

app.whenReady().then(async () => {
  try {
    if (!opensInApp('https://oauth.yandex.ru/authorize?x=1') || opensInApp('https://accounts.google.com/o/oauth2/v2/auth'))
      throw new Error('Неверно выбрано, где открывать вход');
    console.log('✔ Яндекс и VK — в окне приложения, Google — в браузере');

    // Поддельный сервис: /authorize показывает кнопку «Войти», она ведёт на адрес возврата с кодом
    const provider = http
      .createServer((req, res) => {
        const url = new URL(req.url, `http://127.0.0.1:${PROVIDER}`);
        const back = `${url.searchParams.get('redirect_uri')}?code=abc&state=${url.searchParams.get('state')}`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<a id="login" href="${back}">Войти</a>`);
      })
      .listen(PROVIDER, '127.0.0.1');

    // 1. Человек вошёл — окно закрылось само, приложение получило код
    let pending = await listenForOAuth(authUrl('one'));
    openOAuthWindow(authUrl('one'), pending, null);
    const authWin = () => BrowserWindow.getAllWindows()[0];
    for (let i = 0; i < 50 && !(await authWin()?.webContents.executeJavaScript('Boolean(document.getElementById("login"))').catch(() => false)); i++)
      await new Promise((r) => setTimeout(r, 100));
    await authWin().webContents.executeJavaScript('document.getElementById("login").click()');
    const params = await pending.result;
    if (params.code !== 'abc' || params.state !== 'one') throw new Error('Не тот ответ: ' + JSON.stringify(params));
    await new Promise((r) => setTimeout(r, 500));
    if (BrowserWindow.getAllWindows().length) throw new Error('Окно входа не закрылось');
    console.log('✔ после входа окно закрывается само, код получен');

    // 2. Окно закрыли, не войдя, — вход отменён
    pending = await listenForOAuth(authUrl('two'));
    openOAuthWindow(authUrl('two'), pending, null);
    await new Promise((r) => setTimeout(r, 800));
    authWin().close();
    const outcome = await pending.result.then(() => 'вошли', (err) => err.message);
    if (outcome !== 'Вход отменён') throw new Error('Ожидали отмену, получили: ' + outcome);
    console.log('✔ закрытое окно отменяет вход');

    provider.close();
    console.log('\nВсе проверки пройдены');
    app.exit(0);
  } catch (err) {
    console.error('✖', err.message);
    app.exit(1);
  }
});
