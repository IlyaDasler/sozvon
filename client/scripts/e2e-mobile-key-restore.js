// Ключ шифрования подключается сам на «новом устройстве»:
// после входа нет окна переноса, ключ восстанавливается из резервной копии аккаунта.
const { api, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('kr' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('kr', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await waitFor(w, `e2eeReady()`, 'ключ создан при входе', 6000);

  const publicKey = await js(w, `state.me.publicKey`);
  if (!publicKey) throw new Error('нет публичного ключа после входа');

  // Сервер должен хранить резервную копию, а не только публичный ключ.
  const backup = JSON.parse(await js(w, `Api.get('/me/key/backup').then((r) => JSON.stringify(r)).catch((e) => JSON.stringify({ error: e.message }))`));
  if (!backup?.identity?.privateJwk) throw new Error('нет резервной копии ключа на сервере: ' + JSON.stringify(backup));
  if (backup.identity.publicKey !== publicKey) throw new Error('копия не совпадает с публичным ключом');

  // Имитация нового устройства: локального ключа нет, окна переноса быть не должно.
  await js(w, `localStorage.removeItem(identityStoreKey()); e2ee.identity = null; e2ee.privateKey = null; e2ee.convs.clear(); true`);
  await js(w, `setupE2EE(); true`);
  await waitFor(w, `e2eeReady()`, 'ключ восстановлен автоматически', 6000);

  const restored = await js(w, `e2ee.identity.publicKey`);
  if (restored !== publicKey) throw new Error('восстановлен не тот ключ: ' + restored + ' != ' + publicKey);
  if (await js(w, `Boolean(document.getElementById('e2ee-setup'))`)) throw new Error('окно переноса ключа всё ещё существует');
  if (await js(w, `Boolean(document.getElementById('e2ee-share-btn'))`)) throw new Error('кнопка переноса ключа всё ещё существует');

  // В интерфейсе нет ни переноса, ни кода: только описание.
  const settingsText = await js(w, `(() => { openSettings('account'); return true; })()`).then(async () => js(w, `document.getElementById('settings').innerText`));
  if (/Перенести ключ|перенести ключ|XXXX-XXXX|код с другого устройства/i.test(settingsText)) {
    throw new Error('в настройках остался текст переноса ключа');
  }
  console.log('ok key auto-restore', publicKey.slice(0, 12) + '…');
});
