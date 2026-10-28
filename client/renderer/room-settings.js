// Настройки комнаты: обзор, роли с правами, участники (роль, кик на время, отключение, удаление, бан) и баны.
// Плюс окно «Пригласить друзей» и выбор времени кика. Открываются и из списка комнат, не заходя в комнату.

const PERM_INFO = [
  ['connect', 'Заходить в голосовой канал', 'Подключаться к общему разговору комнаты'],
  ['speak', 'Говорить', 'Без этого права микрофон в комнате всегда выключен'],
  ['video', 'Камера и демонстрация экрана', 'Включать камеру и показывать свой экран'],
  ['write', 'Писать в чат', 'Сообщения, файлы, картинки и смайлики'],
  ['invite', 'Приглашать друзей', 'Звать в комнату своих друзей'],
  ['kick', 'Кикать и отключать', 'Кик на время, отключение от голоса и удаление из комнаты'],
  ['ban', 'Банить', 'Убрать из комнаты насовсем — вернуть можно, только сняв бан'],
  ['manage', 'Настраивать комнату', 'Название, роли и права'],
  ['admin', 'Администратор', 'Может всё перечисленное; раздаёт только создатель'],
];

// Варианты кика на время: [секунды, подпись]
const KICK_TIMES = [
  [60, '1 минута'],
  [5 * 60, '5 минут'],
  [10 * 60, '10 минут'],
  [60 * 60, '1 час'],
  [24 * 3600, '1 день'],
  [7 * 24 * 3600, '1 неделя'],
];

let manageRoomId = null;
let manageTab = 'overview';
let selectedRoleId = 'default';
let memberQuery = '';

const manageRoom = () => roomById(manageRoomId);
const timeText = (ms) => new Date(ms).toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function smallButton(text, cls, onclick) {
  return el('button', { type: 'button', className: `btn ${cls}`, textContent: text, onclick });
}

function openRoomManage(roomId = state.selectedRoomId, tab = 'overview') {
  if (!roomById(roomId)) return;
  manageRoomId = roomId;
  manageTab = tab;
  memberQuery = '';
  $('rm-error').textContent = '';
  renderRoomManage();
  $('room-manage').classList.remove('hidden');
}

function closeRoomManage() {
  $('room-manage').classList.add('hidden');
  manageRoomId = null;
}

const TAB_TITLES = { overview: 'Обзор', roles: 'Роли и права', members: 'Участники', bans: 'Баны' };

function renderRoomManage() {
  const room = manageRoom();
  if (!room) return closeRoomManage();
  const isOwner = canRemoveRoom(room);
  $('rs-room-name').textContent = room.name;
  $('rs-title').textContent = TAB_TITLES[manageTab];
  const bans = room.bans || [];
  $('rm-ban-count').textContent = bans.length || '';
  for (const t of document.querySelectorAll('#rs-nav [data-tab]')) t.classList.toggle('active', t.dataset.tab === manageTab);
  $('rm-leave').textContent = isOwner ? 'Удалить комнату' : 'Выйти из комнаты';

  const body = $('rs-body');
  // Не перерисовываем поле, пока в нём печатают
  const focused = document.activeElement?.dataset?.keep;
  const draft = focused && document.activeElement.value;
  body.replaceChildren(...{ overview: overviewPane, roles: rolesPane, members: membersPane, bans: bansPane }[manageTab](room));
  if (focused) {
    const input = body.querySelector(`[data-keep="${focused}"]`);
    if (input) {
      input.value = draft;
      input.focus();
    }
  }
}

// ---------- Обзор ----------

