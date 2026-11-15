// Проверка X3DH через utility-процесс и серверный prekey API.
const { api, befriend, register, js, waitFor, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('xa', 'Аня');
  const b = await register('xb', 'Боря');
  await befriend(a, b);
  const winA = await openClient('xa', a);
  const winB = await openClient('xb', b);
  for (const [win, u] of [[winA, a], [winB, b]]) {
    await waitFor(win, `e2eeReady() && state.me.publicKey === e2ee.identity.publicKey`, `${u.user.displayName}: свой ключ`);
    await js(win, `publishPrekey()`);
  }
  const bundle = await api('GET', `/users/${b.user.id}/prekey`, null, a.token);
  if (!bundle?.signature) throw new Error('prekey bundle без подписи');
  const serverKey = await js(winA, `window.desktop.update.publicKey()`);
  const valid = await js(winA, `window.desktop.identity.x3dhVerify(${JSON.stringify(bundle)}, ${JSON.stringify(serverKey)})`);
  if (!valid) throw new Error('подпись prekey не прошла проверку');
  const contextA = await js(winA, 'identityContext()');
  const contextB = await js(winB, 'identityContext()');
  const initiatorPublic = await js(winA, 'e2ee.identity.publicKey');
  const init = await js(winA, `window.desktop.identity.x3dhInitiator(${JSON.stringify(contextA)}, ${JSON.stringify(bundle)})`);
  const resp = await js(winB, `window.desktop.identity.x3dhResponder(${JSON.stringify(contextB)}, ${JSON.stringify(initiatorPublic)}, ${JSON.stringify(init.ephemeralPublic)})`);
  if (!init.root || init.root !== resp.root) throw new Error('X3DH root не совпал');
  console.log('✔ X3DH: prekey, подпись и общий root через utility-процесс');
});