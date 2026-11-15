// Проверка подписи манифеста обновления встроенным Ed25519-ключом.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_KEY = 'MCowBQYDK2VwAyEAg/ouJteuE7GgV+amIeKHxzzCit3ZKkX/K4Mxnk8kuU8=';
const publicKey = crypto.createPublicKey({
  key: Buffer.from(PUBLIC_KEY, 'base64'),
  format: 'der',
  type: 'spki',
});

async function fetchSignedManifest(baseUrl, name) {
  const [manifestResponse, signatureResponse] = await Promise.all([
    fetch(baseUrl + '/' + name, { signal: AbortSignal.timeout(10000) }),
    fetch(baseUrl + '/' + name + '.sig', { signal: AbortSignal.timeout(10000) }),
  ]);
  if (!manifestResponse.ok || !signatureResponse.ok) throw new Error('Не удалось проверить подпись обновления');
  const bytes = Buffer.from(await manifestResponse.arrayBuffer());
  const signature = Buffer.from((await signatureResponse.text()).trim(), 'base64');
  if (!crypto.verify(null, bytes, publicKey, signature)) throw new Error('Подпись обновления неверна');
  return bytes.toString('utf8');
}

function manifestHashForFile(manifestText, fileName) {
  // latest.yml — контролируемый electron-builder формат. Разбираем только
  // секцию files, чтобы не подключать YAML-парсер с сетевым вводом.
  const lines = String(manifestText).split(/\r?\n/);
  let current = '';
  let inFiles = false;
  for (const line of lines) {
    if (/^files:\s*$/.test(line)) { inFiles = true; continue; }
    if (inFiles && /^\S/.test(line)) break;
    if (!inFiles) continue;
    const url = /^\s*-\s*url:\s*(.+?)\s*$/.exec(line);
    if (url) { current = path.basename(url[1].replace(/^['"]|['"]$/g, '')); continue; }
    const sha = /^\s*sha512:\s*(.+?)\s*$/.exec(line);
    if (sha && current === fileName) return sha[1].replace(/^['"]|['"]$/g, '');
  }
  return '';
}

function fileSha512Base64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

module.exports = { fetchSignedManifest, manifestHashForFile, fileSha512Base64, PUBLIC_KEY };