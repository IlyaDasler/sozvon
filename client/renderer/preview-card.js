// Hover no longer opens the card: profile opens on click on name or avatar
// Hover no longer opens the card: profile opens on click on name or avatar
(() => {
  const SELECTOR = '[data-profile], [data-voice-user], [data-user], [data-contact], .contact[data-contact]';
  const OPEN_DELAY = 550;
  const CLOSE_DELAY = 260;
  let openTimer = null;
  let closeTimer = null;

  const idOf = (element) =>
    Number(element.dataset.profile || element.dataset.voiceUser || element.dataset.user || element.dataset.contact) || 0;

  const card = () => document.querySelector('.profile-card');
  // В разметке карточка есть всегда — открытой считаем только видимую и наполненную
  const shownCard = () => {
    const el = card();
    return el && !el.classList.contains('hidden') && el.children.length ? el : null;
  };

  function cancelOpen() {
    clearTimeout(openTimer);
    openTimer = null;
  }

  function cancelClose() {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  function scheduleClose() {
    cancelClose();
    closeTimer = setTimeout(() => {
      const el = shownCard();
      if (!el) return;
      if (el.matches(':hover')) return;
      closeProfileCard();
    }, CLOSE_DELAY);
  }

// Hover no longer opens the card: profile opens on click on name or avatar
  document.addEventListener('pointerover', (event) => {
    if (event.target.closest?.('.profile-card')) cancelClose();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      cancelOpen();
      cancelClose();
      closeProfileCard();
    }
  });

  // Прокрутка уводит карточку от якоря — закрываем
  window.addEventListener('scroll', (event) => {
    // Скролл внутри самой карточки не закрывает её
    const target = event.target;
    if (target && target.closest && target.closest('.profile-card')) return;
    if (shownCard()) closeProfileCard();
  }, { passive: true, capture: true });
  window.__previewReady = true;
})();
