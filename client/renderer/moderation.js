// Клиентская модерация: обычная сессия приложения, отдельного входа нет.
// Все данные — только метаданные; переписка и ключи сюда не приходят.
(() => {
  'use strict';

  const state = { me: null, tab: 'users' };
  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = (ms) => (ms ? new Date(Number(ms)).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const isSuper = () => Boolean(state.me?.isSuper);

  async function api(path, options = {}) {
    return Api.request(options.method || 'GET', `/moderation${path}`, options.body);
  }

  function fail(message) {
    el('moderation-error').textContent = message || '';
  }

  async function refreshModerationAccess() {
    try {
      state.me = await api('/me');
      el('moderation-btn').classList.remove('hidden');
      el('moderation-role').textContent = isSuper() ? 'super admin' : 'модератор';
      for (const tab of ['approvals', 'roles']) {
        const button = document.querySelector(`#moderation-nav [data-mod-tab="${tab}"]`);
        if (button) button.classList.toggle('hidden', !isSuper());
      }
      return true;
    } catch {
      state.me = null;
      el('moderation-btn').classList.add('hidden');
      return false;
    }
  }

  function actionButtons(id, status, banned, suspended) {
    const buttons = [];
    if (banned) return `<button class="btn small" data-mod-action="unban" data-id="${id}">Разбанить</button>`;
    if (suspended) buttons.push(`<button class="btn small" data-mod-action="unsuspend" data-id="${id}">Разморозить</button>`);
    else buttons.push(`<button class="btn small" data-mod-action="suspend" data-id="${id}">Заморозить</button>`);
    buttons.push(`<button class="btn small danger" data-mod-action="ban" data-id="${id}">Забанить</button>`);
    return buttons.join('');
  }

  function table(rows, headers, render) {
    if (!rows?.length) return '<div class="mod-empty">Ничего нет</div>';
    return `<table class="mod-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${render(row)}</tr>`).join('')}</tbody></table>`;
  }

  async function usersTab() {
    el('moderation-title').textContent = 'Пользователи';
    el('moderation-content').innerHTML = `
      <div class="moderation-toolbar">
        <input id="mod-users-q" placeholder="ID, логин или имя">
        <select id="mod-users-status"><option value="">Все статусы</option><option value="active">Активные</option><option value="suspended">Замороженные</option><option value="banned">Забаненные</option><option value="deleted">Удалённые</option></select>
        <button class="btn" id="mod-users-refresh">Обновить</button>
      </div>
      <p class="mod-note">Дата последнего входа и сессии — даже для забаненных и удалённых. Переписка и ключи недоступны.</p>
      <div id="mod-users-list"></div>`;
    const load = async () => {
      const q = encodeURIComponent(el('mod-users-q').value.trim());
      const status = encodeURIComponent(el('mod-users-status').value);
      const data = await api(`/users?q=${q}&status=${status}&limit=100`);
      el('mod-users-list').innerHTML = table(data.users, ['ID', 'Логин', 'Имя', 'Статус', 'Последний вход', 'Роль', 'Действия'], (user) => `
        <td><code>${user.ID}</code></td>
        <td><code>@${esc(user.Username)}</code></td>
        <td><b>${esc(user.DisplayName)}</b></td>
        <td>${user.BannedAt ? '<span class="mod-pill danger">забанен</span>' : user.SuspendedAt ? '<span class="mod-pill warn">заморожен</span>' : user.DeletedAt ? '<span class="mod-pill">удалён</span>' : '<span class="mod-pill ok">активен</span>'}</td>
        <td>${fmt(user.LastLoginAt)}</td>
        <td>${user.Role ? `<span class="mod-pill">${esc(user.Role)}</span>` : '—'}</td>
        <td><div class="mod-actions">${actionButtons(user.ID, user.Status, Boolean(user.BannedAt), Boolean(user.SuspendedAt))}</div></td>`);
    };
    el('mod-users-refresh').onclick = () => load().catch((error) => fail(error.message));
    el('mod-users-status').onchange = () => load().catch((error) => fail(error.message));
    el('mod-users-q').onkeydown = (event) => { if (event.key === 'Enter') load().catch((error) => fail(error.message)); };
    await load();
  }

  async function channelsTab() {
    el('moderation-title').textContent = 'Каналы';
    el('moderation-content').innerHTML = `
      <div class="moderation-toolbar">
        <input id="mod-channels-q" placeholder="Название или ID">
        <select id="mod-channels-kind"><option value="">Все типы</option><option value="hub">Хабы</option><option value="room">Комнаты</option></select>
        <button class="btn" id="mod-channels-refresh">Обновить</button>
      </div>
      <p class="mod-note">Все каналы, включая hidden. Приватность меняется здесь; содержимое сообщений не отображается.</p>
      <div id="mod-channels-list"></div>`;
    const load = async () => {
      const q = encodeURIComponent(el('mod-channels-q').value.trim());
      const kind = encodeURIComponent(el('mod-channels-kind').value);
      const data = await api(`/channels?q=${q}&kind=${kind}&limit=100`);
      el('mod-channels-list').innerHTML = table(data.channels, ['Канал', 'Тип', 'Владелец', 'Участники', 'Приватность', 'Действия'], (channel) => `
        <td><b>${esc(channel.Name)}</b><div class="muted small">#${channel.ID}</div></td>
        <td>${channel.Kind === 'hub' ? 'хаб' : 'комната'}</td>
        <td>${esc(channel.OwnerName)} <span class="muted small">#${channel.OwnerID}</span></td>
        <td>${channel.Members}</td>
        <td><select data-mod-privacy="${channel.Kind}:${channel.ID}"><option value="public" ${channel.Privacy === 'public' ? 'selected' : ''}>public</option><option value="hidden" ${channel.Privacy === 'hidden' ? 'selected' : ''}>hidden</option></select></td>
        <td><button class="btn small danger" data-mod-action="delete-channel" data-kind="${channel.Kind}" data-id="${channel.ID}">Удалить</button></td>`);
      for (const select of el('mod-channels-list').querySelectorAll('[data-mod-privacy]')) {
        select.onchange = async () => {
          const [kindValue, id] = select.dataset.modPrivacy.split(':');
          try {
            await api(`/channels/${kindValue}/${id}/privacy`, { method: 'PATCH', body: { privacy: select.value, reason: 'Смена приватности в клиенте' } });
            toast('Приватность обновлена');
          } catch (error) { fail(error.message); await load(); }
        };
      }
    };
    el('mod-channels-refresh').onclick = () => load().catch((error) => fail(error.message));
    el('mod-channels-kind').onchange = () => load().catch((error) => fail(error.message));
    el('mod-channels-q').onkeydown = (event) => { if (event.key === 'Enter') load().catch((error) => fail(error.message)); };
    await load();
  }

  async function reportsTab() {
    el('moderation-title').textContent = 'Жалобы';
    el('moderation-content').innerHTML = '<p class="mod-note">Только метаданные жалобы. Переписка не прикладывается.</p><div id="mod-reports-list"></div>';
    const data = await api('/reports?status=open');
    el('mod-reports-list').innerHTML = table(data.reports, ['ID', 'Цель', 'Категория', 'Причина', 'Создана', 'Действия'], (report) => `
      <td>${report.ID}</td><td>${esc(report.TargetType)} #${report.TargetID}</td><td>${esc(report.Category)}</td>
      <td>${esc(report.Reason)}</td><td>${fmt(report.CreatedAt)}</td>
      <td><div class="mod-actions"><button class="btn small" data-mod-action="report-resolve" data-id="${report.ID}" data-status="resolved">Решена</button><button class="btn small danger" data-mod-action="report-resolve" data-id="${report.ID}" data-status="rejected">Отклонить</button></div></td>`);
  }

  async function appealsTab() {
    el('moderation-title').textContent = 'Апелляции';
    el('moderation-content').innerHTML = '<p class="mod-note">Обращения забаненных пользователей.</p><div id="mod-appeals-list"></div>';
    const data = await api('/appeals?status=open');
    el('mod-appeals-list').innerHTML = table(data.appeals, ['ID', 'Логин', 'Контакт', 'Причина', 'Создана', 'Действия'], (appeal) => `
      <td>${appeal.id}</td><td>${esc(appeal.username)}</td><td>${esc(appeal.contact)}</td><td>${esc(appeal.reason)}</td><td>${fmt(appeal.createdAt)}</td>
      <td><div class="mod-actions"><button class="btn small" data-mod-action="appeal-resolve" data-id="${appeal.id}" data-status="accepted">Принять</button><button class="btn small danger" data-mod-action="appeal-resolve" data-id="${appeal.id}" data-status="rejected">Отклонить</button></div></td>`);
  }

  async function approvalsTab() {
    el('moderation-title').textContent = 'Подтверждения';
    el('moderation-content').innerHTML = '<p class="mod-note">Подтвердить необратимое действие может только super admin.</p><div id="mod-approvals-list"></div>';
    const data = await api('/approvals?status=pending');
    el('mod-approvals-list').innerHTML = table(data.approvals, ['ID', 'Действие', 'Цель', 'Причина', 'Запросил', 'Действия'], (item) => `
      <td>${item.ID}</td><td>${esc(item.Action)}</td><td>${esc(item.TargetType)} #${item.TargetID}</td><td>${esc(item.Reason)}</td><td>#${item.RequestedBy}</td>
      <td><div class="mod-actions"><button class="btn small" data-mod-action="approve" data-id="${item.ID}">Подтвердить</button><button class="btn small danger" data-mod-action="reject" data-id="${item.ID}">Отклонить</button></div></td>`);
  }

  async function rolesTab() {
    el('moderation-title').textContent = 'Роли';
    el('moderation-content').innerHTML = `
      <p class="mod-note">Только super admin может выдавать и отзывать роли.</p>
      <form id="mod-role-form" class="mod-form">
        <label>ID пользователя<input id="mod-role-user" inputmode="numeric" required></label>
        <label>Роль<select id="mod-role-name"><option value="moderator">Модератор</option><option value="super_admin">Super admin</option></select></label>
        <label>До<input id="mod-role-expires" type="date"></label>
        <label>Причина<input id="mod-role-reason" required></label>
        <button class="btn primary" type="submit">Выдать</button>
      </form>
      <div id="mod-roles-list"></div>`;
    const load = async () => {
      const data = await api('/roles');
      el('mod-roles-list').innerHTML = table(data.roles, ['Пользователь', 'Роль', 'Права', 'До', 'Действия'], (role) => `
        <td>#${role.UserID}</td><td>${esc(role.Role)}</td><td>${role.Permissions}</td><td>${role.ExpiresAt ? fmt(role.ExpiresAt) : 'бессрочно'}</td>
        <td><button class="btn small danger" data-mod-action="revoke-role" data-id="${role.UserID}">Отозвать</button></td>`);
    };
    el('mod-role-form').onsubmit = async (event) => {
      event.preventDefault();
      try {
        const expires = el('mod-role-expires').value ? new Date(`${el('mod-role-expires').value}T23:59:59`).getTime() : 0;
        await api('/roles', { method: 'POST', body: { userId: Number(el('mod-role-user').value), role: el('mod-role-name').value, expiresAt: expires, reason: el('mod-role-reason').value } });
        toast('Роль выдана');
        el('mod-role-form').reset();
        await load();
      } catch (error) { fail(error.message); }
    };
    await load();
  }

  async function auditTab() {
    el('moderation-title').textContent = 'Аудит';
    el('moderation-content').innerHTML = '<p class="mod-note">Модератор видит свои действия, super admin — все.</p><div id="mod-audit-list"></div>';
    const data = await api('/audit');
    el('mod-audit-list').innerHTML = table(data.audit, ['Время', 'Кто', 'Действие', 'Цель', 'Причина'], (entry) => `
      <td>${fmt(entry.CreatedAt)}</td><td>#${entry.ActorID}</td><td>${esc(entry.Action)}</td><td>${entry.TargetType ? `${esc(entry.TargetType)} #${entry.TargetID}` : '—'}</td><td>${esc(entry.Reason)}</td>`);
  }

  const tabs = { users: usersTab, channels: channelsTab, reports: reportsTab, appeals: appealsTab, approvals: approvalsTab, roles: rolesTab, audit: auditTab };

  async function openTab(tab) {
    state.tab = tab;
    fail('');
    for (const button of document.querySelectorAll('#moderation-nav [data-mod-tab]')) {
      button.classList.toggle('active', button.dataset.modTab === tab);
    }
    try { await tabs[tab](); } catch (error) { fail(error.message); }
  }

  async function openModeration() {
    if (!state.me && !(await refreshModerationAccess())) return;
    el('moderation').classList.remove('hidden');
    await openTab(state.tab);
  }

  function closeModeration() {
    el('moderation').classList.add('hidden');
  }

  async function runAction(action, dataset) {
    const needsReason = ['suspend', 'ban', 'delete-channel', 'reject', 'report-resolve', 'appeal-resolve'].includes(action);
    const reason = needsReason ? await askText('Причина', '', { hint: 'Коротко и по делу' }) : '';
    if (needsReason && !reason) return;
    try {
      if (action === 'suspend') await api(`/users/${dataset.id}/suspend`, { method: 'POST', body: { reason } });
      if (action === 'unsuspend') await api(`/users/${dataset.id}/suspend`, { method: 'DELETE' });
      if (action === 'ban') {
        const result = await api(`/users/${dataset.id}/ban`, { method: 'POST', body: { reason } });
        toast(result.pending ? `Заявка #${result.approvalId}: нужно подтверждение super admin` : 'Пользователь забанен');
      }
      if (action === 'unban') {
        const result = await api(`/users/${dataset.id}/unban`, { method: 'POST' });
        toast(`Аккаунт восстановлен. Временный пароль: ${result.temporaryPassword}`, 12000);
      }
      if (action === 'delete-channel') {
        const result = await api(`/channels/${dataset.kind}/${dataset.id}`, { method: 'DELETE', body: { reason } });
        toast(result.pending ? `Заявка #${result.approvalId} создана` : 'Канал удалён безвозвратно');
      }
      if (action === 'approve') await api(`/approvals/${dataset.id}/approve`, { method: 'POST' });
      if (action === 'reject') await api(`/approvals/${dataset.id}/reject`, { method: 'POST', body: { resolution: reason || 'rejected' } });
      if (action === 'report-resolve') await api(`/reports/${dataset.id}/resolve`, { method: 'POST', body: { status: dataset.status, resolution: reason || '' } });
      if (action === 'appeal-resolve') await api(`/appeals/${dataset.id}/resolve`, { method: 'POST', body: { status: dataset.status, resolution: reason || '' } });
      if (action === 'revoke-role') await api(`/roles/${dataset.id}`, { method: 'DELETE' });
      await openTab(state.tab);
      toast('Готово');
    } catch (error) { fail(error.message); }
  }

  window.refreshModerationAccess = refreshModerationAccess;
  window.openModeration = openModeration;

  document.addEventListener('DOMContentLoaded', () => {
    el('moderation-btn').onclick = openModeration;
    el('moderation-close').onclick = closeModeration;
    document.querySelectorAll('#moderation-nav [data-mod-tab]').forEach((button) => {
      button.addEventListener('click', () => openTab(button.dataset.modTab));
    });
    el('moderation').addEventListener('click', (event) => {
      const button = event.target.closest('[data-mod-action]');
      if (button) runAction(button.dataset.modAction, button.dataset);
    });
    refreshModerationAccess();
    setTimeout(refreshModerationAccess, 1500);
  });
})();
