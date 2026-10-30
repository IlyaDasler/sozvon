// Картинка в буфер обмена: страница присылает её готовым PNG (расшифровать может только она).
const { clipboard, ClipboardItem, ipcMain } = require('electron');

function registerClipboardImage() {
  ipcMain.handle('clipboard:image', async (_event, dataUrl) => {
    const [, base64] = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl)) || [];
    if (!base64) throw new Error('Не картинка');
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(base64, 'base64')], { type: 'image/png' }) })]);
  });
}

module.exports = { registerClipboardImage };
