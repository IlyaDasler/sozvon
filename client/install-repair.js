// Порядок после обновления на Windows.
// До 1.6 установщик спрашивал «для всех или только для меня», а теперь ставит только для текущего пользователя.
// Из-за этого у части людей остались ярлыки (в том числе закреплённые на панели задач) на старое место
// и старая копия в Program Files. Чиним ярлыки сами и предлагаем удалить старую копию.
const { app, dialog, shell } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SHORTCUT_NAME = /^(созвон|sozvon)\.lnk$/i;

function shortcutDirs() {
  const appData = app.getPath('appData');
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const quickLaunch = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch');
  return [
    app.getPath('desktop'),
    path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    quickLaunch,
    path.join(quickLaunch, 'User Pinned', 'TaskBar'),
    path.join(quickLaunch, 'User Pinned', 'StartMenu'),
  ];
}

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Ярлыки «Созвон» / «Sozvon», которые ведут не на эту копию приложения, перенаправляем на неё */
function repairShortcuts(dirs = shortcutDirs(), exe = process.execPath) {
  let fixed = 0;
  for (const dir of dirs) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((n) => SHORTCUT_NAME.test(n))) {
      const file = path.join(dir, name);
      try {
        const link = shell.readShortcutLink(file);
        if (!/\\sozvon\.exe$/i.test(link.target || '') || samePath(link.target, exe)) continue;
        // В общих папках (для всех пользователей) без прав администратора записать не выйдет — это не страшно
        if (shell.writeShortcutLink(file, 'update', { target: exe, cwd: path.dirname(exe), icon: exe, iconIndex: 0 })) fixed++;
      } catch {}
    }
  }
  return fixed;
}

// Копии, установленные «для всех пользователей»: по записям об удалении программ в реестре (папку берём из команды удаления)
function findMachineCopies() {
  const script = `
    $ErrorActionPreference = 'SilentlyContinue'
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    $keys = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
            'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    @(Get-ItemProperty $keys | Where-Object { $_.UninstallString -like '*Uninstall Sozvon.exe*' } |
      ForEach-Object { $_.UninstallString }) | ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, (err, out) => {
      if (err) return resolve([]);
      try {
        // "C:\Program Files\Sozvon\Uninstall Sozvon.exe" /allusers -> папка программы
        const list = [].concat(JSON.parse(out.trim() || '[]'))
          .map((cmd) => /^"?(.*?)\\Uninstall Sozvon\.exe/i.exec(cmd || '')?.[1])
          .filter(Boolean);
        const here = path.dirname(process.execPath);
        resolve(list.filter((dir) => !samePath(dir, here) && fs.existsSync(path.join(dir, 'Uninstall Sozvon.exe'))));
      } catch {
        resolve([]);
      }
    });
  });
}

// Удаление старой копии требует прав администратора — Windows спросит подтверждение.
// Путь передаём через переменную окружения, чтобы его не пришлось вставлять в текст команды
function uninstallCopy(dir) {
  const script = `Start-Process -FilePath $env:SOZVON_UNINSTALLER -ArgumentList '/S','/allusers' -Verb RunAs -Wait`;
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, env: { ...process.env, SOZVON_UNINSTALLER: path.join(dir, 'Uninstall Sozvon.exe') } },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

const dismissedFile = () => path.join(app.getPath('userData'), 'old-copy-dismissed.json');

async function offerRemoveOldCopy(parent) {
  const copies = await findMachineCopies();
  let dismissed = [];
  try {
    dismissed = JSON.parse(fs.readFileSync(dismissedFile(), 'utf8'));
  } catch {}
  const dir = copies.find((d) => !dismissed.includes(d.toLowerCase()));
  if (!dir || !parent || parent.isDestroyed()) return;

  const { response, checkboxChecked } = await dialog.showMessageBox(parent, {
    type: 'question',
    title: 'Созвон',
    message: 'Найдена старая копия Созвона',
    detail:
      `Раньше Созвон был установлен «для всех пользователей» в папку:\n${dir}\n\n` +
      'Теперь он стоит только для вас, а старая копия больше не обновляется: из-за неё может запускаться старая версия ' +
      'или появляться ошибка «Отсутствует ярлык». Удалить её? Windows попросит подтверждение. Ваш вход и настройки останутся.',
    buttons: ['Удалить старую копию', 'Не сейчас'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: 'Больше не спрашивать',
  });
  if (response !== 0) {
    if (checkboxChecked) fs.writeFileSync(dismissedFile(), JSON.stringify([...dismissed, dir.toLowerCase()]));
    return;
  }
  try {
    await uninstallCopy(dir);
  } catch {
    dialog.showMessageBox(parent, { type: 'warning', title: 'Созвон', message: 'Старую копию удалить не получилось', detail: 'Её можно удалить вручную: Параметры → Приложения → Установленные приложения → Созвон.' });
    return;
  }
  // Закреплённые ярлыки старой копии теперь ведут в никуда — перенаправляем их на эту
  repairShortcuts();
  if (fs.existsSync(path.join(dir, 'Sozvon.exe'))) return;
  dialog.showMessageBox(parent, { type: 'info', title: 'Созвон', message: 'Старая копия удалена', detail: 'Ярлыки теперь открывают новую версию.' });
}

module.exports = { repairShortcuts, offerRemoveOldCopy };