function overviewPane(room) {
  const manage = can(room, PERMS.manage);
  const owner = memberOf(room, room.ownerId);
  const out = [];
  const name = el('input', { id: 'rm-name', maxLength: 40, value: room.name, disabled: !manage });
  name.dataset.keep = 'name';
  const form = el(
    'form',
    { className: 'rs-row', id: 'rm-rename' },
    el('label', { className: 'field grow' }, el('span', { textContent: 'Название комнаты' }), name),
    manage && el('button', { className: 'btn primary', textContent: 'Сохранить' })
  );
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (await roomAction(Api.patch(`/rooms/${room.id}`, { name: name.value.trim() }), 'Название сохранено')) renderVoice();
  };
  out.push(form);

  const facts = el('div', { className: 'rs-facts' });
  const fact = (label, value) => facts.append(el('div', {}, el('span', { className: 'muted small', textContent: label }), el('b', { textContent: value })));
  fact('Тип', room.kind === 'voice' ? 'Голосовая — разговор и чат' : 'Текстовая — только чат');
  fact('Создатель', owner?.displayName || '—');
  fact('Участники', `${room.members.length} из 50`);
  fact('Ролей', String(room.roles?.length || 0));
  out.push(facts);

  // Свои права — чтобы было понятно, что вам можно
  const mine = permsIn(room);
  const list = el('ul', { className: 'rs-my-perms' });
  for (const [key, label] of PERM_INFO) {
    if (key === 'admin') continue;
    list.append(el('li', { className: mine & PERMS[key] ? 'yes' : 'no', textContent: label }));
  }
  const myRole = isRoomOwner(room, state.me.id) ? 'Вы создатель — можно всё' : `Ваша роль: ${roleOf(room, state.me.id)?.name || 'без роли'}`;
  out.push(el('h4', { textContent: 'Что можно вам' }), el('p', { className: 'muted small', textContent: myRole }), list);
  return out;
}

// ---------- Роли ----------

function rolesPane(room) {
  const manage = can(room, PERMS.manage);
  const isOwner = isRoomOwner(room, state.me.id);
  if (selectedRoleId !== 'default' && !room.roles?.some((r) => r.id === selectedRoleId)) selectedRoleId = 'default';

  const list = el('div', { className: 'rs-role-list' });
  const item = (id, name, color, count) => {
    const b = el(
      'button',
      { type: 'button', className: `rs-role-item${selectedRoleId === id ? ' active' : ''}` },
      el('span', { className: 'role-dot' }),
      el('span', { className: 'grow ellipsis', textContent: name }),
      el('span', { className: 'muted small', textContent: count })
    );
    b.querySelector('.role-dot').style.background = color;
    b.dataset.role = id;
    b.onclick = () => {
      selectedRoleId = id;
      renderRoomManage();
    };
    return b;
  };
  const withoutRole = room.members.filter((m) => !isRoomOwner(room, m.id) && !m.roleId).length;
  list.append(item('default', 'Все без роли', 'var(--muted)', withoutRole));
  for (const r of room.roles || []) list.append(item(r.id, r.name, r.color, room.members.filter((m) => m.roleId === r.id).length));
  if (manage) {
    const create = smallButton('+ Создать роль', 'rs-create', () => {
      const n = (room.roles?.length || 0) + 1;
      // Новая роль начинается с прав по умолчанию — дальше их правят переключателями
      roomAction(Api.post(`/rooms/${room.id}/roles`, { name: `Роль ${n}`, color: '#5865f2', perms: (room.defaultPerms ?? ALL_PERMS) & ~PERMS.admin })).then((ok) => {
        const roles = manageRoom()?.roles || [];
        if (ok && roles.length) {
          selectedRoleId = roles.at(-1).id;
          renderRoomManage();
        }
      });
    });
    create.id = 'rm-role-new';
    list.append(create);
  }

  const role = selectedRoleId === 'default' ? null : room.roles.find((r) => r.id === selectedRoleId);
  const editable = manage && (!role || isOwner || !(role.perms & PERMS.admin));
  return [
    el('p', { className: 'hint-text', textContent: 'Создатель может всё. Остальным права даёт роль, а без роли действуют права «Все без роли». Кикать, банить и менять роли можно только тех, у кого прав меньше.' }),
    el('div', { className: 'rs-roles' }, list, roleEditor(room, role, editable)),
  ];
}

