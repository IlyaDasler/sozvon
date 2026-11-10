// Number Field у ползунков, сворачиваемые секции настроек, OTP-поле и Meter.
(() => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // ---------- Number Field: точное значение рядом с ползунком ----------
  function addNumberField(range) {
    if (range.dataset.numReady === '1') return;
    // У шумоподавления уже есть подписи «Выкл…Сильно» и ползунок:
    // лишний number-stepper только дублирует его и мешает.
    if (range.id === 'set-ns-level') return;
    range.dataset.numReady = '1';
    const field = range.closest('.field');
    const label = field?.querySelector('span');
    if (!field || !label) return;

    const unitText = label.querySelector('b')?.textContent?.trim() || '';
    const unit = unitText.replace(/[\d\s.,]/g, '');
    const old = label.querySelector('b');
    if (old) old.hidden = true;

    const box = document.createElement('span');
    box.className = 'number-field';
    box.innerHTML =
      '<button type="button" data-step="-1" aria-label="Меньше">−</button>' +
      '<input type="number" inputmode="numeric" aria-label="Значение">' +
      (unit ? `<span class="unit">${unit}</span>` : '') +
      '<button type="button" data-step="1" aria-label="Больше">+</button>';
    label.append(box);

    const input = box.querySelector('input');
    const min = Number(range.min || 0);
    const max = Number(range.max || 100);
    const step = Number(range.step || 1);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = range.value;

    const apply = (value) => {
      const next = clamp(Number(value) || min, min, max);
      range.value = String(next);
      input.value = String(next);
      range.dispatchEvent(new Event('input', { bubbles: true }));
      range.dispatchEvent(new Event('change', { bubbles: true }));
    };
    input.addEventListener('change', () => apply(input.value));
    input.addEventListener('input', () => apply(input.value));
    for (const button of box.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        const direction = Number(button.dataset.step);
        apply(Number(range.value) + direction * step);
      });
    }
    range.addEventListener('input', () => { input.value = range.value; });
  }

  // ---------- Collapsible: секции настроек можно свернуть ----------
  function addCollapsible(block) {
    if (block.dataset.collapseReady === '1') return;
    // Блок выбора темы не сворачиваем: карточки должны быть сразу доступны,
    // а не выглядеть как выпадающий селект «Тема».
    if (block.querySelector('#theme-grid')) return;
    const heading = block.querySelector(':scope > h4');
    if (!heading) return;
    block.dataset.collapseReady = '1';

    const body = document.createElement('div');
    body.className = 'collapse-body';
    const inner = document.createElement('div');
    inner.className = 'collapse-inner';
    const after = [...block.children].filter((el) => el !== heading);
    for (const el of after) inner.append(el);
    body.append(inner);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'collapse-head';
    button.setAttribute('aria-expanded', 'true');
    // Сохраняем id и классы заголовка: на них ссылается остальной код
    if (heading.id) button.id = heading.id;
    if (heading.className) button.className += ' ' + heading.className;
    button.innerHTML =
      `<span class="collapse-title">${heading.textContent.trim()}</span>` +
      '<svg class="collapse-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    heading.replaceWith(button);
    block.append(body);

    button.addEventListener('click', () => {
      const collapsed = block.classList.toggle('is-collapsed');
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
  }

  // ---------- OTP: шесть ячеек, ввод цифр, резервный код текстом ----------
  function addOtp(input) {
    if (input.dataset.otpReady === '1') return;
    input.dataset.otpReady = '1';
    const wrap = document.createElement('div');
    wrap.className = 'otp-field';
    for (let i = 0; i < 6; i++) {
      const cell = document.createElement('span');
      cell.className = 'otp-cell';
      wrap.append(cell);
    }
    input.before(wrap);
    wrap.append(input);
    input.setAttribute('maxlength', '32');
    input.autocomplete = 'one-time-code';

    const cells = [...wrap.querySelectorAll('.otp-cell')];
    const paint = () => {
      const value = input.value.trim();
      const text = /[^0-9]/.test(value);
      wrap.classList.toggle('is-text', text);
      if (text) return;
      cells.forEach((cell, index) => { cell.textContent = value[index] || ''; });
      wrap.classList.toggle('is-filled', value.length === 6);
    };
    input.addEventListener('input', paint);
    input.addEventListener('change', paint);
    wrap.addEventListener('click', () => input.focus());
    paint();
  }

  // ---------- Стеклянные поля и контролы настроек ----------

  function start() {
    // Разметка настроек статичная — одного прохода достаточно.
    // Наблюдатели за #settings зацикливались: обёртка блока сама вызывала мутацию.
    for (const range of document.querySelectorAll('#settings input[type=range]')) addNumberField(range);
    for (const block of document.querySelectorAll('#settings .set-block')) addCollapsible(block);
    const totp = document.getElementById('auth-totp');
    if (totp) addOtp(totp);
  }

  window.initGlassControls = start;

  function boot() {
    start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();