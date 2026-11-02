// Окно трансляции: сюда главное окно шлёт кадры, здесь только показываем их.
// Окно без рамки — тянется за любое место, размер меняется за края, можно унести на другой монитор.
(() => {
  const img = document.getElementById('pip-image');
  const title = document.getElementById('pip-title');
  const bridge = window.desktop?.pip;

  bridge?.onTitle((text) => {
    title.textContent = text || 'Трансляция';
    document.title = text ? `Созвон — ${text}` : 'Созвон — трансляция';
  });

  bridge?.onFrame((data) => {
    if (typeof data !== 'string' || img.src === data) return;
    img.src = data;
  });

  const close = () => bridge?.close();
  document.getElementById('pip-close').onclick = close;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
})();
