// Данные и конфиденциальность. Настройки сохраняются на сервере, чтобы действовать
// на всех устройствах; часть из них сервер проверяет сам (заявки, приглашения, игра),
// часть — клиент (печать в чате). Ложных переключателей здесь нет.

const privacyDefaults = () => ({ typing: true, gameActivity: true, friendRequests: true, invitePolicy: 'all' });
const privacyState = () => ({ ...privacyDefaults(), ...(state.me?.privacy || {}) });

function renderPrivacySettings() {
  if (!state.me) return;
  const current = privacyState();
  for (const input of document.querySelectorAll('[data-privacy-toggle]')) {
    input.checked = Boolean(current[input.dataset.privacyToggle]);
    input.disabled = false;
  }
  const invites = document.getElementById('privacy-invites');
  if (invites) {
    invites.value = current.invitePolicy === 'friends' ? 'friends' : 'all';
    invites.disabled = false;
  }
}

function showPrivacyPage(page = 'data') {
  const allowed = new Set(['data', 'profile', 'contact', 'crypto']);
  const current = allowed.has(page) ? page : 'data';
  window.privacyPage = current;
  for (const button of document.querySelectorAll('#privacy-subnav [data-privacy]')) {
    button.classList.toggle('active', button.dataset.privacy === current);
    if (button.dataset.privacy === current && button.parentElement?.closest('.set-pane')) {
      // На телефоне вкладки горизонтальные и могут не поместиться — докручиваем активную.
      button.scrollIntoView?.({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }
  for (const section of document.querySelectorAll('#settings [data-privacy-page]')) {
    section.classList.toggle('hidden', section.dataset.privacyPage !== current);
  }
  document.querySelector('#settings .set-body')?.scrollTo({ top: 0 });
}

async function savePrivacy(patch, control) {
  if (control) control.disabled = true;
  try {
    state.me = await Api.patch('/me/privacy', patch);
    renderMe();
    renderPrivacySettings();
  } catch (err) {
    toast(err.message || 'Не удалось сохранить настройку');
    renderPrivacySettings();
  } finally {
    if (control) control.disabled = false;
  }
}

document.addEventListener('change', (event) => {
  const toggle = event.target.closest?.('[data-privacy-toggle]');
  if (toggle) {
    savePrivacy({ [toggle.dataset.privacyToggle]: toggle.checked }, toggle);
    return;
  }
  const invites = event.target.closest?.('[data-privacy-invite]');
  if (invites) savePrivacy({ invitePolicy: invites.value }, invites);
});

document.getElementById('privacy-subnav')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-privacy]');
  if (!button) return;
  showPrivacyPage(button.dataset.privacy);
});

window.renderPrivacySettings = renderPrivacySettings;
window.showPrivacyPage = showPrivacyPage;
window.privacyPage = 'data';
