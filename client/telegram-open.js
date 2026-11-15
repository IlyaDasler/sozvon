// Поиск установленного Telegram Desktop. Если его нет, вызывающий код
// открывает web.telegram.org, а не tg:// (иначе Windows показывает Store).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function windowsCandidates(env) {
  const appData = env.APPDATA || '';
  const local = env.LOCALAPPDATA || '';
  return [
    path.join(appData, 'Telegram Desktop', 'Telegram.exe'),
    path.join(local, 'Telegram Desktop', 'Telegram.exe'),
    path.join(local, 'Programs', 'Telegram Desktop', 'Telegram.exe'),
    path.join(env.ProgramFiles || '', 'Telegram Desktop', 'Telegram.exe'),
    path.join(env['ProgramFiles(x86)'] || '', 'Telegram Desktop', 'Telegram.exe'),
  ];
}

function registryTelegramPath(run) {
  const keys = [
    ['HKCU\\Software\\Classes\\tg\\shell\\open\\command', '/ve'],
    ['HKLM\\Software\\Classes\\tg\\shell\\open\\command', '/ve'],
    ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Telegram Desktop', '/v InstallLocation'],
    ['HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Telegram Desktop', '/v InstallLocation'],
    ['HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Telegram Desktop', '/v InstallLocation'],
  ];
  for (const [key, arg] of keys) {
    try {
      const out = String(run('reg', ['query', key, arg], { encoding: 'utf8', windowsHide: true }));
      const exe = /([A-Za-z]:\\[^\r\n"]*?Telegram\.exe)/i.exec(out);
      if (exe) return exe[1];
      const location = /InstallLocation\s+REG_\w+\s+(.+)/i.exec(out);
      if (location) return path.join(location[1].trim(), 'Telegram.exe');
    } catch {}
  }
  return '';
}

function findTelegramDesktop({
  platform = process.platform,
  env = process.env,
  fsImpl = fs,
  run = execFileSync,
} = {}) {
  if (platform === 'win32') {
    for (const candidate of windowsCandidates(env)) {
      if (candidate && fsImpl.existsSync(candidate)) return { path: candidate, kind: 'exe' };
    }
    const fromRegistry = registryTelegramPath(run);
    if (fromRegistry && fsImpl.existsSync(fromRegistry)) return { path: fromRegistry, kind: 'exe' };
    return null;
  }
  if (platform === 'darwin') {
    const candidates = [
      '/Applications/Telegram.app',
      path.join(env.HOME || '', 'Applications', 'Telegram.app'),
    ];
    const found = candidates.find((candidate) => candidate && fsImpl.existsSync(candidate));
    return found ? { path: found, kind: 'app' } : null;
  }
  if (platform === 'linux') {
    for (const command of ['telegram-desktop', 'telegram']) {
      try {
        const found = String(run('which', [command], { encoding: 'utf8', windowsHide: true })).trim();
        if (found && fsImpl.existsSync(found)) return { path: found, kind: 'command' };
      } catch {}
    }
  }
  return null;
}

function webTelegramUrl(tgUrl) {
  return `https://web.telegram.org/a/#?tgaddr=${encodeURIComponent(tgUrl)}`;
}

module.exports = { findTelegramDesktop, webTelegramUrl, windowsCandidates };