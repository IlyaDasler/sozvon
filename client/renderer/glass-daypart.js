// Время суток для фона «Жидкое стекло»: рассвет, полдень, закат, ночь.
// Часы берём у сервера (а не у компьютера пользователя), часовой пояс — из
// Intl пользователя. Так переведённые/сбитые часы на ПК не переключают сцену.
(() => {
  const root = document.documentElement;
  const HOUR = 3600_000;

  function zone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
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

  function paint(ms = Date.now()) {
    const next = phaseAt(ms, zone());
    if (root.dataset.daypart !== next) root.dataset.daypart = next;
    root.dataset.daypartZone = zone();
  }

  // Часы сервера. Если сети нет — остаётся локальное время, но сцена продолжает работать.
  async function sync() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const base = (typeof Api !== 'undefined' && Api.base) || `${location.protocol}//${location.host}`;
      const res = await fetch(`${base}/api/time`, {
        signal: controller.signal,
        headers: { 'X-Client-Version': (typeof window.desktop?.version === 'string' && window.desktop.version) || '3.3.0' },
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (Number.isFinite(Number(data?.now))) paint(Number(data.now));
      }
    } catch {}
    paint();
  }

  paint();
  sync();
  setInterval(sync, 5 * 60_000);
  setInterval(paint, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sync();
  });
  window.addEventListener('focus', () => sync());

  // Выбор экрана/камеры не должен жить внутри прокручиваемой панели:
  // иначе fixed-окно обрезается её overflow и выглядит пустой плашкой.
  const picker = document.getElementById('screen-picker');
  if (picker && picker.parentElement !== document.body) document.body.append(picker);
})();
