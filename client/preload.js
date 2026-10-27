const { contextBridge, ipcRenderer } = require('electron');

// Небольшой мост между страницей и Windows: горячие клавиши и привлечение внимания к окну
contextBridge.exposeInMainWorld('desktop', {
  onHotkey: (callback) => ipcRenderer.on('hotkey', (_event, name) => callback(name)),
  attention: () => ipcRenderer.send('attention'),
  focus: () => ipcRenderer.send('focus'),
  oauth: (authUrl) => ipcRenderer.invoke('oauth', authUrl),
});
