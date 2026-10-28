const { contextBridge, ipcRenderer } = require('electron');

// Небольшой мост между страницей и Windows: горячие клавиши и привлечение внимания к окну
contextBridge.exposeInMainWorld('desktop', {
  onHotkey: (callback) => ipcRenderer.on('hotkey', (_event, name) => callback(name)),
  attention: () => ipcRenderer.send('attention'),
  focus: () => ipcRenderer.send('focus'),
  // Давно не трогали мышь и клавиатуру (true) или вернулись (false) — для статуса «Неактивен»
  onIdle: (callback) => ipcRenderer.on('idle', (_event, idle) => callback(idle)),
  oauth: (authUrl) => ipcRenderer.invoke('oauth', authUrl),
  screen: {
    sources: () => ipcRenderer.invoke('screen:sources'),
    choose: (id, audio) => ipcRenderer.invoke('screen:choose', id, audio),
  },
  // Рация: включить на клавише (или выключить — null), назначить клавишу, имена клавиш, нажата/отпущена
  ptt: {
    set: (binding) => ipcRenderer.invoke('ptt:set', binding),
    capture: () => ipcRenderer.invoke('ptt:capture'),
    names: () => ipcRenderer.invoke('ptt:names'),
    onChange: (callback) => ipcRenderer.on('ptt', (_event, down) => callback(down)),
  },
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    onStatus: (callback) => ipcRenderer.on('update', (_event, status) => callback(status)),
    check: () => ipcRenderer.send('update:check'),
    download: () => ipcRenderer.send('update:download'),
    install: () => ipcRenderer.send('update:install'),
  },
});
