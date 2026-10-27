const { contextBridge, ipcRenderer } = require('electron');

// Небольшой мост между страницей и Windows: горячие клавиши и привлечение внимания к окну
contextBridge.exposeInMainWorld('desktop', {
  onHotkey: (callback) => ipcRenderer.on('hotkey', (_event, name) => callback(name)),
  attention: () => ipcRenderer.send('attention'),
  focus: () => ipcRenderer.send('focus'),
  oauth: (authUrl) => ipcRenderer.invoke('oauth', authUrl),
  screen: {
    sources: () => ipcRenderer.invoke('screen:sources'),
    choose: (id, audio) => ipcRenderer.invoke('screen:choose', id, audio),
  },
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    onStatus: (callback) => ipcRenderer.on('update', (_event, status) => callback(status)),
    check: () => ipcRenderer.send('update:check'),
    download: () => ipcRenderer.send('update:download'),
    install: () => ipcRenderer.send('update:install'),
  },
});
