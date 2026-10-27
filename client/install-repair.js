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

// Старые копии, которые больше не обновляются:
//  - machine — установленные «для всех пользователей» (запись об удалении в HKLM), убираем их деинсталлятором;
//  - folder — копия в папке, куда без прав администратора не записать (например, Program Files):
//    установщик поставил новую версию в папку пользователя и запомнил старый путь в HKCU\Software\Sozvon.
//    Её деинсталлятор не запускаем (он удалил бы и ярлыки новой версии) — просто удаляем папку
function findOldCopies() {
  const script = `
    $ErrorActionPreference = 'SilentlyContinue'
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    $keys = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
            'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    @{
      machine = @(Get-ItemProperty $keys | Where-Object { $_.UninstallString -like '*Uninstall Sozvon.exe*' } |
        ForEach-Object { $_.UninstallString })
      moved = (Get-ItemProperty 'HKCU:\\Software\\Sozvon').OldInstallLocation
    } | ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, (err, out) => {
      if (err) return resolve([]);
      try {
        const data = JSON.parse(out.trim() || '{}');
        const here = path.dirname(process.execPath);
        const isCopy = (dir) => dir && !samePath(dir, here) && fs.existsSync(path.join(dir, 'Sozvon.exe'));
        const copies = [];
        // "C:\Program Files\Sozvon\Uninstall Sozvon.exe" /allusers -> папка программы
        for (const cmd of [].concat(data.machine || [])) {
          const dir = /^"?(.*?)\\Uninstall Sozvon\.exe/i.exec(cmd || '')?.[1];
          if (isCopy(dir) && fs.existsSync(path.join(dir, 'Uninstall Sozvon.exe'))) copies.push({ dir, kind: 'machine' });
        }
        if (isCopy(data.moved) && fs.existsSync(path.join(data.moved, 'resources'))) copies.push({ dir: data.moved, kind: 'folder' });
        else if (data.moved) forgetMovedCopy();
        resolve(copies);
      } catch {
        resolve([]);
      }
    });
  });
}

const forgetMovedCopy = () =>
  execFile('reg.exe', ['delete', 'HKCU\\Software\\Sozvon', '/v', 'OldInstallLocation', '/f'], { windowsHide: true }, () => {});

// Удаление старой копии требует прав администратора — Windows спросит подтверждение.
// Путь передаём через переменную окружения, а в команду для окна администратора — закодированным
function removeCopy({ dir, kind }) {
  const script =
    kind === 'machine'
      ? `Start-Process -FilePath (Join-Path $env:SOZVON_OLD_DIR 'Uninstall Sozvon.exe') -ArgumentList '/S','/allusers' -Verb RunAs -Wait`
      : `$d = $env:SOZVON_OLD_DIR -replace "'", "''"
         $cmd = "Remove-Item -LiteralPath '$d' -Recurse -Force"
         $b = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
         Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand',$b`;
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, env: { ...process.env, SOZVON_OLD_DIR: dir } },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

const dismissedFile = () => path.join(app.getPath('userData'), 'old-copy-dismissed.json');

async function offerRemoveOldCopy(parent) {
  const copies = await findOldCopies();
  let dismissed = [];
  try {
    dismissed = JSON.parse(fs.readFileSync(dismissedFile(), 'utf8'));
  } catch {}
  const copy = copies.find((c) => !dismissed.includes(c.dir.toLowerCase()));
  if (!copy || !parent || parent.isDestroyed()) return;

  const why =
    copy.kind === 'machine'
      ? `Раньше Созвон был установлен «для всех пользователей» в папку:\n${copy.dir}`
      : `Раньше Созвон стоял в папке, куда без прав администратора нельзя ставить обновления:\n${copy.dir}`;
  const { response, checkboxChecked } = await dialog.showMessageBox(parent, {
    type: 'question',
    title: 'Созвон',
    message: 'Найдена старая копия Созвона',
    detail:
      `${why}\n\nТеперь он стоит только для вас и обновляется без прав администратора, а старая копия больше не обновляется: ` +
      'из-за неё может запускаться старая версия. Удалить её? Windows попросит подтверждение. Ваш вход и настройки останутся.',
    buttons: ['Удалить старую копию', 'Не сейчас'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: 'Больше не спрашивать',
  });
  if (response !== 0) {
    if (checkboxChecked) fs.writeFileSync(dismissedFile(), JSON.stringify([...dismissed, copy.dir.toLowerCase()]));
    return;
  }
  try {
    await removeCopy(copy);
  } catch {}
  if (fs.existsSync(path.join(copy.dir, 'Sozvon.exe'))) {
    dialog.showMessageBox(parent, {
      type: 'warning',
      title: 'Созвон',
      message: 'Старую копию удалить не получилось',
      detail: `Удалите папку вручную:\n${copy.dir}`,
    });
    return;
  }
  if (copy.kind === 'folder') forgetMovedCopy();
  // Закреплённые ярлыки старой копии теперь ведут в никуда — перенаправляем их на эту
  repairShortcuts();
  dialog.showMessageBox(parent, { type: 'info', title: 'Созвон', message: 'Старая копия удалена', detail: 'Ярлыки теперь открывают новую версию.' });
}

module.exports = { repairShortcuts, offerRemoveOldCopy };
