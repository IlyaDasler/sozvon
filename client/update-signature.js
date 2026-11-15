// Проверка подписи манифеста обновления встроенным Ed25519-ключом.
const crypto = require('node:crypto');

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

module.exports = { fetchSignedManifest, PUBLIC_KEY };