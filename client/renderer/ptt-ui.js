// Рация (push-to-talk) на странице: настройки (режим и клавиша) и микрофон по нажатию.
// Нажатия ловит главный процесс (ptt.js) и присылает «нажата/отпущена»; отпускание чуть задерживаем,
// чтобы не обрезать конец слова

const PTT_RELEASE_MS = 250;
let pickedPtt = null; // клавиша, выбранная в открытых настройках (сохраняется по «Сохранить»)
let pttReleaseTimer = null;
let keyNames = null;

state.pttDown = false;
let pttHooked = false; // перехват сейчас включён в главном процессе

/** Включить перехват на сохранённой клавише или выключить его. Без рации главный процесс не трогаем */
function applyPtt() {
  if (!window.desktop?.ptt) return;
  const binding = pttMode() ? state.settings.pttBinding : null;
  if (binding || pttHooked) {
    pttHooked = Boolean(binding);
    window.desktop.ptt
      .set(binding)
      .then((ok) => !ok && toast('Рация недоступна на этом компьютере'))
      .catch(() => toast('Рация недоступна на этом компьютере'));
  }
  if (!binding) setPttDown(false);
  applyAudioState();
}

window.desktop?.ptt?.onChange((down) => {
  clearTimeout(pttReleaseTimer);
  if (down) setPttDown(true);
  else pttReleaseTimer = setTimeout(() => setPttDown(false), PTT_RELEASE_MS);
});

function setPttDown(down) {
  if (state.pttDown === down) return;
  state.pttDown = down;
  applyAudioState();
  renderVoice();
}

async function renderPttSettings() {
  $('ptt-block').classList.toggle('hidden', !window.desktop?.ptt);
  if (!window.desktop?.ptt) return;
  pickedPtt = parseBinding(state.settings.pttBinding);
  for (const r of document.querySelectorAll('input[name="mic-mode"]')) r.checked = r.value === (state.settings.ptt ? 'ptt' : 'voice');
  keyNames ??= await window.desktop.ptt.names().catch(() => ({}));
  $('ptt-key').textContent = bindingLabel(pickedPtt, keyNames);
}

$('ptt-assign').onclick = async () => {
  const button = $('ptt-assign');
  button.disabled = true;
  button.textContent = 'Нажмите клавишу…';
  try {
    const binding = await window.desktop.ptt.capture();
    if (binding) {
      pickedPtt = binding;
      document.querySelector('input[name="mic-mode"][value="ptt"]').checked = true;
    }
  } catch {
    toast('Рация недоступна на этом компьютере');
  } finally {
    button.disabled = false;
    button.textContent = 'Назначить';
    $('ptt-key').textContent = bindingLabel(pickedPtt, keyNames || {});
  }
};

applyPtt();
