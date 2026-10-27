// Карточка профиля — по щелчку на аватарку или имя: в сообщениях, в списке друзей, в голосовом канале,
// у себя внизу слева. Баннер, аватарка со статусом, имя и логин, «О себе», когда пришёл в Созвон.
// Сверх того: где человек сейчас в голосе, общие комнаты, его роль в открытой комнате, личная заметка
// (видна только вам) и быстрые действия — написать, позвонить или добавить в друзья.

const noteKey = (id) => `note:${state.me?.id}:${id}`;

function section(title, content) {
  const box = document.createElement('div');
  box.className = 'pc-section';
  const h = document.createElement('h5');
  h.textContent = title;
  box.append(h, content);
  return box;
}

const chip = (text, color) => {
  const el = document.createElement('span');
  el.className = 'pc-chip';
  if (color) el.style.setProperty('--chip', color);
  el.textContent = text;
  return el;
};

function openProfileCard(userId, anchor) {
  const user = userById(userId);
  if (!user) return;
  const isMe = userId === state.me.id;
  const card = $('profile-card');
  card.replaceChildren();

  const banner = document.createElement('div');
  banner.className = 'pc-banner';
  banner.style.setProperty('--banner', user.bannerColor || user.avatarColor);
  card.append(banner);

  const avatar = makeAvatar(user, isMe ? myStatus() : presenceOf(user), 'huge');
  avatar.classList.add('pc-avatar');
  card.append(avatar);

  if (isMe) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'pc-edit icon-btn';
    edit.title = 'Изменить профиль';
    edit.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    edit.onclick = () => {
      closeProfileCard();
      openSettings();
    };
    card.append(edit);
  }

  const body = document.createElement('div');
  body.className = 'pc-body';
  const name = document.createElement('div');
  name.className = 'pc-name';
  name.textContent = user.displayName;
  const login = document.createElement('div');
  login.className = 'pc-login';
  login.textContent = `@${user.username}`;
  const status = document.createElement('div');
  status.className = 'pc-status';
  const st = isMe ? myStatus() : presenceOf(user);
  status.innerHTML = `<span class="status-dot s-${st}"></span>`;
  status.append(STATUS[st].label);
  body.append(name, login, status);

  // Сейчас в голосовом канале — щелчок переносит в комнату
  const voiceRoom = [...state.rooms.values()].find((r) => r.voice?.some((p) => p.userId === userId));
  if (voiceRoom) {
    const live = document.createElement('button');
    live.type = 'button';
    live.className = 'pc-voice';
    live.innerHTML = ICONS.speaker;
    live.append(`В голосе: ${voiceRoom.name}`);
    live.onclick = () => {
      closeProfileCard();
      selectRoom(voiceRoom.id);
    };
    body.append(live);
  }

  const divider = () => body.append(Object.assign(document.createElement('hr'), { className: 'pc-divider' }));
  divider();

  if (user.bio) {
    const bio = document.createElement('div');
    bio.className = 'pc-bio msg-text';
    bio.append(renderMarkdown(user.bio));
    body.append(section('О себе', bio));
  } else if (isMe) {
    const hint = Object.assign(document.createElement('div'), { className: 'muted small', textContent: 'Расскажите о себе в настройках профиля' });
    body.append(section('О себе', hint));
  }

  if (user.memberSince) {
    const since = Object.assign(document.createElement('div'), { className: 'pc-text' });
    since.textContent = new Date(user.memberSince).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });
    body.append(section('В Созвоне с', since));
  }

  // Роль в открытой комнате и общие комнаты
  const openRoom = state.selectedRoomId && roomById(state.selectedRoomId);
  if (openRoom && memberOf(openRoom, userId)) {
    const roles = document.createElement('div');
    roles.className = 'pc-chips';
    const role = roleOf(openRoom, userId);
    roles.append(openRoom.ownerId === userId ? chip('Создатель', '#f0b232') : role ? chip(role.name, role.color) : chip('Без роли'));
    body.append(section(`Роль в «${openRoom.name}»`, roles));
  }
  if (!isMe) {
    const shared = [...state.rooms.values()].filter((r) => r.members.some((m) => m.id === userId));
    if (shared.length) {
      const list = document.createElement('div');
      list.className = 'pc-chips';
      for (const r of shared) {
        const c = chip(r.name);
        c.classList.add('link');
        c.title = 'Открыть комнату';
        c.onclick = () => {
          closeProfileCard();
          selectRoom(r.id);
        };
        list.append(c);
      }
      body.append(section(`Общие комнаты — ${shared.length}`, list));
    }

    const note = document.createElement('textarea');
    note.className = 'pc-note';
    note.rows = 2;
    note.maxLength = 300;
    note.placeholder = 'Нажмите, чтобы добавить заметку — её видите только вы';
    note.value = store.get(noteKey(userId), '');
    note.oninput = () => store.set(noteKey(userId), note.value);
    body.append(section('Заметка', note));

    const actions = document.createElement('div');
    actions.className = 'pc-actions';
    if (state.contacts.has(userId)) {
      const write = Object.assign(document.createElement('button'), { type: 'button', className: 'btn primary', textContent: 'Написать' });
      write.onclick = () => {
        closeProfileCard();
        selectContact(userId);
      };
      const callBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn success', textContent: 'Позвонить' });
      callBtn.disabled = !isAvailable(user) || Boolean(state.call);
      callBtn.onclick = async () => {
        closeProfileCard();
        await selectContact(userId);
        startCall();
      };
      actions.append(write, callBtn);
    } else {
      const add = Object.assign(document.createElement('button'), { type: 'button', className: 'btn primary', textContent: 'Добавить в друзья' });
      add.onclick = async () => {
        try {
          const friend = await Api.post('/contacts', { username: user.username });
          state.contacts.set(friend.id, friend);
          renderContacts();
          toast(`${friend.displayName} теперь в друзьях`);
          openProfileCard(userId, anchor);
        } catch (err) {
          toast(err.message);
        }
      };
      actions.append(add);
    }
    body.append(actions);
  }
  card.append(body);

  card.classList.remove('hidden');
  placeCard(card, anchor);
}

// Рядом с тем, по чему щёлкнули, но целиком в окне
function placeCard(card, anchor) {
  const r = anchor?.getBoundingClientRect?.();
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  let left = r ? r.right + 12 : (innerWidth - w) / 2;
  let top = r ? r.top : (innerHeight - h) / 2;
  if (left + w > innerWidth - 8) left = r ? r.left - w - 12 : innerWidth - w - 8;
  left = Math.max(8, left);
  top = Math.min(Math.max(8, top), innerHeight - h - 8);
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function closeProfileCard() {
  $('profile-card').classList.add('hidden');
}

// Щелчок по аватарке или имени с data-profile открывает карточку; мимо карточки — закрывает
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-profile]');
  if (trigger) {
    e.stopPropagation();
    e.preventDefault();
    openProfileCard(Number(trigger.dataset.profile), trigger);
    return;
  }
  if (!e.target.closest('#profile-card')) closeProfileCard();
}, true);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeProfileCard());
