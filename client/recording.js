// Локальная запись звонка: файл пишется на компьютер человека, который нажал «Записать».
// Сервер не получает ни аудио, ни файл. Только main-процесс открывает файл по диалогу.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, ipcMain } = require('electron');

const sessions = new Map();

function safeName(value) {
  const base = String(value || 'Созвон')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || 'Созвон';
}

function timestamp() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}-${two(d.getMinutes())}`;
}

function defaultDir() {
  if (process.env.SOZVON_RECORDING_DIR) return process.env.SOZVON_RECORDING_DIR;
  try {
    return app.getPath('videos');
  } catch {
    return app.getPath('documents');
  }
}

function registerRecording() {
  ipcMain.handle('recording:start', async (event, requestedName) => {
    const win = event.sender?.getOwnerBrowserWindow?.();
    const filename = `Созвон-${timestamp()}-${safeName(requestedName)}.webm`;
    let filePath = '';
    if (process.env.SOZVON_RECORDING_DIR) {
      fs.mkdirSync(process.env.SOZVON_RECORDING_DIR, { recursive: true });
      filePath = path.join(process.env.SOZVON_RECORDING_DIR, filename);
    } else {
      const result = await dialog.showSaveDialog(win, {
        title: 'Сохранить запись звонка',
        defaultPath: path.join(defaultDir(), filename),
        filters: [{ name: 'Аудиозапись', extensions: ['webm'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return null;
      filePath = result.filePath;
    }

    const id = crypto.randomUUID();
    const stream = fs.createWriteStream(filePath);
    const session = { id, filePath, stream, bytes: 0, closed: false };
    sessions.set(id, session);
    stream.on('error', () => {
      session.closed = true;
      sessions.delete(id);
    });
    return { id, filePath };
  });

  ipcMain.on('recording:chunk', (_event, id, data) => {
    const session = sessions.get(id);
    if (!session || session.closed) return;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    session.bytes += chunk.length;
    session.stream.write(chunk);
  });

  ipcMain.handle('recording:flush', async (_event, id) => {
    const session = sessions.get(id);
    if (!session) return false;
    await new Promise((resolve) => {
      if (!session.stream.writableLength) return resolve();
      session.stream.once('drain', resolve);
    });
    return true;
  });

  ipcMain.handle('recording:stop', async (_event, id) => {
    const session = sessions.get(id);
    if (!session) return null;
    sessions.delete(id);
    session.closed = true;
    await new Promise((resolve) => {
      session.stream.end(() => resolve());
    });
    let size = session.bytes;
    try {
      size = fs.statSync(session.filePath).size;
    } catch {}
    return { filePath: session.filePath, size };
  });

  ipcMain.handle('recording:reveal', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) return false;
    const { shell } = require('electron');
    shell.showItemInFolder(filePath);
    return true;
  });
}

module.exports = { registerRecording };
