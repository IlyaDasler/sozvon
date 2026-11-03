// Number Field у ползунков, сворачиваемые секции настроек, OTP-поле и Meter.
(() => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // ---------- Number Field: точное значение рядом с ползунком ----------
  function addNumberField(range) {
    if (range.dataset.numReady === '1') return;
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
    const heading = block.querySelector(':scope > h4');
    if (!heading) return;
    block.dataset.collapseReady = '1';

    const body = document.createElement('div');
    body.className = 'collapse-body';
    const after = [...block.children].filter((el) => el !== heading);
    for (const el of after) body.append(el);

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

  // ---------- Meter в «Плане 3.0»: сколько пунктов готово ----------
  function paintPlanMeter() {
    const list = document.getElementById('plan-list');
    const host = document.querySelector('.plan-head');
    if (!list || !host) return;
    let meter = document.getElementById('plan-meter');
    if (!meter) {
      meter = document.createElement('div');
      meter.id = 'plan-meter';
      meter.innerHTML =
        '<div class="meter-row"><span>Готовность:</span><b id="plan-meter-value">0 из 0</b></div>' +
        '<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100"><div class="meter-fill" style="width:0%"></div></div>';
      host.after(meter);
    }
    const items = [...list.querySelectorAll('.plan-item')];
    const done = items.filter((item) => item.classList.contains('done')).length;
    const percent = items.length ? Math.round((done / items.length) * 100) : 0;
    meter.querySelector('#plan-meter-value').textContent = `${done} из ${items.length}`;
    meter.querySelector('.meter-fill').style.width = percent + '%';
    meter.querySelector('.meter').setAttribute('aria-valuenow', String(percent));
  }

  function start() {
    // Разметка настроек статичная — одного прохода достаточно.
    // Наблюдатели за #settings зацикливались: обёртка блока сама вызывала мутацию.
    for (const range of document.querySelectorAll('#settings input[type=range]')) addNumberField(range);
    for (const block of document.querySelectorAll('#settings .set-block')) addCollapsible(block);
    const totp = document.getElementById('auth-totp');
    if (totp) addOtp(totp);
  }

  // Meter рисуем после того, как «План 3.0» отрендерил список
  function startMeter() {
    let attempts = 0;
    const tick = () => {
      paintPlanMeter();
      if (++attempts < 20 && !document.querySelector('#plan-list .plan-item')) setTimeout(tick, 250);
    };
    tick();
  }

  window.initGlassControls = start;
  window.paintPlanMeterNow = paintPlanMeter;

  function boot() {
    start();
    startMeter();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();