function roleEditor(room, role, editable) {
  const isOwner = isRoomOwner(room, state.me.id);
  const form = el('form', { className: 'rs-role-editor', id: 'rm-role-editor' });
  let nameInput = null;
  let colorInput = null;
  if (role) {
    nameInput = el('input', { value: role.name, maxLength: 24, disabled: !editable });
    nameInput.dataset.keep = `role-${role.id}`;
    colorInput = el('input', { type: 'color', value: role.color, disabled: !editable, title: 'Цвет имени' });
    form.append(
      el('div', { className: 'rs-row' },
        el('label', { className: 'field grow' }, el('span', { textContent: 'Название роли' }), nameInput),
        el('label', { className: 'field' }, el('span', { textContent: 'Цвет' }), colorInput))
    );
  } else {
    form.append(el('h4', { textContent: 'Все без роли' }), el('p', { className: 'muted small', textContent: 'Права всех, кому не назначена роль, — и новичков тоже.' }));
  }

  const perms = role ? role.perms : room.defaultPerms ?? ALL_PERMS;
  const boxes = {};
  const toggles = el('div', { className: 'perm-list' });
  for (const [key, label, hint] of PERM_INFO) {
    // У «всех без роли» админки не бывает, а раздаёт её только создатель
    if (key === 'admin' && !role) continue;
    const cb = el('input', { type: 'checkbox', className: 'switch', checked: Boolean(perms & PERMS[key]), disabled: !editable || (key === 'admin' && !isOwner) });
    cb.dataset.perm = key;
    boxes[key] = cb;
    toggles.append(el('label', { className: 'perm-item' }, el('div', { className: 'grow' }, el('div', { textContent: label }), el('div', { className: 'muted small', textContent: hint })), cb));
  }
  // Администратор и так может всё — остальные переключатели не нужны
  const syncAdmin = () => {
    for (const [key, cb] of Object.entries(boxes)) if (key !== 'admin') cb.closest('label').classList.toggle('dim', Boolean(boxes.admin?.checked));
  };
  boxes.admin?.addEventListener('change', syncAdmin);
  syncAdmin();
  form.append(el('h4', { textContent: 'Права' }), toggles);

  // Кто с этой ролью — и кому её дать
  if (role) {
    const holders = room.members.filter((m) => m.roleId === role.id);
    const box = el('div', { className: 'pc-chips rs-holders' });
    for (const m of holders) {
      const chip = el('span', { className: 'pc-chip', textContent: m.displayName });
      chip.style.setProperty('--chip', role.color);
      if (editable && (outranks(room, m.id) || m.id === state.me.id)) {
        const x = el('button', { type: 'button', className: 'chip-x', title: 'Снять роль', textContent: '×' });
        x.onclick = () => setMemberRole(room, m, null);
        chip.append(x);
      }
      box.append(chip);
    }
    if (!holders.length) box.append(el('span', { className: 'muted small', textContent: 'Пока ни у кого' }));
    const candidates = room.members.filter((m) => !isRoomOwner(room, m.id) && m.roleId !== role.id && (outranks(room, m.id) || m.id === state.me.id));
    const add = editable && candidates.length && el('select', { className: 'role-select', id: 'rm-role-assign' }, new Option('+ Назначить участнику', ''), ...candidates.map((m) => new Option(m.displayName, m.id)));
    if (add) add.onchange = () => add.value && setMemberRole(room, memberOf(room, Number(add.value)), role.id);
    form.append(el('h4', { textContent: `С этой ролью — ${holders.length}` }), box, add);
  }

  if (editable) {
    form.append(
      el('div', { className: 'row rs-actions' },
        role && smallButton('Удалить роль', 'danger-outline', () => deleteRole(room, role)),
        el('div', { className: 'spacer' }),
        el('button', { className: 'btn primary', textContent: 'Сохранить' }))
    );
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    let value = 0;
    for (const [key, cb] of Object.entries(boxes)) if (cb.checked) value |= PERMS[key];
    const body = role ? { name: nameInput.value.trim(), color: colorInput.value, perms: value } : { defaultPerms: value };
    await roomAction(role ? Api.patch(`/rooms/${room.id}/roles/${role.id}`, body) : Api.patch(`/rooms/${room.id}`, body), 'Права сохранены');
  };
  return form;
}

