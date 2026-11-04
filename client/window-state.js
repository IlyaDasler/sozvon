// Размер, место и «развёрнуто» главного окна — запоминаем при изменении, возвращаем при запуске.
// Возвращаем, только если полоса окна (за неё его двигают) видна на одном из экранов: монитор могли отключить.

const fs = require('node:fs');

// Windows прибавляет к клиентским bounds рамку/тень окна; без запаса правый край
// с кнопками «свернуть/развернуть/закрыть» уезжает за экран.
const EDGE = process.platform === 'win32' ? 10 : 0;

const isNum = (v) => Number.isFinite(v);

/** Что вернуть окну: { x, y, width, height, maximized } или null — окно по умолчанию */
function restoreBounds(saved, workAreas, min) {
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(isNum)) return null;
  if (!Array.isArray(workAreas) || !workAreas.length) return null;
  const bounds = {
    x: Math.round(saved.x),
    y: Math.round(saved.y),
    width: Math.max(min.width, Math.round(saved.width)),
    height: Math.max(min.height, Math.round(saved.height)),
    maximized: saved.maximized === true,
  };
  // Берём экран с наибольшим пересечением и держим окно целиком в его рабочей области.
  // Иначе сохранённое окно шире монитора оставляет кнопки окна за краем экрана.
  const area = workAreas
    .map((a) => ({
      a,
      overlap: Math.max(0, Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x)) *
        Math.max(0, Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y)),
    }))
    .sort((p, q) => q.overlap - p.overlap)[0].a;
  const width = Math.min(bounds.width, Math.max(min.width, area.width - EDGE * 2));
  const height = Math.min(bounds.height, Math.max(min.height, area.height - EDGE * 2));
  const x = Math.min(Math.max(bounds.x, area.x + EDGE), Math.max(area.x + EDGE, area.x + area.width - EDGE - width));
  const y = Math.min(Math.max(bounds.y, area.y + EDGE), Math.max(area.y + EDGE, area.y + area.height - EDGE - height));
  return { x, y, width, height, maximized: bounds.maximized };
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
