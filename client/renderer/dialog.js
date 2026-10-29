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

// Вопрос с полем ввода: Promise<string|null> — текст или отмена
function askText(title, value = '') {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="modal-card edit-card">
        <h3></h3>
        <textarea rows="4" maxlength="2000"></textarea>
        <div class="row">
          <span class="muted small">Enter — сохранить, Shift+Enter — новая строка</span>
          <span class="spacer"></span>
          <button type="button" class="btn" data-cancel>Отмена</button>
          <button type="button" class="btn primary" data-ok>Сохранить</button>
        </div>
      </div>`;
    wrap.querySelector('h3').textContent = title;
    const area = wrap.querySelector('textarea');
    area.value = value;
    const finish = (result) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(null);
    };
    wrap.querySelector('[data-ok]').onclick = () => finish(area.value);
    wrap.querySelector('[data-cancel]').onclick = () => finish(null);
    wrap.onclick = (e) => e.target === wrap && finish(null);
    area.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish(area.value);
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  });
}
