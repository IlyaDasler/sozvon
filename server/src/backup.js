// Резервная копия: база целиком (на ходу, сервер останавливать не нужно), аватарки и вложения. Запускает таймер раз
// в сутки (deploy/vps/setup.sh). Копия проверяется сразу: число записей совпадает, база читается без ошибок.
// BACKUP_DIR — куда класть, BACKUP_KEEP_DAYS — сколько дней хранить.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const DAY_MS = 24 * 60 * 60_000;
const CHECKED_TABLES = ['users', 'messages', 'room_messages', 'uploads'];

const countRows = (db) => Object.fromEntries(CHECKED_TABLES.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));

function copyDatabase(backupDir) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const target = path.join(backupDir, `sozvon-${stamp}.db`);
  fs.rmSync(target, { force: true });
  const source = new DatabaseSync(path.join(config.dataDir, 'sozvon.db'));
  source.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  const live = countRows(source);
  source.close();

  const copy = new DatabaseSync(target, { readOnly: true });
  const check = copy.prepare('PRAGMA integrity_check').get().integrity_check;
  const saved = countRows(copy);
  copy.close();
  if (check !== 'ok') throw new Error(`Копия базы повреждена: ${check}`);
  for (const table of CHECKED_TABLES)
    if (saved[table] < live[table]) throw new Error(`В копии меньше строк в ${table}: ${saved[table]} из ${live[table]}`);
  return target;
}

/** Файлы не меняются (имя — случайный id), поэтому копируем только новые */
function copyNewFiles(backupDir, folder) {
  const from = path.join(config.dataDir, folder);
  const to = path.join(backupDir, folder);
  fs.mkdirSync(to, { recursive: true });
  if (!fs.existsSync(from)) return 0;
  let copied = 0;
  for (const name of fs.readdirSync(from)) {
    if (fs.existsSync(path.join(to, name))) continue;
    fs.copyFileSync(path.join(from, name), path.join(to, name));
    copied++;
  }
  return copied;
}

/** Старые копии базы и файлы, которых больше нет на сервере и которые вышли из срока хранения */
function dropOld(backupDir, keepDays) {
  const limit = Date.now() - keepDays * DAY_MS;
  const old = (file) => fs.statSync(file).mtimeMs < limit;
  for (const name of fs.readdirSync(backupDir)) {
    const file = path.join(backupDir, name);
    if (/^sozvon-.*\.db$/.test(name) && old(file)) fs.rmSync(file);
  }
  for (const folder of ['files', 'avatars']) {
    const copies = path.join(backupDir, folder);
    for (const name of fs.readdirSync(copies)) {
      const file = path.join(copies, name);
      if (!fs.existsSync(path.join(config.dataDir, folder, name)) && old(file)) fs.rmSync(file);
    }
  }
}

const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(config.dataDir, '..', 'sozvon-backups'));
const keepDays = Number(process.env.BACKUP_KEEP_DAYS) || 14;

fs.mkdirSync(backupDir, { recursive: true });
const database = copyDatabase(backupDir);
const copied = copyNewFiles(backupDir, 'files') + copyNewFiles(backupDir, 'avatars');
dropOld(backupDir, keepDays);
console.log(`Резервная копия готова: ${database}, новых файлов: ${copied}`);
