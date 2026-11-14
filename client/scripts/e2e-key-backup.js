// Новый вход по паролю сам забирает ключ шифрования с сервера — без кода переноса.
// Запуск: electron scripts/e2e-key-backup.js [http://127.0.0.1:3000]
const { SERVER, js, sleep, waitFor, openClient, runTest } = require('./e2e-lib');

const login = async (name, username, opts) => {
  const win = await openClient(name, null, undefined, { ...opts, waitReady: false });
  await waitFor(win, `document.querySelector('.screen:not(.hidden)')?.id === 'auth'`, `${name}: форма входа`);
  await js(win,
    `document.getElementById('auth-username').value=${JSON.stringify(username)};` +
    `document.getElementById('auth-password').value='test-pass-1';` +
    `document.getElementById('auth-form').requestSubmit(); true`
  );
  await waitFor(win, `Boolean(e2ee.identity?.publicKey) && Boolean(state.me?.publicKey)`, `${name}: ключ`);
  await sleep(700); // дать PUT резервной копии завершиться
  return win;
};

runTest(async () => {
  const username = `keybackup_${Date.now().toString(36).slice(-6)}`;
  const known = await fetch(`${SERVER}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test-pass-1', displayName: 'Key Backup' }),
  });
  if (!known.ok) throw new Error(`register ${known.status}: ${await known.text()}`);

  const a = await login('key-backup-a', username, { serverUrl: SERVER });
  const firstKey = await js(a, `e2ee.identity.publicKey`);
  const token = await js(a, `Api.token`);
  const base = await js(a, `Api.base`);
  const backup = await fetch(`${base}/api/key-backup/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: 'test-pass-1' }),
  });
  if (!backup.ok) throw new Error(`key-backup ${backup.status}`);
  const blob = await backup.json();
  if (!blob.ct || blob.ct.includes('privateJwk')) throw new Error('ключ уехал на сервер в открытом виде');

  const b = await login('key-backup-b', username, { serverUrl: SERVER });
  const secondKey = await js(b, `e2ee.identity.publicKey`);
  if (secondKey !== firstKey) throw new Error('на новом устройстве другой ключ');
  console.log('✔ новый вход по паролю восстановил тот же ключ автоматически');
  a.destroy();
  b.destroy();
});