// ---------- Участники ----------

function membersPane(room) {
  const manage = can(room, PERMS.manage);
  const inVoice = new Set((room.voice || []).map((p) => p.userId));
  const out = [];

  const search = el('input', { className: 'friend-search', placeholder: 'Поиск участников', value: memberQuery });
  search.dataset.keep = 'member-search';
  search.oninput = () => {
    memberQuery = search.value;
    renderRoomManage();
  };
  const top = el('div', { className: 'rs-row' }, search);
  if (can(room, PERMS.invite)) top.append(smallButton('Пригласить друзей', 'primary', () => openRoomInvite(room.id)));
  out.push(top);

  const q = memberQuery.trim().toLowerCase();
  const members = room.members.filter((m) => !q || `${m.displayName} ${m.username}`.toLowerCase().includes(q));
  out.push(el('div', { className: 'list-title', textContent: `Участники — ${members.length}` }));
  const list = el('div', { className: 'member-list', id: 'rm-members' });

  for (const m of members) {
    const mine = m.id === state.me.id;
    const above = !mine && outranks(room, m.id);
    const role = roleOf(room, m.id);
    const until = timeoutOf(room, m.id);
    const name = el('div', { className: 'ellipsis member-name', textContent: mine ? `${m.displayName} (вы)` : m.displayName });
    if (role) name.style.color = role.color;
    const tags = el('div', { className: 'member-tags' }, el('span', { className: 'muted small', textContent: `@${m.username}` }));
    const tag = (text, cls = '') => tags.append(el('span', { className: `tag ${cls}`, textContent: text }));
    if (isRoomOwner(room, m.id)) tag(m.id === room.ownerId ? 'Создатель' : 'Создатель канала', 'owner');
    else tag(role?.name || 'Без роли');
    if (inVoice.has(m.id)) tag('В голосе', 'live');
    if (until) tag(`Кик до ${timeText(until)}`, 'kicked');
    const info = el('div', { className: 'grow member-info' }, name, tags);
    info.dataset.profile = m.id;
    const avatar = makeAvatar(m, presenceOf(m));
    avatar.dataset.profile = m.id;
    const actions = el('div', { className: 'member-actions' });

    // Роль назначает тот, у кого есть право, и только тем, кто младше (себе — тоже можно, кроме создателя)
    if (manage && !isRoomOwner(room, m.id) && (above || mine)) {
      const select = el('select', { className: 'role-select', title: 'Роль' }, new Option('Без роли', ''));
      for (const r of room.roles || []) {
        const opt = new Option(r.name, r.id);
        opt.disabled = Boolean(r.perms & PERMS.admin) && !isRoomOwner(room, state.me.id);
        select.add(opt);
      }
      select.value = m.roleId ?? '';
      select.onchange = () => setMemberRole(room, m, select.value ? Number(select.value) : null);
      actions.append(select);
    }
    if (above && can(room, PERMS.kick)) {
      actions.append(until ? smallButton('Снять кик', '', () => liftKick(room, m)) : smallButton('Кик', 'warn-outline', () => openKick(room, m)));
      if (inVoice.has(m.id)) actions.append(smallButton('Отключить', '', () => disconnectMember(room, m)));
      actions.append(smallButton('Исключить', 'danger-outline', () => removeRoomMember(room, m)));
    }
    if (above && can(room, PERMS.ban)) actions.append(smallButton('Бан', 'danger', () => banMember(room, m)));
    list.append(el('div', { className: 'member-row' }, avatar, info, actions));
  }
  out.push(list);
  return out;
}

// ---------- Баны ----------

