const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Console } = require('node:console');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { guardConsoleStream, writeMainError } = require('../main-log');

test('a closed GUI console pipe does not become an uncaught EPIPE', () => {
  const stream = new EventEmitter();
  stream.write = () => { throw Object.assign(new Error('closed'), { code: 'EPIPE' }); };
  const logger = new Console({ stdout: stream, stderr: stream, ignoreErrors: false });
  const reported = [];
  assert.equal(guardConsoleStream(stream, (error) => reported.push(error)), true);
  assert.doesNotThrow(() => logger.warn('safeStorage warning'));
  assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error('closed'), { code: 'EPIPE' })));
  assert.equal(reported.length, 0);
});

test('unexpected console stream errors are sent to the app log reporter', () => {
  const stream = new EventEmitter();
  const reported = [];
  guardConsoleStream(stream, (error) => reported.push(error));
  const failure = Object.assign(new Error('disk issue'), { code: 'EIO' });
  stream.emit('error', failure);
  assert.deepEqual(reported, [failure]);
});

test('main process errors can be written without using stderr', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-main-log-'));
  const logFile = path.join(dir, 'main.log');
  try {
    assert.equal(writeMainError(logFile, 'startup', new Error('device unavailable')), true);
    assert.match(fs.readFileSync(logFile, 'utf8'), /\[startup\].*device unavailable/s);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
