// Подписывает latest.yml/latest-mac.yml ключом Ed25519 на сервере.
// Запуск: node scripts/sign-update-manifests.js /opt/sozvon-web/updates
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] || '/opt/sozvon-web/updates';
const keyPath = process.env.SOZVON_UPDATE_SIGNING_KEY || '/etc/sozvon-update-signing.key';
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));

for (const rel of ['win/latest.yml', 'mac/latest-mac.yml']) {
  const file = path.join(root, rel);
  const bytes = fs.readFileSync(file);
  const signature = crypto.sign(null, bytes, privateKey).toString('base64');
  fs.writeFileSync(`${file}.sig`, signature + '\n');
  console.log(`signed ${rel}`);
}
