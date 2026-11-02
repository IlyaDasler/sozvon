// Ad-hoc подпись macOS-сборки.
//
// Без сертификата Apple electron-builder оставляет приложение вообще без подписи, а на Apple
// Silicon macOS требует подпись у любого кода — иначе показывает «приложение повреждено»
// и предлагает переместить в Корзину (xattr тут не помогает).
// Адхок-подпись (codesign --sign -) делает бандл валидным для системы; предупреждение
// «неизвестный разработчик» остаётся, но приложение запускается.
//
// Хук вызывается electron-builder после сборки .app и до упаковки в dmg/zip.
// Если настоящий сертификат появился (CSC_LINK), ничего не делаем: подписывает electron-builder.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK) return; // настоящая подпись — не мешаем

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  // Проверяем, что подпись встала: иначе сборка уедет людям «повреждённой»
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log(`✔ ad-hoc подпись: ${appPath}`);
};
