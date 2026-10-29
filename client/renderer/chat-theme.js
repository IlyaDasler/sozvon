// Тема личного чата: фон и акцентный цвет переписки с одним человеком.
// «Только у меня» — хранится на этом устройстве и важнее общей; «у нас обоих» — на сервере, собеседник видит сразу.
// Цвета тем — в styles.css (#chat[data-chat-theme=…]).

const CHAT_THEMES = [
  { id: 'default', name: 'Как в приложении', swatch: 'var(--bg)' },
  { id: 'sunset', name: 'Закат', swatch: 'linear-gradient(135deg, #ff8a5b, #e8467c)' },
  { id: 'ocean', name: 'Океан', swatch: 'linear-gradient(135deg, #2ec5ff, #2860d8)' },
  { id: 'forest', name: 'Лес', swatch: 'linear-gradient(135deg, #5fd38d, #1d7a55)' },
  { id: 'night', name: 'Ночь', swatch: 'linear-gradient(135deg, #3a3f8f, #0b0d24)' },
  { id: 'candy', name: 'Конфета', swatch: 'linear-gradient(135deg, #ff9ad5, #a77bff)' },
  { id: 'lava', name: 'Лава', swatch: 'linear-gradient(135deg, #ffb341, #d72f2f)' },
  { id: 'mint', name: 'Мята', swatch: 'linear-gradient(135deg, #8ef0d3, #3aa6a0)' },
];

const personalThemeKey = (peerId) => `chatTheme:${state.me?.id}:${peerId}`;

/** Тема чата с человеком: своя, иначе общая, иначе как в приложении */
function chatThemeOf(peerId) {
  return store.get(personalThemeKey(peerId), null) || state.contacts.get(peerId)?.chatTheme || 'default';
}

function applyChatTheme() {
  const theme = state.selectedId ? chatThemeOf(state.selectedId) : 'default';
  if (theme === 'default') delete $('chat').dataset.chatTheme;
  else $('chat').dataset.chatTheme = theme;
}

async function pickChatTheme(theme, scope) {
  const peerId = state.selectedId;
  if (!peerId) return;
  if (scope === 'me') {
    store.set(personalThemeKey(peerId), theme === 'default' ? null : theme);
  } else {
    // «У обоих» — своя тема больше не перебивает общую
    store.set(personalThemeKey(peerId), null);
    try {
      await Api.put(`/contacts/${peerId}/theme`, { theme: theme === 'default' ? null : theme });
      const c = state.contacts.get(peerId);
      if (c) c.chatTheme = theme === 'default' ? null : theme;
    } catch (err) {
      return toast(err.message);
    }
  }
  applyChatTheme();
  renderChatThemePop();
}

/** Собеседник (или я с другого устройства) поменял общую тему */
function onChatTheme({ userId, theme, by }) {
  const c = state.contacts.get(userId);
  if (!c) return;
  c.chatTheme = theme;
  if (state.selectedId === userId) {
    applyChatTheme();
    if (by !== state.me.id && !store.get(personalThemeKey(userId), null))
      toast(`${c.displayName} ${theme ? `сменил(а) тему чата на «${CHAT_THEMES.find((t) => t.id === theme)?.name || theme}»` : 'вернул(а) обычную тему чата'}`);
  }
}

function renderChatThemePop() {
  const pop = $('chat-theme-pop');
  const current = chatThemeOf(state.selectedId);
  const grid = pop.querySelector('.chat-theme-grid');
  grid.replaceChildren();
  for (const t of CHAT_THEMES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chat-theme-item${t.id === current ? ' selected' : ''}`;
    b.dataset.themeId = t.id;
    b.title = t.name;
    const sw = document.createElement('span');
    sw.className = 'chat-theme-swatch';
    sw.style.background = t.swatch;
    const name = document.createElement('span');
    name.textContent = t.name;
    b.append(sw, name);
    b.onclick = () => pickChatTheme(t.id, pop.querySelector('[name="chat-theme-scope"]:checked').value);
    grid.append(b);
  }
}

$('chat-theme-btn').onclick = (e) => {
  e.stopPropagation();
  const pop = $('chat-theme-pop');
  if (!pop.classList.contains('hidden')) return pop.classList.add('hidden');
  renderChatThemePop();
  pop.classList.remove('hidden');
  const r = $('chat-theme-btn').getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.right = `${Math.max(8, innerWidth - r.right)}px`;
};
$('chat-theme-pop').onclick = (e) => e.stopPropagation();
document.addEventListener('click', () => $('chat-theme-pop').classList.add('hidden'));
