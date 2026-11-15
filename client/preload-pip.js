'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktop', {
  pip: {
    close: () => ipcRenderer.send('pip:close'),
    onFrame: (callback) => subscribe('pip:frame', callback),
    onTitle: (callback) => subscribe('pip:title', callback),
  },
});
