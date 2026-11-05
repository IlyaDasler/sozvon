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
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const REPO = 'IlyaDasler/sozvon';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
// Прод-клиент обновляется с нашего сервера, без GitHub: Caddy отдаёт
// /updates/mac/latest-mac.yml и архивы как обычные файлы.
const PRODUCTION_BASE = 'https://135-106-226-12.sslip.io';
function feedBase(base) {
  const clean = String(base || '').replace(/\/+$/, '');
  return clean === PRODUCTION_BASE ? clean + '/updates/mac' : null;
}

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

/** Разбор latest-mac.yml: размер и sha512 нужного архива (в base64, как у electron-builder) */
function manifestEntry(text, name) {
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*-\s*url:\s*/.test(lines[i])) continue;
    if (lines[i].split('url:')[1].trim() !== name) continue;
    let size = null;
    let sha512 = null;
    for (let j = i + 1; j < lines.length && !/^\s*-\s*url:/.test(lines[j]); j++) {
      const sizeMatch = /^\s+size:\s*(\d+)/.exec(lines[j]);
      const shaMatch = /^\s+sha512:\s*(\S+)/.exec(lines[j]);
      if (sizeMatch) size = Number(sizeMatch[1]);
      if (shaMatch) sha512 = shaMatch[1];
    }
    return { size, sha512 };
  }
  return null;
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

/** Качает файл, сообщая прогресс в процентах. Если соединение «замолчало» — обрываем:
 *  иначе окно обновления висит на одном проценте бесконечно */
function download(url, dest, onProgress = () => {}, expectedSize = 0) {
  const STALL_MS = 45000;
  const TOTAL_MS = 15 * 60_000;
  return new Promise((resolve, reject) => {
    let watchdog = null;
    const totalTimer = setTimeout(() => fail(new Error('Загрузка обновления заняла слишком много времени')), TOTAL_MS);
    const finish = (fn, arg) => {
      clearTimeout(watchdog);
      clearTimeout(totalTimer);
      fn(arg);
    };
    const fail = (err) => finish(reject, err);
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => fail(new Error('Загрузка остановилась: сервер перестал отвечать')), STALL_MS);
    };
    const go = (target, hops = 0) => {
      if (hops > 5) return fail(new Error('Слишком много перенаправлений'));
      arm();
      https
        .get(target, { headers: { 'User-Agent': 'Sozvon-Updater' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return go(res.headers.location, hops + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return fail(new Error(`Не удалось скачать обновление: ${res.statusCode}`));
          }
          const total = Number(res.headers['content-length']) || expectedSize || 0;
          let got = 0;
          const out = fs.createWriteStream(dest);
          res.on('data', (chunk) => {
            got += chunk.length;
            arm();
            if (total) onProgress(Math.min(100, Math.round((got / total) * 100)));
          });
          res.on('error', fail);
          res.pipe(out);
          out.on('finish', () => out.close(() => finish(resolve, dest)));
          out.on('error', fail);
        })
        .on('error', fail);
    };
    go(url);
  });
}

/** Скрипт подмены: ждёт выхода приложения (не дольше 30 секунд), ставит новую копию,
 *  запускает её и пишет каждый шаг в журнал — иначе «зависание» не отличить от ожидания */
function swapScript({ pid, appDir, newApp, log }) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh
exec >> ${q(log)} 2>&1
PID=${pid}
APP=${q(appDir)}
NEW=${q(newApp)}
OLD="$APP.old"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') старт: pid=$PID"
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -gt 100 ]; then
    echo "приложение не закрылось за 30 секунд — оставляем старую версию"
    open "$APP" 2>/dev/null
    exit 1
  fi
  sleep 0.3
done
echo "приложение закрылось"
xattr -dr com.apple.quarantine "$NEW" 2>/dev/null
rm -rf "$OLD"
if [ -d "$APP" ]; then
  mv "$APP" "$OLD" || { echo "не удалось отодвинуть старую копию"; open "$OLD" 2>/dev/null; exit 1; }
fi
if ! mv "$NEW" "$APP"; then
  echo "не удалось поставить новую копию — возвращаем старую"
  [ -d "$OLD" ] && mv "$OLD" "$APP"
  open "$APP" 2>/dev/null
  exit 1
