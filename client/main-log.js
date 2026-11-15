const fs = require('node:fs');
const guardedWrite = Symbol.for('sozvon.mainLog.guardedWrite');

function writeMainError(logPath, context, error) {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} [${context}] ${detail}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function guardConsoleStream(stream, report = () => {}) {
  if (!stream || typeof stream.on !== 'function') return false;
  if (typeof stream.write === 'function' && !stream[guardedWrite]) {
    const write = stream.write;
    stream.write = function guardedConsoleWrite(...args) {
      try {
        return write.apply(this, args);
      } catch (error) {
        if (error?.code === 'EPIPE') return false;
        throw error;
      }
    };
    stream[guardedWrite] = true;
  }
  stream.on('error', (error) => {
    if (error?.code === 'EPIPE') return;
    try {
      report(error);
    } catch {}
  });
  return true;
}

module.exports = { guardConsoleStream, writeMainError };
