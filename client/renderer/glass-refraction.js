// Жидкое стекло: не полупрозрачная заливка, а линза.
//
// У поверхности две части оптики:
//   1. displacement-карта по кромке — canvas считает SDF скруглённого прямоугольника,
//      глубину и нормаль; feDisplacementMap сдвигает фон к центру на краю (Chromium);
//   2. спекуляр — запечённая PNG-кромка: свет сверху/снизу и тонкая тень по бокам.
//
// Фильтры живут в одном постоянном <svg>, карты кэшируются по размеру и геометрии,
// а включаем мы их только после декодирования PNG, чтобы стекло не теряло blur
// на первых кадрах. Всё это — надстройка над существующей темой, без переписывания
// разметки: поверхности получают класс lg-surface и переменные --lg-*.

(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FILTER_LIMIT = 32;
  const IMAGE_LIMIT = 48;

  // Сколько и как сильно линзит конкретная поверхность. Blur/сатурация — те же,
  // что были в теме, чтобы новая оптика не меняла характер материала.
  const SURFACES = [
    { selector: '.main', bezel: 50, refraction: 80, blur: 3, saturate: 150, brightness: 1.04, dispersion: 0.035 },
    { selector: '.modal-card', bezel: 34, refraction: 46, blur: 4, saturate: 165, brightness: 1.04, dispersion: 0.03 },
    { selector: '.profile-card', bezel: 32, refraction: 42, blur: 4, saturate: 165, brightness: 1.04, dispersion: 0.028 },
    { selector: '.popup-menu', bezel: 24, refraction: 30, blur: 4, saturate: 165, brightness: 1.04 },
    { selector: '.thread-panel', bezel: 26, refraction: 28, blur: 4, saturate: 160, brightness: 1.04 },
    { selector: '.notif-panel', bezel: 26, refraction: 28, blur: 4, saturate: 160, brightness: 1.04 },
    { selector: '.toast', bezel: 16, refraction: 12, blur: 20, saturate: 180, brightness: 1.04 },
    { selector: '.gif-popover', bezel: 20, refraction: 16, blur: 22, saturate: 180, brightness: 1.04 },
    { selector: '.chat-theme-pop', bezel: 20, refraction: 16, blur: 22, saturate: 180, brightness: 1.04 },
  ];

  function addAurora() {
    if (document.querySelector('.lg-aurora')) return;
    const layer = document.createElement('div');
    layer.className = 'lg-aurora';
    layer.setAttribute('aria-hidden', 'true');
    document.body.prepend(layer);
  }
  addAurora();
  const supportsRefraction = (() => {
    if (typeof CSS === 'undefined' || !CSS.supports('backdrop-filter', 'blur(1px)')) return false;
    const probe = document.createElement('div');
    probe.style.backdropFilter = 'url(#lg-probe)';
    return Boolean(probe.style.backdropFilter && probe.style.backdropFilter.includes('url('));
  })();

  // Пользователь попросил меньше прозрачности — оставляем обычное стекло темы.
  if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches) {
    document.documentElement.dataset.refract = 'off';
    return;
  }

  if (!supportsRefraction) {
    document.documentElement.dataset.refract = 'off';
    return;
  }
  document.documentElement.classList.add('lg-refract');
  document.documentElement.dataset.refract = 'on';

  // ---------- геометрия ----------

  const sat = (value) => Math.max(0, Math.min(1, value));
  const cache = new Map();

  function surfaceField(px, py, halfW, halfH, radius, out) {
    const qx = Math.abs(px) - (halfW - radius);
    const qy = Math.abs(py) - (halfH - radius);
    if (qx > 0 && qy > 0) {
      const length = Math.hypot(qx, qy) || 1;
      out.sd = length - radius;
      out.nx = (Math.sign(px) * qx) / length;
      out.ny = (Math.sign(py) * qy) / length;
    } else if (qx > qy) {
      out.sd = qx - radius;
      out.nx = Math.sign(px);
      out.ny = 0;
    } else {
      out.sd = qy - radius;
      out.nx = 0;
      out.ny = Math.sign(py);
    }
  }

  // Профиль выпуклой линзы: на кромке сильнее, к середине беззеля сходит на нет.
  function makeProfile() {
    const size = 128;
    const mag = new Float32Array(size);
    const n = 1.5;
    const thickness = 0.62;
    const height = (t) => Math.sqrt(1 - (1 - t) * (1 - t));
    const eps = 1 / 2048;
    let max = 0;
    for (let i = 0; i < size; i++) {
      const t = Math.max(i / (size - 1), eps);
      const hi = Math.min(t + eps, 1);
      const lo = Math.max(t - eps, 0);
      const slope = ((height(hi) - height(lo)) / (hi - lo)) * thickness;
      const incident = Math.atan(Math.abs(slope));
      const delta = incident - Math.asin(Math.sin(incident) / n);
      mag[i] = height(t) * thickness * Math.tan(delta);
      max = Math.max(max, mag[i]);
    }
    if (max > 0) for (let i = 0; i < size; i++) mag[i] /= max;
    return mag;
  }

  const profile = makeProfile();

  function makeImages(width, height, radius, bezel) {
    const scale = width * height > 32000 ? 0.5 : 1;
    const w = Math.max(2, Math.ceil(width * scale));
    const h = Math.max(2, Math.ceil(height * scale));
    const r = Math.min(radius * scale, w / 2, h / 2);
    const b = Math.max(1, Math.min(bezel * scale, Math.min(w, h) / 2));
    const halfW = w / 2;
    const halfH = h / 2;

    const map = document.createElement('canvas');
    map.width = w;
    map.height = h;
    const mapCtx = map.getContext('2d');
    const mapImage = mapCtx.createImageData(w, h);
    const field = { sd: 0, nx: 0, ny: 0 };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        surfaceField(x + 0.5 - halfW, y + 0.5 - halfH, halfW, halfH, r, field);
        const depth = -field.sd;
        const t = depth / b;
        const inside = t >= 0 && t < 1;
        const mag = inside ? profile[Math.min(profile.length - 1, Math.round(t * (profile.length - 1)))] : 0;
        const index = (y * w + x) * 4;
        mapImage.data[index] = Math.round(128 - field.nx * mag * 127);
        mapImage.data[index + 1] = 128;
        mapImage.data[index + 2] = Math.round(128 - field.ny * mag * 127);
        mapImage.data[index + 3] = 255;
      }
    }
    mapCtx.putImageData(mapImage, 0, 0);

    // Спекуляр: тонкая светлая кромка там, где нормаль смотрит вверх/вниз,
    // и едва заметная тень по бокам. Это и есть «полированный торец».
    const spec = document.createElement('canvas');
    spec.width = width;
    spec.height = height;
    const specCtx = spec.getContext('2d');
    const specImage = specCtx.createImageData(width, height);
    const specHalfW = width / 2;
    const specHalfH = height / 2;
    const specR = Math.min(radius, specHalfW, specHalfH);
    const cosLight = Math.cos(1.08);
    const cosDiffuse = Math.cos(0.72);
    const cosSide = Math.cos(0.98);
    const reach = 8 + bezel * 0.22;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        surfaceField(x + 0.5 - specHalfW, y + 0.5 - specHalfH, specHalfW, specHalfH, specR, field);
        const sd = field.sd;
        if (sd > 1 || sd < -(reach + 1)) continue;
        const coverage = sat(0.5 - sd);
        const vertical = Math.abs(field.ny);
        const directional = Math.pow(sat((vertical - cosLight) / (1 - cosLight)), 1.25);
        const diffuseDir = Math.pow(sat((vertical - cosDiffuse) / (1 - cosDiffuse)), 1.25);
        const stroke = sat(sd + 1.4) * sat(0.5 - sd);
        let highlight = directional * stroke;
        highlight /= 1 + 0.5 * (1 - highlight);
        const glow = 1 - sat(-sd / reach);
        const diffuse = diffuseDir * 0.34 * glow * glow * coverage;
        const side = Math.max(
          sat((field.nx - cosSide) / (1 - cosSide)) * stroke,
          sat((-field.nx - cosSide) / (1 - cosSide)) * stroke,
        );
        const shade = side * 0.62;
        const light = sat(highlight + diffuse);
        const alpha = light + shade * (1 - light);
        if (alpha <= 0.004) continue;
        const index = (y * width + x) * 4;
        const value = Math.min((light / alpha) * 235, 255);
        specImage.data[index] = value;
        specImage.data[index + 1] = value;
        specImage.data[index + 2] = value;
        specImage.data[index + 3] = Math.round(Math.min(alpha, 1) * 255);
      }
    }
    specCtx.putImageData(specImage, 0, 0);

    return { map: map.toDataURL('image/png'), specular: spec.toDataURL('image/png'), mapScale: scale };
  }

  function imageFor(width, height, radius, bezel) {
    const key = `${width}x${height}r${radius}b${bezel}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const value = makeImages(width, height, radius, bezel);
    cache.set(key, value);
    if (cache.size > IMAGE_LIMIT) cache.delete(cache.keys().next().value);
    return value;
  }

  // ---------- SVG-фильтры ----------

  let host = null;
  let filterSeq = 0;
  const filters = new Map();

  function ensureHost() {
    if (host?.isConnected) return host;
    host = document.createElementNS(SVG_NS, 'svg');
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.append(host);
    return host;
  }

  function svgNode(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  function addTone(filter) {
    // Мягко поднимаем тени и приглушаем пересвет: фон за стеклом не должен
    // спорить с текстом, но и не превращаться в серую заливку.
    const steps = 17;
    const samples = [];
    for (let i = 0; i < steps; i++) {
      const value = i / (steps - 1);
      const lifted = value + 0.09 * (1 - value) ** 3;
      samples.push((lifted - 0.06 * lifted ** 3).toFixed(3));
    }
    const transfer = svgNode('feComponentTransfer', {});
    for (const name of ['feFuncR', 'feFuncG', 'feFuncB']) {
      transfer.append(svgNode(name, { type: 'table', tableValues: samples.join(' ') }));
    }
    filter.append(transfer);
  }

  function filterFor(width, height, map, scale, blur, saturation, brightness, dispersion) {
    const key = `${width}x${height}s${scale}b${blur}n${saturation}l${brightness}|${map.length}:${map.slice(-28)}`;
    const existing = filters.get(key);
    if (existing) {
      filters.delete(key);
      filters.set(key, existing);
      return existing;
    }
    const id = `lg-refract-${filterSeq++}`;
    const filter = svgNode('filter', {
      id,
      x: 0,
      y: 0,
      width,
      height,
      filterUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB',
    });
    const image = svgNode('feImage', { x: 0, y: 0, width, height, result: 'map' });
    image.setAttribute('href', map);
    filter.append(image);
    // Blur и преломление живут в одном SVG-фильтре: у backdrop-filter с url()
    // Chromium не применяет соседние blur()/saturate() в одной цепочке.
    filter.append(svgNode('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: blur, result: 'blurred' }));
    filter.append(svgNode('feColorMatrix', {
      in: 'blurred',
      type: 'saturate',
      values: saturation / 100,
      result: 'saturated',
    }));
    const light = svgNode('feComponentTransfer', { in: 'saturated', result: 'lit' });
    for (const name of ['feFuncR', 'feFuncG', 'feFuncB']) {
      light.append(svgNode(name, { type: 'linear', slope: brightness, intercept: 0 }));
    }
    filter.append(light);
    const displace = (amount, result) => {
      const node = svgNode('feDisplacementMap', {
        in: 'lit',
        in2: 'map',
        scale: amount,
        xChannelSelector: 'R',
        yChannelSelector: 'B',
      });
      if (result) node.setAttribute('result', result);
      return node;
    };
    if (dispersion > 0) {
      const channels = [
        ['R', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
        ['G', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
        ['B', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'],
      ];
      const shifted = channels.map(([name, matrix], index) => {
        const amount = scale * (1 + (index - 1) * dispersion);
        const disp = 'disp' + name;
        const ch = 'ch' + name;
        filter.append(displace(amount, disp));
        filter.append(svgNode('feColorMatrix', { in: disp, values: matrix, result: ch }));
        return ch;
      });
      filter.append(svgNode('feComposite', { in: shifted[0], in2: shifted[1], operator: 'arithmetic', k2: 1, k3: 1, result: 'chRG' }));
      filter.append(svgNode('feComposite', { in: 'chRG', in2: shifted[2], operator: 'arithmetic', k2: 1, k3: 1 }));
    } else {
      filter.append(displace(scale));
    }    addTone(filter);
    ensureHost().append(filter);
    filters.set(key, id);
    if (filters.size > FILTER_LIMIT) {
      const [oldKey, oldId] = filters.entries().next().value;
      filters.delete(oldKey);
      host.querySelector(`#${oldId}`)?.remove();
    }
    return id;
  }

  // ---------- поверхности ----------

  const observed = new WeakSet();
  let scanQueued = false;

  function enhance(element, config) {
    if (observed.has(element)) return;
    observed.add(element);
    element.classList.add('lg-surface');

    let timer = 0;
    let lastKey = '';

    const apply = () => {
      timer = 0;
      let layer = element.querySelector(':scope > .lg-refract-layer');
      if (!layer) {
        layer = document.createElement('span');
        layer.className = 'lg-refract-layer';
        layer.setAttribute('aria-hidden', 'true');
        Object.assign(layer.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          width: '100%',
          height: '100%',
          zIndex: '-1',
          pointerEvents: 'none',
          borderRadius: 'inherit',
          background: 'transparent',
        });
        element.prepend(layer);
      }
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (width < 24 || height < 24) return;
      const style = getComputedStyle(element);
      let radius = parseFloat(style.borderTopLeftRadius) || 16;
      radius = Math.max(2, Math.min(radius, width / 2, height / 2));
      const bezel = Math.max(4, Math.min(config.bezel, Math.floor(Math.min(width, height) / 2)));
      const key = `${width}x${height}r${Math.round(radius)}b${bezel}`;
      if (key === lastKey) return;
      lastKey = key;
      const images = imageFor(width, height, Math.round(radius), bezel);
      element.style.setProperty('--lg-blur', `${config.blur}px`);
      element.style.setProperty('--lg-sat', `${config.saturate}%`);
      element.style.setProperty('--lg-bright', String(config.brightness));
      element.style.setProperty('--lg-specular', `url("${images.specular}")`);

      const warm = new Image();
      warm.src = images.map;
      const ready = () => {
        const filterId = filterFor(width, height, images.map, config.refraction, config.blur, config.saturate, config.brightness, config.dispersion || 0);
        layer.style.backdropFilter = `url(#${filterId})`;
        layer.style.webkitBackdropFilter = `url(#${filterId})`;
        element.classList.add('lg-ready');
      };
      // decode() может не разрешиться, пока окно скрыто; слой всё равно должен включиться.
      let armed = false;
      const arm = () => { if (armed) return; armed = true; ready(); };
      warm.addEventListener('load', arm, { once: true });
      warm.addEventListener('error', arm, { once: true });
      const decode = warm.decode?.();
      if (decode && typeof decode.then === 'function') decode.then(arm).catch(() => {});
      else if (warm.complete) arm();
      setTimeout(arm, 260);
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(apply, 90);
    };

    new ResizeObserver(schedule).observe(element);
    schedule();
  }

  function scan() {
    scanQueued = false;
    for (const config of SURFACES) {
      for (const element of document.querySelectorAll(config.selector)) {
        if (!observed.has(element)) enhance(element, config);
      }
    }
  }

  const queueScan = () => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queueScan);
  else queueScan();

  // Меню/карточки/тосты появляются динамически — добавляем их по факту.
  new MutationObserver(queueScan).observe(document.documentElement, { childList: true, subtree: true });
})();
