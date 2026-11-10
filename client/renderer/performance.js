// Тир производительности: слабые Android-WebView не должны платить за blur,
// мощные — сохраняют стекло, прозрачность и анимации.
(() => {
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const forced = params.get('perf') || localStorage.getItem('sozvon:perf') || '';
  const memory = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);

  let gpu = '';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
  } catch {}

  const lowGpu = /Mali-G(3|5[0-2])|Adreno[^0-9]*(5\d\d|6[0-2]\d)|PowerVR\s*GE|VideoCore/i.test(gpu);
  const highGpu = /Adreno[^0-9]*(7\d\d|8\d\d)|Mali-G(7\d|9\d)/i.test(gpu);
  let tier = 'balanced';
  if (forced === 'low' || forced === 'balanced' || forced === 'high') tier = forced;
  else if ((memory > 0 && memory <= 4) || (cores > 0 && cores <= 4) || lowGpu) tier = 'low';
  else if (memory >= 8 && cores >= 8 && highGpu) tier = 'high';

  const apply = (next) => {
    tier = next;
    root.dataset.performance = next;
    window.sozvonPerf = { tier: next, gpu, memory, cores };
  };
  apply(tier);

  // Второй уровень: если стартовые кадры стабильно медленные — понижаем тир.
  // Повышать автоматически нельзя: слабый GPU не должен получить blur обратно.
  const measure = () => {
    const samples = [];
    let last = performance.now();
    let left = 36;
    const tick = (now) => {
      samples.push(now - last);
      last = now;
      if (--left > 0) requestAnimationFrame(tick);
      else {
        const sorted = samples.slice(1).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] || 0;
        if (median > 24 && tier === 'high') apply('balanced');
        else if (median > 24 && tier === 'balanced') apply('low');
      }
    };
    requestAnimationFrame(tick);
  };
  setTimeout(measure, 1200);

  window.setPerformanceTier = apply;
})();
