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
