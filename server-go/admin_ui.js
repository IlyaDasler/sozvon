(() => {
  'use strict';

  const state = { csrf: '', me: null, tab: 'users' };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = (ms) => (ms ? new Date(Number(ms)).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const isSuper = () => state.me?.role?.Role === 'super_admin';

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
    if (opts.body && !opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    if (opts.method && opts.method !== 'GET' && state.csrf) opts.headers['X-CSRF-Token'] = state.csrf;
    const response = await fetch(path, opts);
    let data = null;
    try { data = await response.json(); } catch {}
    if (response.status === 401) { showLogin(); throw new Error(data?.error || 'Требуется вход'); }
    if (!response.ok) throw new Error(data?.error || `Ошибка ${response.status}`);
    return data;
  }

  function banner(message, error = false) {
    const el = $('banner');
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
    el.style.borderColor = error ? 'rgba(255,107,107,.5)' : '';
  }

  function showLogin() {
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    state.csrf = '';
  }

  function showApp() {
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('me-name').textContent = state.me?.user?.displayName || state.me?.user?.username || '';
    $('me-role').textContent = state.me?.role?.Role === 'super_admin' ? 'super admin' : 'модератор';
    for (const tab of ['approvals', 'roles']) {
      const button = document.querySelector(`#nav button[data-tab="${tab}"]`);
      if (button) button.classList.toggle('hidden', !isSuper());
    }
  }

  async function login(event) {
    event.preventDefault();
    const button = $('login-button');
    button.disabled = true;
    $('login-error').textContent = '';
    try {
      const result = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          username: $('login-username').value.trim(),
          password: $('login-password').value,
          totpCode: $('login-totp').value.trim(),
        }),
      });
      state.csrf = result.csrfToken;
      state.me = result;
      showApp();
      if (result.needsTotp) banner('Включите 2FA в приложении. Пока админка работает без второго фактора.');
      await openTab('users');
    } catch (error) {
      if (/код|2FA|аутентификатор/i.test(error.message)) $('totp-field').classList.remove('hidden');
      $('login-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    state.me = null;
    showLogin();
  }

  async function loadMe() {
    try {
      const result = await api('/api/admin/me');
      state.csrf = result.csrfToken;
      state.me = result;
      showApp();
      return true;
    } catch { return false; }
  }

  function table(rows, columns, actions) {
    if (!rows || !rows.length) return '<div class="empty">Ничего нет</div>';
    return `<table><thead><tr>${columns.map((c) => `<th>${esc(c.title)}</th>`).join('')}${actions ? '<th></th>' : ''}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((c) => `<td>${c.value(row)}</td>`).join('')}${actions ? `<td><div class="row-actions">${actions(row)}</div></td>` : ''}</tr>`).join('')}</tbody></table>`;
  }

  async function loadUsers() {
    const params = new URLSearchParams({ q: $('users-q').value.trim(), status: $('users-status').value, limit: '100' });
    try {
      const result = await api(`/api/admin/users?${params}`);
      $('users-table').innerHTML = table(result.users, [
        { title: 'ID', value: (u) => `<code>${u.ID}</code>` },
        { title: 'Аккаунт', value: (u) => `<div>${esc(u.DisplayName)}</div><div class="muted">@${esc(u.Username)}</div>` },
        { title: 'Статус', value: (u) => u.BannedAt ? '<span class="pill danger">забанен</span>' : u.SuspendedAt ? '<span class="pill warn">заморожен</span>' : u.DeletedAt ? '<span class="pill">удалён</span>' : '<span class="pill ok">активен</span>' },
        { title: 'Последний вход', value: (u) => fmt(u.LastLoginAt) },
        { title: 'Регистрация', value: (u) => fmt(u.CreatedAt) },
        { title: 'Роль', value: (u) => u.Role ? `<span class="pill">${esc(u.Role)}</span>` : '—' },
        { title: 'Сессии', value: (u) => u.Sessions },
      ], (u) => {
        const buttons = [];
        if (!u.BannedAt) {
          if (u.SuspendedAt) buttons.push(`<button class="small" data-action="unsuspend" data-id="${u.ID}">Разморозить</button>`);
          else buttons.push(`<button class="small" data-action="suspend" data-id="${u.ID}">Заморозить</button>`);
          buttons.push(`<button class="small danger" data-action="ban" data-id="${u.ID}">Забанить</button>`);
        } else {
          buttons.push(`<button class="small" data-action="unban" data-id="${u.ID}">Разбанить</button>`);
        }
        return buttons.join('');
      });
    } catch (error) { banner(error.message, true); }
  }

  async function loadChannels() {
    const params = new URLSearchParams({ q: $('channels-q').value.trim(), kind: $('channels-kind').value, limit: '100' });
    try {
      const result = await api(`/api/admin/channels?${params}`);
      $('channels-table').innerHTML = table(result.channels, [
        { title: 'Тип', value: (c) => c.Kind === 'hub' ? 'хаб' : 'комната' },
        { title: 'Канал', value: (c) => `<div>${esc(c.Name)}</div><div class="muted"><code>${c.ID}</code></div>` },
        { title: 'Владелец', value: (c) => `${esc(c.OwnerName)} <span class="muted">#${c.OwnerID}</span>` },
        { title: 'Участники', value: (c) => c.Members },
        { title: 'Приватность', value: (c) => `<select data-privacy="${c.Kind}:${c.ID}"><option value="public" ${c.Privacy === 'public' ? 'selected' : ''}>public</option><option value="hidden" ${c.Privacy === 'hidden' ? 'selected' : ''}>hidden</option></select>` },
        { title: 'Создан', value: (c) => fmt(c.CreatedAt) },
      ], (c) => `<button class="small danger" data-action="delete-channel" data-kind="${c.Kind}" data-id="${c.ID}">Удалить</button>`);
      document.querySelectorAll('[data-privacy]').forEach((select) => {
        select.addEventListener('change', async () => {
          const [kind, id] = select.dataset.privacy.split(':');
          try {
            await api(`/api/admin/channels/${kind}/${id}/privacy`, { method: 'PATCH', body: JSON.stringify({ privacy: select.value, reason: 'Смена приватности в админке' }) });
            banner('Приватность обновлена');
          } catch (error) { banner(error.message, true); await loadChannels(); }
        });
      });
    } catch (error) { banner(error.message, true); }
  }

  async function loadReports() {
    try {
      const result = await api('/api/admin/reports?status=open');
      $('reports-table').innerHTML = table(result.reports, [
        { title: 'ID', value: (r) => r.ID },
        { title: 'Цель', value: (r) => `${r.TargetType} #${r.TargetID}` },
        { title: 'Категория', value: (r) => esc(r.Category) },
        { title: 'Причина', value: (r) => esc(r.Reason) },
        { title: 'Создана', value: (r) => fmt(r.CreatedAt) },
      ], (r) => `<button class="small" data-action="report-resolve" data-id="${r.ID}" data-status="resolved">Решена</button><button class="small" data-action="report-resolve" data-id="${r.ID}" data-status="rejected">Отклонить</button>`);
    } catch (error) { banner(error.message, true); }
  }

  async function loadAppeals() {
    try {
      const result = await api('/api/admin/appeals?status=open');
      $('appeals-table').innerHTML = table(result.appeals, [
        { title: 'ID', value: (a) => a.id },
        { title: 'Логин', value: (a) => esc(a.username) },
        { title: 'Контакт', value: (a) => esc(a.contact) },
        { title: 'Причина', value: (a) => esc(a.reason) },
        { title: 'Создана', value: (a) => fmt(a.createdAt) },
      ], (a) => `<button class="small" data-action="appeal-resolve" data-id="${a.id}" data-status="accepted">Принять</button><button class="small danger" data-action="appeal-resolve" data-id="${a.id}" data-status="rejected">Отклонить</button>`);
    } catch (error) { banner(error.message, true); }
  }

  async function loadApprovals() {
    try {
      const result = await api('/api/admin/approvals?status=pending');
      $('approvals-table').innerHTML = table(result.approvals, [
        { title: 'ID', value: (a) => a.ID },
        { title: 'Действие', value: (a) => esc(a.Action) },
        { title: 'Цель', value: (a) => `${esc(a.TargetType)} #${a.TargetID}` },
        { title: 'Причина', value: (a) => esc(a.Reason) },
        { title: 'Запросил', value: (a) => a.RequestedBy },
        { title: 'Когда', value: (a) => fmt(a.RequestedAt) },
      ], (a) => `<button class="small" data-action="approve" data-id="${a.ID}">Подтвердить</button><button class="small danger" data-action="reject" data-id="${a.ID}">Отклонить</button>`);
    } catch (error) { banner(error.message, true); }
  }

  async function loadRoles() {
    try {
      const result = await api('/api/admin/roles');
      $('roles-table').innerHTML = table(result.roles, [
        { title: 'Пользователь', value: (r) => `#${r.UserID}` },
        { title: 'Роль', value: (r) => esc(r.Role) },
        { title: 'Права', value: (r) => r.Permissions },
        { title: 'До', value: (r) => r.ExpiresAt ? fmt(r.ExpiresAt) : 'бессрочно' },
      ], (r) => `<button class="small danger" data-action="revoke-role" data-id="${r.UserID}">Отозвать</button>`);
    } catch (error) { banner(error.message, true); }
  }

  async function loadAudit() {
    try {
      const result = await api('/api/admin/audit');
      $('audit-table').innerHTML = table(result.audit, [
        { title: 'Время', value: (a) => fmt(a.CreatedAt) },
        { title: 'Кто', value: (a) => a.ActorID },
        { title: 'Действие', value: (a) => esc(a.Action) },
        { title: 'Цель', value: (a) => a.TargetType ? `${a.TargetType} #${a.TargetID}` : '—' },
        { title: 'Причина', value: (a) => esc(a.Reason) },
      ]);
    } catch (error) { banner(error.message, true); }
  }

  async function openTab(name) {
    state.tab = name;
    document.querySelectorAll('#nav button').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.add('hidden'));
    $(`tab-${name}`).classList.remove('hidden');
    banner('');
    if (name === 'users') await loadUsers();
    if (name === 'channels') await loadChannels();
    if (name === 'reports') await loadReports();
    if (name === 'appeals') await loadAppeals();
    if (name === 'approvals') await loadApprovals();
    if (name === 'roles') await loadRoles();
    if (name === 'audit') await loadAudit();
  }

  async function act(action, dataset) {
    const reason = ['suspend', 'ban', 'delete-channel', 'reject', 'report-resolve', 'appeal-resolve'].includes(action) ? prompt('Причина действия:') : null;
    if (['suspend', 'ban', 'delete-channel'].includes(action) && !reason) return;
    try {
      if (action === 'suspend') await api(`/api/admin/users/${dataset.id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) });
      if (action === 'unsuspend') await api(`/api/admin/users/${dataset.id}/suspend`, { method: 'DELETE' });
      if (action === 'ban') {
        const result = await api(`/api/admin/users/${dataset.id}/ban`, { method: 'POST', body: JSON.stringify({ reason }) });
        banner(result.pending ? `Заявка #${result.approvalId} создана. Нужно подтверждение super admin.` : 'Пользователь забанен.');
      }
      if (action === 'unban') {
        const result = await api(`/api/admin/users/${dataset.id}/unban`, { method: 'POST' });
        banner(`Аккаунт восстановлен. Временный пароль: ${result.temporaryPassword} (показать один раз)`);
      }
      if (action === 'delete-channel') {
        const result = await api(`/api/admin/channels/${dataset.kind}/${dataset.id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
        banner(result.pending ? `Заявка #${result.approvalId} создана.` : 'Канал удалён безвозвратно.');
      }
      if (action === 'approve') await api(`/api/admin/approvals/${dataset.id}/approve`, { method: 'POST' });
      if (action === 'reject') await api(`/api/admin/approvals/${dataset.id}/reject`, { method: 'POST', body: JSON.stringify({ resolution: reason || 'rejected' }) });
      if (action === 'report-resolve') await api(`/api/admin/reports/${dataset.id}/resolve`, { method: 'POST', body: JSON.stringify({ status: dataset.status, resolution: reason || '' }) });
      if (action === 'appeal-resolve') await api(`/api/admin/appeals/${dataset.id}/resolve`, { method: 'POST', body: JSON.stringify({ status: dataset.status, resolution: reason || '' }) });
      if (action === 'revoke-role') await api(`/api/admin/roles/${dataset.id}`, { method: 'DELETE' });
      await openTab(state.tab);
    } catch (error) { banner(error.message, true); }
  }

  $('login-form').addEventListener('submit', login);
  $('logout').addEventListener('click', logout);
  document.querySelectorAll('#nav button').forEach((button) => button.addEventListener('click', () => openTab(button.dataset.tab)));
  $('users-refresh').addEventListener('click', loadUsers);
  $('channels-refresh').addEventListener('click', loadChannels);
  $('users-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadUsers(); });
  $('channels-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadChannels(); });
  $('users-status').addEventListener('change', loadUsers);
  $('channels-kind').addEventListener('change', loadChannels);
  $('role-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const expires = $('role-expires').value ? new Date(`${$('role-expires').value}T23:59:59`).getTime() : 0;
      await api('/api/admin/roles', { method: 'POST', body: JSON.stringify({ userId: Number($('role-user').value), role: $('role-name').value, expiresAt: expires, reason: $('role-reason').value }) });
      banner('Роль выдана');
      $('role-form').reset();
      await loadRoles();
    } catch (error) { banner(error.message, true); }
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    act(button.dataset.action, button.dataset);
  });

  loadMe().then(async (ok) => { if (ok) await openTab('users'); });
})();