function bansPane(room) {
  const bans = room.bans || [];
  const list = el('div', { className: 'member-list', id: 'rm-bans' });
  if (!bans.length) list.append(el('p', { className: 'muted', textContent: 'Забаненных нет. Забаненного нельзя снова позвать в комнату, пока не снимете бан.' }));
  for (const b of bans) {
    const info = el('div', { className: 'grow' }, el('div', { textContent: b.displayName }), el('div', { className: 'muted small', textContent: `@${b.username} · забанен ${new Date(b.bannedAt).toLocaleDateString('ru')}` }));
    const row = el('div', { className: 'member-row' }, makeAvatar(b, undefined, 'small'), info);
    if (can(room, PERMS.ban)) row.append(smallButton('Снять бан', '', () => roomAction(Api.del(`/rooms/${room.id}/bans/${b.id}`), `${b.displayName} разбанен`)));
    list.append(row);
  }
  return [list];
}

// ---------- Действия ----------

// Запрос к серверу: свежая комната приходит ответом (и всем остальным — через room:updated)
async function roomAction(request, done, errorBox = $('rm-error')) {
  errorBox.textContent = '';
  try {
    const updated = await request;
    if (updated?.id) applyRoomUpdate(updated);
    if (done) toast(done);
    return true;
  } catch (err) {
    errorBox.textContent = err.message;
    if (errorBox.closest('.hidden')) toast(err.message);
    return false;
  }
}

function setMemberRole(room, member, roleId) {
  return roomAction(Api.put(`/rooms/${room.id}/members/${member.id}/role`, { roleId }));
}

function removeRoomMember(room, member) {
  if (!confirm(`Исключить ${member.displayName} из комнаты «${room.name}»? Пригласить обратно можно будет в любой момент.`)) return;
  roomAction(Api.del(`/rooms/${room.id}/members/${member.id}`), `${member.displayName} исключён из комнаты`);
}

function banMember(room, member) {
  if (!confirm(`Забанить ${member.displayName}? Он пропадёт из комнаты «${room.name}», и позвать его обратно не получится, пока бан не снимут.`)) return;
  roomAction(Api.post(`/rooms/${room.id}/bans`, { userId: member.id }), `${member.displayName} забанен`);
}

function disconnectMember(room, member) {
  roomAction(Api.del(`/rooms/${room.id}/voice/${member.id}`), `${member.displayName} отключён от голоса`);
}

function liftKick(room, member) {
  roomAction(Api.del(`/rooms/${room.id}/timeouts/${member.id}`), `Кик снят: ${member.displayName} снова может всё, что даёт роль`);
}

function deleteRole(room, role) {
  if (!confirm(`Удалить роль «${role.name}»? У её участников останутся права «Все без роли».`)) return;
  roomAction(Api.del(`/rooms/${room.id}/roles/${role.id}`));
}

// ---------- Кик на время ----------

let kickTarget = null;

function openKick(room, member) {
  kickTarget = { roomId: room.id, member };
  $('kick-title').textContent = `Кикнуть ${member.displayName}`;
  $('kick-hint').textContent = `Пока идёт кик, ${member.displayName} остаётся в «${room.name}», но может только читать чат: не пишет, не заходит в голос. Когда время выйдет, права роли вернутся сами.`;
  const box = $('kick-options');
  box.replaceChildren();
  KICK_TIMES.forEach(([seconds, label], i) => {
    const input = el('input', { type: 'radio', name: 'kick-time', value: seconds, checked: i === 1 });
    box.append(el('label', { className: 'kick-option' }, input, el('span', { textContent: label })));
  });
  $('kick-error').textContent = '';
  $('room-kick').classList.remove('hidden');
}

$('kick-form').onsubmit = async (e) => {
  e.preventDefault();
  if (!kickTarget) return;
  const seconds = Number(document.querySelector('input[name="kick-time"]:checked').value);
  const label = KICK_TIMES.find(([s]) => s === seconds)[1];
  const { roomId, member } = kickTarget;
  if (await roomAction(Api.post(`/rooms/${roomId}/timeouts`, { userId: member.id, seconds }), `Кик на ${label}: ${member.displayName}`, $('kick-error'))) {
    $('room-kick').classList.add('hidden');
    kickTarget = null;
  }
};
$('kick-cancel').onclick = () => $('room-kick').classList.add('hidden');

