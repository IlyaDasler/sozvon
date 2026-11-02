// Вопрос «вы уверены?» — окно в стиле приложения вместо системного confirm.
// ask(text, { title, ok, danger }) → Promise<boolean>: true — согласились, false — отмена, Esc или щелчок мимо.
// Одновременно открыт один вопрос; новый закрывает прежний как отменённый.

let dialogDone = null;

function ask(text, { title = 'Вы уверены?', ok = 'Да', danger = false } = {}) {
  closeDialog(false);
  $('dialog-title').textContent = title;
  $('dialog-text').textContent = text;
  $('dialog-ok').textContent = ok;
  $('dialog-ok').className = `btn ${danger ? 'danger' : 'primary'}`;
  $('dialog').classList.remove('hidden');
  $('dialog-ok').focus();
  return new Promise((resolve) => (dialogDone = resolve));
}

function closeDialog(answer) {
  if (!dialogDone) return;
  const done = dialogDone;
  dialogDone = null;
  $('dialog').classList.add('hidden');
  done(answer);
}

$('dialog-ok').onclick = () => closeDialog(true);
$('dialog-cancel').onclick = () => closeDialog(false);
$('dialog').onclick = (e) => e.target === $('dialog') && closeDialog(false);

// Вопрос с полем ввода: Promise<string|null> — текст или отмена.
// Ввод однострочный и в том же оформлении, что остальные окна приложения
function askText(title, value = '', { hint = '', maxlength = 120 } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="modal-card dialog-card ask-text-card" role="dialog">
        <h3></h3>
        <label class="field">
          <span class="ask-text-label">Название</span>
          <input class="ask-text-input" spellcheck="false" autocomplete="off">
        </label>
        <p class="hint-text ask-text-hint"></p>
        <div class="row">
          <span class="spacer"></span>
          <button type="button" class="btn" data-cancel>Отмена</button>
          <button type="button" class="btn primary" data-ok>Сохранить</button>
        </div>
      </div>`;
    wrap.querySelector('h3').textContent = title;
    const input = wrap.querySelector('.ask-text-input');
    input.maxLength = maxlength;
    input.value = value;
    wrap.querySelector('.ask-text-hint').textContent = hint || 'Enter — сохранить, Esc — отмена';
    const finish = (result) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result === null ? null : String(result).trim());
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(null);
    };
    wrap.querySelector('[data-ok]').onclick = () => finish(input.value);
    wrap.querySelector('[data-cancel]').onclick = () => finish(null);
    wrap.onclick = (e) => e.target === wrap && finish(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(input.value);
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    input.focus();
    input.select();
  });
}
