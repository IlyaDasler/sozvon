const fs = require('node:fs');
const guardedWrite = Symbol.for('sozvon.mainLog.guardedWrite');
const guardedConsoleMethods = Symbol.for('sozvon.mainLog.guardedConsoleMethods');

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

function guardConsoleMethods(consoleObject, methods = ['log', 'info', 'warn', 'error', 'debug'], report = () => {}) {
  if (!consoleObject || typeof consoleObject !== 'object') return false;
  const guarded = consoleObject[guardedConsoleMethods] || new Set();
  for (const method of methods) {
    const original = consoleObject[method];
    if (typeof original !== 'function' || guarded.has(method)) continue;
    let epipeReported = false;
    consoleObject[method] = function guardedConsoleMethod(...args) {
      try {
        return original.apply(this, args);
      } catch (error) {
        if (error?.code !== 'EPIPE') throw error;
        if (!epipeReported) {
          epipeReported = true;
          try { report(error, method); } catch {}
        }
        return undefined;
      }
    };
    guarded.add(method);
  }
  consoleObject[guardedConsoleMethods] = guarded;
  return true;
}

module.exports = { guardConsoleMethods, guardConsoleStream, writeMainError };