// ---------- Пригласить друзей ----------

let inviteRoomId = null;

function openRoomInvite(roomId) {
  if (!roomById(roomId)) return;
  inviteRoomId = roomId;
  $('ri-search').value = '';
  $('ri-error').textContent = '';
  renderRoomInvite();
  $('room-invite').classList.remove('hidden');
  $('ri-search').focus();
}

function renderRoomInvite() {
  const room = roomById(inviteRoomId);
  if (!room) return $('room-invite').classList.add('hidden');
  // В комнату канала зовут её участников (например, тех, кого из комнаты убрали); новых друзей — в сам канал
  const hub = state.hubs.get(room.hubId);
  const people = hub ? hub.members.filter((m) => m.id !== state.me.id) : [...state.contacts.values()];
  $('ri-title').textContent = hub ? `Пригласить участников канала в «${room.name}»` : `Пригласить друзей в «${room.name}»`;
  const q = $('ri-search').value.trim().toLowerCase();
  const inRoom = new Set(room.members.map((m) => m.id));
  const banned = new Set((room.bans || []).map((b) => b.id));
  const friends = people
    .filter((c) => !q || `${c.displayName} ${c.username}`.toLowerCase().includes(q))
    .sort((a, b) => inRoom.has(a.id) - inRoom.has(b.id) || a.displayName.localeCompare(b.displayName, 'ru'));
  const list = $('ri-list');
  list.replaceChildren();
  if (!people.length)
    list.append(el('p', { className: 'muted', textContent: hub ? 'В канале пока никого, кроме вас. Друзей зовут в сам канал — через его меню.' : 'Позвать можно только друзей, а их пока нет. Добавьте их в разделе «Друзья».' }));
  else if (!friends.length) list.append(el('p', { className: 'muted', textContent: 'Никого не нашли' }));
  for (const f of friends) {
    const info = el('div', { className: 'grow ellipsis' }, el('div', { className: 'ellipsis', textContent: f.displayName }), el('div', { className: 'muted small', textContent: `@${f.username}` }));
    let action;
    if (inRoom.has(f.id)) action = el('span', { className: 'muted small', textContent: 'Уже в комнате' });
    else if (banned.has(f.id)) action = el('span', { className: 'small error-text', textContent: 'Забанен' });
    else action = smallButton('Пригласить', 'primary', () => roomAction(Api.post(`/rooms/${room.id}/members`, { userIds: [f.id] }), `${f.displayName} теперь в «${room.name}»`, $('ri-error')));
    list.append(el('div', { className: 'member-row' }, makeAvatar(f, presenceOf(f), 'small'), info, action));
  }
}

$('ri-search').oninput = renderRoomInvite;
$('ri-close').onclick = () => $('room-invite').classList.add('hidden');

// ---------- Разметка окна ----------

for (const t of document.querySelectorAll('#rs-nav [data-tab]')) {
  t.onclick = () => {
    manageTab = t.dataset.tab;
    renderRoomManage();
  };
}
$('room-manage-btn').onclick = () => openRoomManage(state.selectedRoomId);
$('rm-close').onclick = closeRoomManage;

$('rm-leave').onclick = async () => {
  const room = manageRoom();
  if (!room) return;
  const isOwner = canRemoveRoom(room);
  const question = isOwner
    ? `Удалить комнату «${room.name}» вместе с сообщениями? Это нельзя отменить.`
    : `Выйти из комнаты «${room.name}»? Вернуть вас сможет любой, у кого есть право звать друзей.`;
  if (!confirm(question)) return;
  try {
    if (isOwner) await Api.del(`/rooms/${room.id}`);
    else await Api.del(`/rooms/${room.id}/members/${state.me.id}`);
    closeRoomManage();
    forgetRoom(room.id);
  } catch (err) {
    $('rm-error').textContent = err.message;
  }
};
