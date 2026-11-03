// Preview Card: карточка профиля показывается по наведению, как в референсе liqui.
// Нажатие и контекстное меню продолжают работать — карточка открывается тем же кодом.
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

  document.addEventListener('pointerover', (event) => {
    const target = event.target.closest?.(SELECTOR);
    if (!target) return;
    if (event.relatedTarget && target.contains(event.relatedTarget)) return;
    const id = idOf(target);
    if (!id) return;
    cancelOpen();
    cancelClose();
    openTimer = setTimeout(() => {
      // Если карточка уже открыта — не пересоздаём её на каждом движении курсора
      if (shownCard()) return;
      openProfileCard(id, target);
    }, OPEN_DELAY);
  });

  document.addEventListener('pointerout', (event) => {
    const target = event.target.closest?.(SELECTOR);
    if (!target) return;
    if (event.relatedTarget && target.contains(event.relatedTarget)) return;
    cancelOpen();
    scheduleClose();
  });

  // Курсор внутри карточки — держим её открытой
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
  window.addEventListener('scroll', () => {
    if (shownCard()) closeProfileCard();
  }, { passive: true, capture: true });
  window.__previewReady = true;
})();
