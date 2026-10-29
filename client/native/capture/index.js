// Нативный захват экрана, если модуль собран (Windows); иначе null — трансляция идёт обычным захватом Chromium
let addon = null;
try {
  addon = require('./build/Release/sozvon_capture.node');
} catch {
  addon = null;
}
module.exports = addon;
