// Какой квадрат картинки показан в окне выбора области. Только расчёты, без окна. view: { width, height, zoom, cx, cy } —
// размер картинки, увеличение (1 — короткая сторона целиком) и центр квадрата в пикселях картинки.

const CROP_MAX_ZOOM = 4;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Сначала показываем середину картинки целиком по короткой стороне */
const startCrop = (width, height) => ({ width, height, zoom: 1, cx: width / 2, cy: height / 2 });

/** Квадрат в пикселях картинки; за края не выходит, как бы ни двигали */
function cropRect({ width, height, zoom, cx, cy }) {
  const side = Math.min(width, height) / zoom;
  return { x: clamp(cx - side / 2, 0, width - side), y: clamp(cy - side / 2, 0, height - side), side };
}

/** Центр по квадрату, который реально показан: иначе лишний сдвиг за край «копился» бы и картинка не сразу шла обратно */
function settleCrop(view) {
  const { x, y, side } = cropRect(view);
  return { ...view, cx: x + side / 2, cy: y + side / 2 };
}

/** Потянули картинку на dx, dy точек окна размером stage: картинка едет за рукой, квадрат — навстречу */
function panCrop(view, dx, dy, stage) {
  const scale = cropRect(view).side / stage;
  return settleCrop({ ...view, cx: view.cx - dx * scale, cy: view.cy - dy * scale });
}

function zoomCrop(view, zoom) {
  return settleCrop({ ...view, zoom: clamp(zoom, 1, CROP_MAX_ZOOM) });
}

if (typeof module !== 'undefined') module.exports = { CROP_MAX_ZOOM, cropRect, panCrop, startCrop, zoomCrop };
