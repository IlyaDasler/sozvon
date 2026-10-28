// Рация (push-to-talk) в главном процессе: держите назначенную клавишу или боковую кнопку мыши — микрофон
// включён, отпустили — выключен. Работает и когда в фокусе игра: для этого нужен глобальный перехват
// клавиатуры и мыши (uiohook-napi). Перехват включается, только пока рация включена или назначают клавишу;
// смотрим только на назначенную клавишу — ничего не записывается и никуда не отправляется.
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { bindingFrom, matches } = require('./renderer/ptt-keys');

// Коды клавиш → имена, чтобы в настройках было «Пробел», а не «57»
const KEY_NAMES = Object.fromEntries(Object.entries(UiohookKey).map(([name, code]) => [code, name]));
const ESCAPE = UiohookKey.Escape;

let binding = null;
let pressed = false;
let onChange = () => {};
let capturing = null; // ждём нажатия, чтобы назначить клавишу: resolve(binding | null)
let running = false;

function setPressed(down) {
  if (pressed === down) return;
  pressed = down;
  onChange(down);
}

const keyEvent = (e) => ({ kind: 'key', keycode: e.keycode });
const mouseEvent = (e) => ({ kind: 'mouse', button: e.button });

function onDown(event) {
  if (capturing) {
    // Esc — передумали назначать
    if (event.kind === 'key' && event.keycode === ESCAPE) return finishCapture(null);
    const b = bindingFrom(event);
    if (b) finishCapture(b);
    return;
  }
  if (matches(binding, event)) setPressed(true);
}

function onUp(event) {
  if (matches(binding, event)) setPressed(false);
}

uIOhook.on('keydown', (e) => onDown(keyEvent(e)));
uIOhook.on('keyup', (e) => onUp(keyEvent(e)));
uIOhook.on('mousedown', (e) => onDown(mouseEvent(e)));
uIOhook.on('mouseup', (e) => onUp(mouseEvent(e)));

// Перехват работает, только пока он нужен
function sync() {
  const need = Boolean(binding || capturing);
  if (need && !running) uIOhook.start();
  if (!need && running) uIOhook.stop();
  running = need;
}

function finishCapture(result) {
  const done = capturing;
  capturing = null;
  sync();
  done?.(result);
}

module.exports = {
  KEY_NAMES,

  /** Включить рацию на этой клавише (или выключить — null). changed(down) — нажали или отпустили */
  configure(next, changed) {
    binding = next;
    onChange = changed;
    if (!binding) setPressed(false);
    sync();
  },

  /** Ждём следующее нажатие клавиши или боковой кнопки мыши и возвращаем привязку (Esc — null) */
  capture() {
    if (capturing) finishCapture(null);
    return new Promise((resolve) => {
      capturing = resolve;
      sync();
    });
  },

  stop() {
    binding = null;
    if (capturing) finishCapture(null);
    if (running) uIOhook.stop();
    running = false;
  },
};
