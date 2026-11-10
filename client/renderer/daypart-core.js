// Чистые данные времени суток для фона: фаза по часам и сцены темы.
// Отдельный модуль, чтобы это проверялось unit-тестами без Electron и DOM.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SozvonDaypartCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const GLASS_SCENES = {
    dawn: 'glass-dawn.jpg',
    morning: 'glass-morning.jpg',
    day: 'glass-day.jpg',
    sunset: 'glass-evening.jpg',
    night: 'glass-night.jpg',
  };
  const FUJI_SCENES = {
    dawn: 'fuji-dawn.jpg',
    morning: 'fuji-dawn.jpg',
    day: 'fuji-day.jpg',
    sunset: 'fuji-sunset.jpg',
    night: 'fuji-night.jpg',
  };

  function sceneSet(themeId) {
    return themeId === 'fuji' ? FUJI_SCENES : GLASS_SCENES;
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
    if (hour >= 5 && hour < 7) return 'dawn';
    if (hour >= 7 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'day';
    if (hour >= 17 && hour < 21) return 'sunset';
    return 'night';
  }

  return { GLASS_SCENES, FUJI_SCENES, sceneSet, phaseAt };
});
