// Размер, место и «развёрнуто» главного окна — запоминаем при изменении, возвращаем при запуске.
// Возвращаем, только если полоса окна (за неё его двигают) видна на одном из экранов: монитор могли отключить.

const fs = require('node:fs');

const GRIP = { width: 120, height: 32 }; // сколько полосы окна должно быть на экране, чтобы его можно было ухватить

const isNum = (v) => Number.isFinite(v);

/** Что вернуть окну: { x, y, width, height, maximized } или null — окно по умолчанию */
function restoreBounds(saved, workAreas, min) {
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(isNum)) return null;
  const bounds = {
    x: Math.round(saved.x),
    y: Math.round(saved.y),
    width: Math.max(min.width, Math.round(saved.width)),
    height: Math.max(min.height, Math.round(saved.height)),
    maximized: saved.maximized === true,
  };
  const grabbable = workAreas.some((a) => {
    const w = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    return w >= GRIP.width && bounds.y >= a.y && bounds.y + GRIP.height <= a.y + a.height;
  });
  return grabbable ? bounds : null;
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Следим за окном и пишем его состояние (не чаще раза в полсекунды); у развёрнутого храним обычный размер */
function trackWindow(win, file) {
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
      const b = win.getNormalBounds();
      try {
        fs.writeFileSync(file, JSON.stringify({ ...b, maximized: win.isMaximized() }));
      } catch {}
    }, 500);
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) win.on(event, save);
}

module.exports = { restoreBounds, readState, trackWindow };
