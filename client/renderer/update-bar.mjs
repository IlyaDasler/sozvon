// Геометрия плашки обновления. ES-модуль, чтобы расчёт можно было тестировать
// отдельно от 140-килобайтного app.js.
/**
 * @typedef {{left:number,width:number}} Box
 * @typedef {{left:number,width:number,radius:string}} UpdateBarBox
 */

/**
 * Возвращает левый край, ширину и радиус плашки.
 * Панель «В голосе» важнее сайдбара: она уже учитывает все отступы.
 * @param {Box|null} voice
 * @param {Box|null} sidebar
 * @param {string} fallbackRadius
 * @returns {UpdateBarBox|null}
 */
export function updateBarBox(voice, sidebar, fallbackRadius = '14px') {
  if (voice && voice.width > 0) {
    return { left: voice.left, width: voice.width, radius: '15px' };
  }
  if (sidebar && sidebar.width > 16) {
    return { left: sidebar.left + 8, width: sidebar.width - 16, radius: fallbackRadius };
  }
  return null;
}

/** @param {Document} [doc] */
export function placeUpdateBar(doc = document) {
  const bar = doc.getElementById('update-bar');
  if (!bar) return;
  const voice = doc.getElementById('voice-panel');
  const sidebar = doc.querySelector('.sidebar');
  const voiceRect = voice && voice.getClientRects().length ? voice.getBoundingClientRect() : null;
  const sidebarRect = sidebar && sidebar.getClientRects().length ? sidebar.getBoundingClientRect() : null;
  const radius =
    voiceRect && voice
      ? getComputedStyle(voice).borderRadius
      : getComputedStyle(doc.documentElement).getPropertyValue('--r-l').trim() || '14px';
  const box = updateBarBox(voiceRect, sidebarRect, radius);
  if (!box) return;
  bar.style.left = `${Math.round(box.left)}px`;
  bar.style.width = `${Math.round(box.width)}px`;
  bar.style.borderRadius = voiceRect ? radius : box.radius;
}

if (typeof window !== 'undefined') {
  window.UpdateBar = { place: placeUpdateBar, box: updateBarBox };
}

if (typeof window !== 'undefined') requestAnimationFrame(() => placeUpdateBar());