fi
echo "новая версия на месте"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
# Подпись должна быть валидной, иначе macOS скажет «приложение повреждено»
codesign --force --deep --sign - "$APP" 2>/dev/null
echo "подпись обновлена"
open "$APP" || echo "не удалось запустить приложение"
sleep 2
rm -rf "$OLD"
echo "готово"
`;
}

const workDir = () => path.join(os.tmpdir(), 'sozvon-update');
const swapLog = () => path.join(workDir(), 'swap.log');

/** Скачиваем файл и проверяем, что он совпал с latest-mac.yml: без этого можно исполнить
 *  подменённый архив. Проверка по sha512 — как у electron-updater на Windows */
async function downloadVerified(name, url, dest, manifest, onProgress) {
  await download(url, dest, onProgress, manifest?.size || 0);
  const size = fs.statSync(dest).size;
  if (manifest?.size && size !== manifest.size) throw new Error('Архив скачался не полностью');
  if (!manifest?.sha512) throw new Error('Не удалось проверить целостность обновления');
  const hash = crypto.createHash('sha512').update(fs.readFileSync(dest)).digest('base64');
  if (hash !== manifest.sha512) throw new Error('Обновление повреждено: контрольная сумма не совпала');
  return size;
}

/** Текст с HTTPS (для latest-mac.yml) */
function getText(url) {
  return new Promise((resolve, reject) => {
    const go = (target, hops = 0) => {
      if (hops > 5) return reject(new Error('Слишком много перенаправлений'));
      const req = https.get(target, { headers: { 'User-Agent': 'Sozvon-Updater' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return go(res.headers.location, hops + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Сервер ответил ${res.statusCode}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('Не дождались ответа сервера')));
    };
    go(url);
  });
}

/** Скачать и распаковать обновление; возвращает путь к новой .app */
async function prepare({ version, onProgress, onStage = () => {}, base: clientBase = '' }) {
  const dir = workDir();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  // Прод-клиент берёт файлы с нашего сервера, остальные — с GitHub.
  // Размер и sha512 берём из манифеста релиза — он публикуется вместе с архивом.
  const name = assetName(version);
  const feed = feedBase(clientBase);
  const downloadBase = feed ? `${feed}/${name}` : `${DOWNLOAD_PREFIX}v${version}/${name}`;
  const manifestUrl = feed ? `${feed}/latest-mac.yml` : `${DOWNLOAD_PREFIX}v${version}/latest-mac.yml`;
  const manifest = await getText(manifestUrl)
    .then((text) => manifestEntry(text, name))
    .catch(() => null);
  if (!manifest?.sha512) throw new Error('Не удалось получить подписанный список файлов релиза');

  const zip = path.join(dir, name);
  await downloadVerified(name, downloadBase, zip, manifest, onProgress);
  // Архив меньше мегабайта — значит скачалась страница ошибки, а не приложение
  if (fs.statSync(zip).size < 1024 * 1024) throw new Error('Скачался не архив приложения');
  const head = Buffer.alloc(2);
  const fd = fs.openSync(zip, 'r');
  fs.readSync(fd, head, 0, 2, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== 'PK') throw new Error('Файл не похож на zip-архив');

  onStage('unpacking');
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

/** Поставить скачанное и перезапуститься. Каждый шаг скрипт пишет в swap.log:
 *  по нему видно, где именно встало обновление */
function apply({ newApp, app, onQuit }) {
  const dir = path.dirname(app);
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    return { ok: false, reason: 'Нет прав на запись рядом с приложением' };
  }
  fs.mkdirSync(workDir(), { recursive: true });
  const script = path.join(workDir(), 'swap.sh');
  const log = swapLog();
  fs.writeFileSync(log, `обновление запущено ${new Date().toISOString()}\n`);
  fs.writeFileSync(script, swapScript({ pid: process.pid, appDir: app, newApp, log }), { mode: 0o755 });
  const child = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' });
  child.unref();
  onQuit?.();
  return { ok: true, log };
}

module.exports = { bundlePath, assetName, pickAsset, manifestEntry, swapScript, prepare, apply, getJson, swapLog, downloadVerified };
