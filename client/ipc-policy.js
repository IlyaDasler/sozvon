'use strict';

const { isTrustedLocalNavigation } = require('./navigation-policy');

/** Accept IPC only from the expected top-level, packaged renderer document. */
function isTrustedIpcEvent(event, contents, trustedEntry) {
  try {
    if (!contents || contents.isDestroyed?.() || event?.sender !== contents) return false;
    const frame = event.senderFrame;
    return Boolean(frame && frame === contents.mainFrame && isTrustedLocalNavigation(frame.url, trustedEntry));
  } catch {
    return false;
  }
}

/** Small allowlisted facade: app IPC handlers reject calls from every other WebContents/frame. */
function trustedIpcMain(ipcMain, isTrustedSender) {
  return Object.freeze({
    on(channel, listener) {
      ipcMain.on(channel, (event, ...args) => {
        if (isTrustedSender(event)) return listener(event, ...args);
      });
    },
    handle(channel, listener) {
      ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
        return listener(event, ...args);
      });
    },
  });
}

module.exports = { isTrustedIpcEvent, trustedIpcMain };
