const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findTelegramDesktop, webTelegramUrl } = require('../telegram-open');

test('finds Telegram Desktop in AppData', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-test-'));
  const sub = path.join(dir, 'Telegram Desktop');
  fs.mkdirSync(sub);
  const exe = path.join(sub, 'Telegram.exe');
  fs.writeFileSync(exe, 'x');
  const found = findTelegramDesktop({
    platform: 'win32',
    env: { APPDATA: dir },
    run: () => { throw new Error('no registry'); },
  });
  assert.deepEqual(found, { path: exe, kind: 'exe' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('returns null when Telegram is absent', () => {
  const found = findTelegramDesktop({
    platform: 'win32',
    env: { APPDATA: path.join(os.tmpdir(), 'no-such-telegram'), LOCALAPPDATA: '', ProgramFiles: '', 'ProgramFiles(x86)': '' },
    run: () => { throw new Error('no registry'); },
  });
  assert.equal(found, null);
});

test('builds Telegram Web URL with tgaddr', () => {
  const url = webTelegramUrl('tg://resolve?domain=sozvon_verify_bot&start=abc');
  assert.match(url, /^https:\/\/web\.telegram\.org\/a\/#\?tgaddr=/);
  assert.match(url, /tg%3A%2F%2Fresolve/);
});