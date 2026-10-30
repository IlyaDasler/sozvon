// Резервная копия: снимается на работающем сервере, из неё сервер поднимается с теми же данными, старые копии уходят
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const temp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `sozvon-${name}-`));

function runBackup(dataDir, backupDir, extra = {}) {
  const result = spawnSync(process.execPath, ['src/backup.js'], { env: { ...process.env, DATA_DIR: dataDir, BACKUP_DIR: backupDir, ...extra }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('копия работающего сервера восстанавливается: сообщения и файлы на месте', async () => {
  const dataDir = temp('live');
  const backupDir = temp('backup');
  const s = await startServer({ dataDir });
  const a = await s.reg('b_a');
  const b = await s.reg('b_b');
  await s.befriend(a, b);
  await s.api('POST', `/messages/${b.user.id}`, { text: 'сохрани меня' }, a.token);
  const res = await fetch(`${s.base}/api/uploads?name=f.txt`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${a.token}` }, body: 'файл' });
  const file = await res.json();

  assert.match(runBackup(dataDir, backupDir), /Резервная копия готова/);
  await s.stop({ keepData: true });

  // Восстановление: новая папка данных из копии
  const restored = temp('restored');
  const db = fs.readdirSync(backupDir).find((n) => n.endsWith('.db'));
  fs.copyFileSync(path.join(backupDir, db), path.join(restored, 'sozvon.db'));
  fs.cpSync(path.join(backupDir, 'files'), path.join(restored, 'files'), { recursive: true });
  fs.copyFileSync(path.join(dataDir, 'secret.key'), path.join(restored, 'secret.key'));
  const r = await startServer({ dataDir: restored });
  const history = await r.api('GET', `/messages/${a.user.id}`, null, b.token);
  assert.equal(history.body[0].text, 'сохрани меня');
  assert.equal(await (await fetch(`${r.base}${file.url}`)).text(), 'файл');
  await r.stop();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

test('старые копии удаляются, свежие остаются; файл копируется один раз', async () => {
  const dataDir = temp('keep');
  const backupDir = temp('keep-backup');
  const s = await startServer({ dataDir });
  await s.stop({ keepData: true });
  const stale = path.join(backupDir, 'sozvon-20000101-0000.db');
  fs.writeFileSync(stale, 'старьё');
  fs.utimesSync(stale, new Date(2000, 0, 1), new Date(2000, 0, 1));
  runBackup(dataDir, backupDir);
  const names = fs.readdirSync(backupDir).filter((n) => n.endsWith('.db'));
  assert.equal(names.length, 1);
  assert.notEqual(names[0], path.basename(stale));
});
