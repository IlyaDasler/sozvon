// Линзовый слой жидкого стекла.
// 1) Добавляет фон-аврору, чтобы стеклу было что преломлять.
// 2) Вставляет SVG-фильтр преломления и проверяет, умеет ли браузер
//    backdrop-filter: url(...) — если да, включает класс lg-refract.
(() => {
  function addAurora() {
    if (document.querySelector('.lg-aurora')) return;
    const layer = document.createElement('div');
    layer.className = 'lg-aurora';
    layer.setAttribute('aria-hidden', 'true');
    document.body.prepend(layer);
  }

  function addFilter() {
    if (document.getElementById('lg-refract')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    svg.innerHTML =
      '<filter id="lg-refract" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.006 0.01" numOctaves="2" seed="11" result="noise"/>' +
      '<feGaussianBlur in="noise" stdDeviation="1.4" result="soft"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="soft" scale="18" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>';
    document.body.append(svg);
  }

  function supportsBackdropUrl() {
    const probe = document.createElement('div');
    probe.style.backdropFilter = 'url(#lg-refract)';
    probe.style.webkitBackdropFilter = 'url(#lg-refract)';
    // Если браузер не понял url(), computed останется пустым или "none"
    const value = getComputedStyle(probe).backdropFilter || '';
    return value.includes('url(');
  }

  function start() {
    addAurora();
    addFilter();
    const on = supportsBackdropUrl();
    document.documentElement.classList.toggle('lg-refract', on);
    document.documentElement.dataset.refract = on ? 'on' : 'off';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
