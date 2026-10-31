// После подписи: подписанный установщик заменяет обычный, latest.yml описывает уже его. Иначе автообновление сверит хеш,
// не совпадёт — и отбросит файл как испорченный. Карта для частичной загрузки (.blockmap) считалась по файлу без подписи:
// убираем, обновление скачается целиком. Запуск в сборке: node scripts/use-signed-installer.js dist dist-signed
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Текст latest.yml с новым хешем и размером установщика */
function withInstaller(latest, { sha512, size }) {
  if (!/^sha512: /m.test(latest) || !/^ +sha512: /m.test(latest) || !/^ +size: /m.test(latest)) throw new Error('latest.yml не похож на файл автообновления');
  return latest
    .replace(/^( *)sha512: .*$/gm, (_, indent) => `${indent}sha512: ${sha512}`)
    .replace(/^( +)size: .*$/m, (_, indent) => `${indent}size: ${size}`)
    .replace(/^ +blockMapSize: .*\n/m, '');
}

function useSignedInstaller(distDir, signedDir) {
  const signed = fs.existsSync(signedDir) ? fs.readdirSync(signedDir).find((name) => name.endsWith('.exe')) : null;
  if (!signed) throw new Error(`Нет подписанного установщика в ${signedDir}`);
  const target = path.join(distDir, signed);
  fs.copyFileSync(path.join(signedDir, signed), target);
  fs.rmSync(`${target}.blockmap`, { force: true });
  const file = fs.readFileSync(target);
  const latest = path.join(distDir, 'latest.yml');
  const sha512 = crypto.createHash('sha512').update(file).digest('base64');
  fs.writeFileSync(latest, withInstaller(fs.readFileSync(latest, 'utf8'), { sha512, size: file.length }));
}

if (require.main === module) useSignedInstaller(process.argv[2], process.argv[3]);

module.exports = { useSignedInstaller, withInstaller };
