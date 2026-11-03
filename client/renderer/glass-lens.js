// Настоящая линза для стекла: карта смещения на canvas + feImage/feDisplacementMap.
// Слой линзы лежит ПОД содержимым (z-index: -1) и НАД фоном поверхности,
// поэтому текст остаётся резким, а фон под кромкой преломляется.
(() => {
  const SURFACES = '.modal-card, .popup-menu, .chat-theme-pop, .profile-card, .notif-panel, .toast, .gif-popover';
  const MAX_SIDE = 900;
  const BEZEL_RATIO = 0.055;
  const MIN_BEZEL = 10;
  const MAX_BEZEL = 34;

  const supported =
    typeof CSS !== 'undefined' &&
    (CSS.supports('backdrop-filter', 'url(#x)') || CSS.supports('-webkit-backdrop-filter', 'url(#x)'));

  if (!supported) {
    document.documentElement.dataset.lens = 'off';
    return;
  }
  document.documentElement.dataset.lens = 'on';

  const maps = new Map(); // ключ → id фильтра
  const observed = new WeakMap();
  const timers = new WeakMap();

  let svg = null;
  function registry() {
    if (svg) return svg;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.id = 'lens-filters';
    svg.append(defs);
    document.body.append(svg);
    return svg;
  }

  function roundedRectSdf(px, py, halfW, halfH, radius) {
    const qx = Math.abs(px) - (halfW - radius);
    const qy = Math.abs(py) - (halfH - radius);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  }

  // Карта: R — смещение по X, G — по Y (128 = ноль), A — 255. У кромки вектор к кромке.
  function buildMap(width, height, radius, bezel) {
    const scale = width > 320 ? 0.5 : 1;
    const w = Math.max(24, Math.round(width * scale));
    const h = Math.max(24, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(w, h);
    const data = image.data;
    const halfW = w / 2;
    const halfH = h / 2;
    const r = Math.max(2, radius * scale);
    const b = Math.max(4, bezel * scale);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x - halfW;
        const py = y - halfH;
        const d = roundedRectSdf(px, py, halfW, halfH, r);
        const e = 0.75;
        const nx = roundedRectSdf(px + e, py, halfW, halfH, r) - roundedRectSdf(px - e, py, halfW, halfH, r);
        const ny = roundedRectSdf(px, py + e, halfW, halfH, r) - roundedRectSdf(px, py - e, halfW, halfH, r);
        const len = Math.hypot(nx, ny) || 1;
        const t = Math.min(1, Math.max(0, 1 + d / b));
        const bend = t * t * (3 - 2 * t);
        const index = (y * w + x) * 4;
        data[index] = Math.round((-nx / len) * bend * 127 + 128);
        data[index + 1] = Math.round((-ny / len) * bend * 127 + 128);
        data[index + 2] = 128;
        data[index + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  function filterFor(width, height, radius, bezel) {
    const key = `${width}x${height}-${Math.round(radius)}-${Math.round(bezel)}`;
    if (maps.has(key)) return maps.get(key);
    const map = buildMap(width, height, radius, bezel);
    const id = 'lens-' + key.replace(/[^a-z0-9-]/gi, '');
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', '100%');
    filter.setAttribute('height', '100%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
    image.setAttribute('href', map.toDataURL('image/png'));
    image.setAttribute('x', '0');
    image.setAttribute('y', '0');
    image.setAttribute('width', String(width));
    image.setAttribute('height', String(height));
    image.setAttribute('result', 'map');
    const displace = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    displace.setAttribute('in', 'SourceGraphic');
    displace.setAttribute('in2', 'map');
    displace.setAttribute('scale', String(Math.round(bezel * 1.35)));
    displace.setAttribute('xChannelSelector', 'R');
    displace.setAttribute('yChannelSelector', 'G');
    filter.append(image, displace);
    registry().querySelector('defs').append(filter);
    maps.set(key, id);
    return id;
  }

  function reducedTransparency() {
    return window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
  }

  function apply(element) {
    if (!element || !element.getClientRects().length) return;
    if (document.documentElement.dataset.theme !== 'glass') return;
    if (reducedTransparency()) return;

    const width = Math.min(MAX_SIDE, element.offsetWidth);
    const height = Math.min(MAX_SIDE, element.offsetHeight);
    if (width < 40 || height < 24) return;

    const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 14;
    const bezel = Math.min(MAX_BEZEL, Math.max(MIN_BEZEL, Math.round(Math.min(width, height) * BEZEL_RATIO)));

    element.classList.add('lens-surface');
    let layer = element.querySelector(':scope > .lens-layer');
    if (!layer) {
      layer = document.createElement('span');
      layer.className = 'lens-layer';
      layer.setAttribute('aria-hidden', 'true');
      element.prepend(layer);
    }
    const id = filterFor(width, height, radius, bezel);
    const value = `url(#${id})`;
    if (layer.style.backdropFilter !== value) {
      layer.style.backdropFilter = value;
      layer.style.webkitBackdropFilter = value;
    }

    if (!observed.has(element)) {
      observed.set(element, true);
      const observer = new ResizeObserver(() => {
        clearTimeout(timers.get(element));
        timers.set(element, setTimeout(() => apply(element), 140));
      });
      observer.observe(element);
    }
  }

  function applyAll() {
    if (document.documentElement.dataset.theme !== 'glass') {
      for (const layer of document.querySelectorAll('.lens-layer')) layer.remove();
      for (const el of document.querySelectorAll('.lens-surface')) el.classList.remove('lens-surface');
      return;
    }
    for (const element of document.querySelectorAll(SURFACES)) apply(element);
  }

  // Поверхности появляются и скрываются классами — пересчитываем после изменений
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyAll();
    });
  };

  new MutationObserver(schedule).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  document.addEventListener('click', schedule, true);
  window.addEventListener('resize', schedule, { passive: true });
  applyAll();
  setTimeout(applyAll, 600);
})();
