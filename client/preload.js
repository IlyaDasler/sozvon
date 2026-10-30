const { contextBridge, ipcRenderer, sharedTexture } = require('electron');

// Свой захват монитора (screen-native.js): кадр приходит общей текстурой видеокарты, отдаём его странице
// как VideoFrame — там из кадров собирается дорожка трансляции
sharedTexture?.setSharedTextureReceiver(async ({ importedSharedTexture }) => {
  const frame = importedSharedTexture.getVideoFrame();
  window.postMessage({ sozvonScreenFrame: frame }, '*', [frame]);
  importedSharedTexture.release();
});

// Небольшой мост между страницей и Windows: горячие клавиши и привлечение внимания к окну
contextBridge.exposeInMainWorld('desktop', {
  onHotkey: (callback) => ipcRenderer.on('hotkey', (_event, name) => callback(name)),
  attention: () => ipcRenderer.send('attention'),
  focus: () => ipcRenderer.send('focus'),
  // Цвета кнопок окна под тему: { color, symbolColor } в виде #rrggbb
  titleBar: (colors) => ipcRenderer.send('window:titlebar', colors),
  // Давно не трогали мышь и клавиатуру (true) или вернулись (false) — для статуса «Неактивен»
  onIdle: (callback) => ipcRenderer.on('idle', (_event, idle) => callback(idle)),
  oauth: (authUrl) => ipcRenderer.invoke('oauth', authUrl),
  // Буфер обмена и правка текста (вырезать, вставить…) — средствами Electron, они надёжнее браузерных
  copy: (text) => ipcRenderer.invoke('clipboard:write', String(text)),
  vault: {
    seal: (text) => ipcRenderer.sendSync('vault:seal', String(text)),
    open: (sealed) => ipcRenderer.sendSync('vault:open', String(sealed)),
  },
  // Превью ссылки: { url, title, description, image, siteName } или null
  preview: (url) => ipcRenderer.invoke('preview:fetch', String(url)),
  edit: (command) => ipcRenderer.send('edit', command),
  screen: {
    sources: () => ipcRenderer.invoke('screen:sources'),
    choose: (id, audio) => ipcRenderer.invoke('screen:choose', id, audio),
    // Свой захват выбранного монитора: { width, height } или null — тогда снимаем через Chromium
    nativeStart: (mode) => ipcRenderer.invoke('screen:native-start', mode),
    nativeStop: (id) => ipcRenderer.invoke('screen:native-stop', id),
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
