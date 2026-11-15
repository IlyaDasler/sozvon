// Два устройства одного аккаунта: отдельный Electron-процесс с другим device key.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { SERVER, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const DEVICE2_KEY = 'e2e-device-key-2';

async function loginWithDevice(username, password, deviceKey) {
  const res = await fetch(`${SERVER}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Key': deviceKey, 'X-Client-Version': '3.7.0' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `login ${res.status}`);
  return data;
}

function readResult(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

async function createSecondDevice(auth, dir) {
  const resultFile = path.join(dir, 'result.json');
  const commandFile = path.join(dir, 'command.json');
  const child = spawn(process.execPath, ['--no-sandbox', path.join(__dirname, 'e2e-device-child.js'), SERVER], {
    env: {
      ...process.env,
      SOZVON_E2E: '1',
      SOZVON_E2E_DEVICE_KEY: DEVICE2_KEY,
      E2E_USER_DATA: path.join(dir, 'profile'),
      E2E_AUTH: JSON.stringify(auth),
      E2E_COMMAND_FILE: commandFile,
      E2E_RESULT_FILE: resultFile,
      E2E_NAME: 'second-device',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const until = Date.now() + 40_000;
  while (Date.now() < until) {
    const data = readResult(resultFile);
    if (data?.ready) break;
    if (data?.error) throw new Error(data.error);
    if (child.exitCode !== null) throw new Error(`child exit ${child.exitCode}: ${stderr.slice(-800)}`);
    await sleep(250);
  }
  if (!readResult(resultFile)?.ready) throw new Error(`child timeout: ${stderr.slice(-800)}`);
  let seq = 0;
  async function command(code) {
    const id = ++seq;
    fs.writeFileSync(commandFile, JSON.stringify({ id, type: 'js', code }));
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const data = readResult(resultFile);
      if (data?.id === id) {
        if (data.error) throw new Error(data.error);
        return data.result;
      }
      await sleep(100);
    }
    throw new Error('второе устройство не ответило');
  }
  return {
    command,
    close() {
      try { fs.writeFileSync(commandFile, JSON.stringify({ id: 9999, type: 'close' })); } catch {}
      setTimeout(() => child.kill(), 500);
    },
  };
}

const lastText = (box) => `[...document.querySelectorAll('#${box} .msg-text')].at(-1)?.textContent`;
const sendDm = (win, text) =>
  js(win, `document.getElementById('message-input').value = ${JSON.stringify(text)}; document.getElementById('message-form').requestSubmit(); true`);

runTest(async () => {
  const a = await register('mda', 'Аня');
  const b = await register('mdb', 'Боря');
  await befriend(a, b);
  const b2 = await loginWithDevice(b.user.username, 'test-pass-1', DEVICE2_KEY);
  const dir = fs.mkdtempSync(path.join(__dirname, '..', '.e2e-md-'));
  let second = null;
  try {
    const winA = await openClient('mda', a);
    const winB1 = await openClient('mdb1', b);
    for (const [win, name] of [[winA, 'A'], [winB1, 'B1']]) {
      await waitFor(win, `e2eeReady() && state.me.publicKey === e2ee.identity.publicKey`, `${name}: ключ`);
    }
    if (!(await js(winB1, `backupKeyWithPassword('test-pass-1')`))) throw new Error('B1: не сохранил backup');
    second = await createSecondDevice(b2, dir);
    const readyUntil = Date.now() + 20_000;
    while (Date.now() < readyUntil) {
      if (await second.command('Boolean(e2eeReady() && state.me.publicKey === e2ee.identity.publicKey)')) break;
      await sleep(250);
    }
    await second.command(`selectContact(${a.user.id})`);
    await js(winA, `selectContact(${b.user.id})`);
    await js(winB1, `selectContact(${a.user.id})`);
    await sendDm(winA, 'на два устройства');
    await waitFor(winB1, `${lastText('messages')} === 'на два устройства'`, 'B1 прочитал');
    const b2text = await second.command(`[...document.querySelectorAll('#messages .msg-text')].at(-1)?.textContent`);
    if (b2text !== 'на два устройства') throw new Error(`B2 прочитал: ${b2text}`);
    console.log('✔ оба устройства прочитали v3');
    await second.command(`document.getElementById('message-input').value = 'ответ со второго'; document.getElementById('message-form').requestSubmit(); true`);
    await waitFor(winA, `${lastText('messages')} === 'ответ со второго'`, 'A прочитал B2');
    console.log('✔ A прочитал ответ со второго устройства');
  } finally {
    second?.close();
    await sleep(1500);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
