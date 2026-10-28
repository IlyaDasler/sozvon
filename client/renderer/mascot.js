// Совёнок Совон — талисман Созвона. Совы не спят по ночам, как и геймеры; в больших наушниках он слышит
// всех и собирает друзей в созвон. Живёт там, где пока пусто: в новом чате, без друзей, в канале без комнат.

const SOVON_SVG = `<svg class="sovon" viewBox="0 0 160 160" aria-hidden="true">
  <defs>
    <linearGradient id="sovon-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f80ff"/><stop offset="1" stop-color="#5a48d6"/></linearGradient>
  </defs>
  <ellipse class="sovon-shadow" cx="80" cy="150" rx="38" ry="5" fill="#000" opacity=".25"/>
  <g class="sovon-bob">
    <path d="M44 52 34 18 66 40Z M116 52 126 18 94 40Z" fill="#6f5fe8"/>
    <ellipse cx="80" cy="92" rx="52" ry="54" fill="url(#sovon-body)"/>
    <ellipse cx="80" cy="114" rx="30" ry="27" fill="#d9d3ff" opacity=".55"/>
    <path d="M66 112l3 3 3-3M77 108l3 3 3-3M88 112l3 3 3-3M71 123l3 3 3-3M83 123l3 3 3-3" fill="none" stroke="#8a7cf5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>
    <circle cx="60" cy="80" r="22" fill="#a79cff"/><circle cx="100" cy="80" r="22" fill="#a79cff"/>
    <circle cx="60" cy="80" r="17" fill="#fff"/><circle cx="100" cy="80" r="17" fill="#fff"/>
    <g class="sovon-eyes">
      <circle cx="62" cy="82" r="8.5" fill="#1d1a33"/><circle cx="98" cy="82" r="8.5" fill="#1d1a33"/>
      <circle cx="65" cy="78.5" r="3" fill="#fff"/><circle cx="101" cy="78.5" r="3" fill="#fff"/>
    </g>
    <g class="sovon-lids" fill="#a79cff"><rect x="42" y="62" width="36" height="0"/><rect x="82" y="62" width="36" height="0"/></g>
    <path d="M73 95h14l-7 11z" fill="#ffb547"/>
    <path d="M24 90C24 26 136 26 136 90" fill="none" stroke="#3ddc97" stroke-width="8" stroke-linecap="round"/>
    <rect x="14" y="76" width="22" height="34" rx="9" fill="#3ddc97"/><rect x="124" y="76" width="22" height="34" rx="9" fill="#3ddc97"/>
    <rect x="18" y="82" width="6" height="22" rx="3" fill="#2bb67c"/><rect x="136" y="82" width="6" height="22" rx="3" fill="#2bb67c"/>
    <path d="M27 108c2 14 14 20 28 18" fill="none" stroke="#2a2840" stroke-width="4" stroke-linecap="round"/>
    <rect x="52" y="120" width="12" height="9" rx="4.5" fill="#2a2840"/>
    <ellipse cx="66" cy="145" rx="9" ry="4.5" fill="#ffb547"/><ellipse cx="94" cy="145" rx="9" ry="4.5" fill="#ffb547"/>
  </g>
</svg>`;

/** Пустое место с Совоном: картинка, заголовок и подсказка (small — для узких мест) */
function mascot(title, text, { small = false } = {}) {
  const box = document.createElement('div');
  box.className = `mascot${small ? ' small' : ''}`;
  box.innerHTML = SOVON_SVG;
  const h = document.createElement('b');
  h.className = 'mascot-title';
  h.textContent = title;
  box.append(h);
  if (text) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = text;
    box.append(p);
  }
  return box;
}
