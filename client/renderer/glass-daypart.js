// Время суток для фона «Жидкое стекло»: утро, день, вечер, ночь.
// Часы берём у сервера (а не у компьютера пользователя), часовой пояс — из
// Intl пользователя. При смене — мягкое перекрёстное затухание двух слоёв.
(() => {
  const root = document.documentElement;
  const GLASS_SCENES = {
    dawn: 'glass-morning.jpg',
    day: 'glass-day.jpg',
    sunset: 'glass-evening.jpg',
    night: 'glass-night.jpg',
  };
  const FUJI_SCENES = {
    dawn: 'fuji-dawn.jpg',
    day: 'fuji-day.jpg',
    sunset: 'fuji-sunset.jpg',
    night: 'fuji-night.jpg',
  };
  const sceneSet = () =>
    document.documentElement.dataset.themeId === 'fuji' ? FUJI_SCENES : GLASS_SCENES;
  let scenes = sceneSet();
  const first = document.querySelector('.lg-aurora');
  if (!first) return;
  const second = document.createElement('div');
  second.className = 'lg-aurora';
  second.setAttribute('aria-hidden', 'true');
  document.body.prepend(second);
  const layers = [first, second];
  let active = 0;
  let current = '';
  let serial = 0;

  // Заранее прогреваем все кадры обеих тем, чтобы смена не показывала пустоту.
  for (const src of [...Object.values(GLASS_SCENES), ...Object.values(FUJI_SCENES)]) {
    const img = new Image();
    img.src = src;
  }

  function phaseAt(ms, timeZone) {
    let hour = 12;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(ms));
      const h = Number(parts.find((p) => p.type === 'hour')?.value);
      const m = Number(parts.find((p) => p.type === 'minute')?.value);
      if (Number.isFinite(h)) hour = h + (Number.isFinite(m) ? m / 60 : 0);
    } catch {}
    if (hour >= 5 && hour < 8) return 'dawn';
    if (hour >= 8 && hour < 17) return 'day';
    if (hour >= 17 && hour < 21) return 'sunset';
    return 'night';
  }

  function zone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  function show(phase) {
    if (current === phase) return;
    const next = layers[1 - active];
    const prev = layers[active];
    const token = ++serial;
    const src = scenes[phase];
    // Кадры прогреты на старте; слой меняем сразу, плавность даёт CSS-переход.
    if (token !== serial) return;
    if (document.documentElement.dataset.themeId === 'fuji') {
      // У Фуджи оба слоя держим на одном кадре: фон гарантированно меняется
      // даже там, где compositor задерживает opacity-переход между слоями.
      for (const layer of layers) {
        layer.style.setProperty("--scene", `url("${src}")`);
        layer.classList.add('is-visible');
      }
      active = 1 - active;
      current = phase;
      root.dataset.daypart = phase;
      return;
    }
    next.style.setProperty("--scene", `url("${src}")`);
    void next.offsetWidth;
    next.classList.add('is-visible');
    prev.classList.remove('is-visible');
    active = 1 - active;
    current = phase;
    root.dataset.daypart = phase;
  }

  function paint(ms = Date.now()) {
    const next = phaseAt(ms, zone());
    if (current === '') {
      layers[0].style.setProperty("--scene", `url("${scenes[next]}")`);
      layers[0].classList.add('is-visible');
      current = next;
      root.dataset.daypart = next;
    } else {
      show(next);
    }
    root.dataset.daypartZone = zone();
  }

  // Часы сервера. Если сети нет — остаётся локальное время, сцена продолжает работать.
  async function sync() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const base = (typeof Api !== 'undefined' && Api.base) || `${location.protocol}//${location.host}`;
      const res = await fetch(`${base}/api/time`, {
        signal: controller.signal,
        headers: { 'X-Client-Version': (typeof window.desktop?.version === 'string' && window.desktop.version) || '3.3.1' },
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (Number.isFinite(Number(data?.now))) paint(Number(data.now));
      }
    } catch {}
    paint();
  }

  // Смена темы меняет весь набор кадров; переключаем без ожидания таймера.
  function refresh() {
    scenes = sceneSet();
    current = '';
    const phase = phaseAt(Date.now(), zone());
    const layer = layers[active];
    layer.style.setProperty('--scene', `url("${scenes[phase]}")`);
    if (document.documentElement.dataset.themeId === 'fuji') {
      for (const item of layers) {
        item.style.setProperty('--scene', `url("${scenes[phase]}")`);
        item.classList.add('is-visible');
      }
    } else {
      layers[1 - active].classList.remove('is-visible');
      layer.classList.add('is-visible');
    }
    current = phase;
    root.dataset.daypart = phase;
  }

  // Ручной выбор фазы для превью и UI-кита; на реальную работу не влияет.
  window.sozvonDaypart = { show(phase) { if (scenes[phase]) show(phase); }, refresh };

  paint();
  sync();
  setInterval(sync, 5 * 60_000);
  setInterval(paint, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sync();
  });
  window.addEventListener('focus', () => sync());
})();
