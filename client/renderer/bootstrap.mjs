// Единственная точка входа renderer: сначала ES-модули (state/api), затем
// классические файлы в прежнем порядке. Это позволяет держать state в модуле.
window.__bootstrapPending = true;
import { state, store } from './state.mjs';
import { Api, ServerSocket } from './api.mjs';
import './room-utils.mjs';
import './update-bar.mjs';

Object.assign(window, { state, store, Api, ServerSocket });

const SCRIPTS = ["liquid-tabs.js", "glass-tabs.js", "glass-daypart.js", "threads.js", "games.js", "window-controls.js", "glass-select.js", "glass-controls.js", "glass-drawer.js", "preview-card.js", "combobox.js", "tooltips.js", "markdown.js", "call-code.js", "call.js", "vendor/livekit-client.umd.js", "sfu.js", "privacy.js", "app.js", "ptt-keys.js", "voice-ui.js", "rooms.js", "stream-peek.js", "room-settings.js", "rail-layout.js", "hubs.js", "friends.js", "notifications.js", "composer.js", "mascot.js", "sounds.js", "gifs.js", "chat-theme.js", "history.js", "typing.js", "devices.js", "vendor/qrcode.js", "two-factor.js", "chat-content.js", "e2ee-crypto.js", "e2ee.js", "appearance.js", "profile-card.js", "ptt-ui.js", "panel-sizes.js", "context-menu.js", "dialog.js", "crop-math.js", "crop.js", "layers.js", "nav.js"];

function load(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Не загрузился ' + src));
    document.body.append(script);
  });
}

for (const src of SCRIPTS) await load(src);
window.__bootstrapPending = false;
if (typeof boot === 'function') await boot();
