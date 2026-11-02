// Обновление macOS-версии своими руками: GitHub Releases → zip → подмена .app → перезапуск.
//
// Почему так: системный автоапдейтер (Squirrel.Mac) ставит только подписанное приложение,
// а сертификата Apple у нас нет. Поэтому качаем архив сами, снимаем с него карантин
// и заменяем бандл, пока приложение закрыто. Ограничения этого способа:
//   • после обновления macOS заново спросит разрешения (микрофон, камера, экран, универсальный
//     доступ) — они привязаны к подписи, а она у каждого билда своя;
//   • папка с приложением должна быть доступна на запись (обычно да: её создал сам человек).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { spawn } = require('node:child_process');

const REPO = 'IlyaDasler/sozvon';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;

/** Путь к .app, из которого запущено приложение: …/Sozvon.app/Contents/MacOS/Sozvon */
function bundlePath(exe = process.execPath) {
  let dir = path.dirname(exe);
  for (let i = 0; i < 4; i++) {
    if (dir.endsWith('.app')) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/** Имя ассета под нашу архитектуру: arm64 или x64 */
function assetName(version, arch = process.arch) {
  return `Sozvon-${version}-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`;
}

/** Разбор ответа GitHub: версия, ссылка и размер нужного архива */
function pickAsset(release, arch = process.arch) {
  const version = String(release?.tag_name || '').replace(/^v/, '');
  if (!version) return null;
  const want = assetName(version, arch);
  const asset = (release.assets || []).find((a) => a.name === want);
  if (!asset?.browser_download_url?.startsWith(DOWNLOAD_PREFIX)) return null;
  return { version, url: asset.browser_download_url, size: asset.size, name: asset.name };
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Sozvon-Updater', Accept: 'application/vnd.github+json' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GitHub ответил ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Не дождались ответа GitHub')));
  });
}

/** Качает файл, сообщая прогресс в процентах */
function download(url, dest, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const go = (target, hops = 0) => {
      if (hops > 5) return reject(new Error('Слишком много перенаправлений'));
      https
        .get(target, { headers: { 'User-Agent': 'Sozvon-Updater' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return go(res.headers.location, hops + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Не удалось скачать обновление: ${res.statusCode}`));
          }
          const total = Number(res.headers['content-length']) || 0;
          let got = 0;
          const out = fs.createWriteStream(dest);
          res.on('data', (chunk) => {
            got += chunk.length;
            if (total) onProgress(Math.min(100, Math.round((got / total) * 100)));
          });
          res.pipe(out);
          out.on('finish', () => out.close(() => resolve(dest)));
          out.on('error', reject);
        })
        .on('error', reject);
    };
    go(url);
  });
}

/** Скрипт подмены: ждёт выхода приложения, ставит новую копию и запускает её */
function swapScript({ pid, appDir, newApp }) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh
# Ждём, пока приложение закроется, и подменяем бандл целиком
PID=${pid}
APP=${q(appDir)}
NEW=${q(newApp)}
OLD="$APP.old"
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
xattr -dr com.apple.quarantine "$NEW" 2>/dev/null
rm -rf "$OLD"
if [ -d "$APP" ]; then mv "$APP" "$OLD" || exit 1; fi
if ! mv "$NEW" "$APP"; then
  # Не получилось — возвращаем старую версию на место
  [ -d "$OLD" ] && mv "$OLD" "$APP"
  exit 1
fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
# Подпись должна быть валидной, иначе macOS скажет «приложение повреждено» (на Apple Silicon
# это требование ко всему коду). Архив уже подписан адхоком, но подстрахуемся
codesign --force --deep --sign - "$APP" 2>/dev/null
open "$APP" || true
sleep 2
rm -rf "$OLD"
`;
}

const workDir = () => path.join(os.tmpdir(), 'sozvon-update');

/** Скачать и распаковать обновление; возвращает путь к новой .app */
async function prepare({ version, onProgress }) {
  const dir = workDir();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const release = await getJson(RELEASES_API).catch(() => null);
  const asset = release && pickAsset(release);
  if (!asset) throw new Error('В последнем релизе нет архива для этого Mac');
  if (version && asset.version !== version) throw new Error('Версия на GitHub не совпала с ожидаемой');

  const zip = path.join(dir, asset.name);
  await download(asset.url, zip, onProgress);
  const size = fs.statSync(zip).size;
  if (asset.size && size !== asset.size) throw new Error('Архив скачался не полностью');

  const unpacked = path.join(dir, 'app');
  await new Promise((resolve, reject) => {
    const ditto = spawn('ditto', ['-x', '-k', zip, unpacked], { stdio: 'ignore' });
    ditto.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Не удалось распаковать архив'))));
    ditto.on('error', reject);
  });

  const app = fs.readdirSync(unpacked).map((n) => path.join(unpacked, n)).find((p) => p.endsWith('.app'));
  if (!app) throw new Error('В архиве нет приложения');
  return app;
}

/** Поставить скачанное и перезапуститься */
function apply({ newApp, app, onQuit }) {
  const dir = path.dirname(app);
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    return { ok: false, reason: 'Нет прав на запись рядом с приложением' };
  }
  const script = path.join(workDir(), 'swap.sh');
  fs.writeFileSync(script, swapScript({ pid: process.pid, appDir: app, newApp }), { mode: 0o755 });
  const child = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' });
  child.unref();
  onQuit?.();
  return { ok: true };
}

module.exports = { bundlePath, assetName, pickAsset, swapScript, prepare, apply, getJson };
