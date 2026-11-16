/* Validate server-provided Telegram bot links before they reach native or
   external browser launchers. */
(function installTelegramLinkPolicy(root) {
  'use strict';

  function validateTelegramBotLink(raw, expectedUsername) {
    if (typeof raw !== 'string' || raw.length > 256 || raw.trim() !== raw || /[\u0000-\u0020\u007f]/.test(raw)) return '';
    if (typeof expectedUsername !== 'string' || !/^[A-Za-z0-9_]{5,32}$/.test(expectedUsername)) return '';

    let url;
    try { url = new URL(raw); } catch { return ''; }
    const username = url.pathname.startsWith('/') ? url.pathname.slice(1) : '';
    if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.port || url.username || url.password ||
        url.hash || !/^[A-Za-z0-9_]{5,32}$/.test(username) || !username.toLowerCase().endsWith('bot') ||
        username.toLowerCase() !== expectedUsername.toLowerCase()) return '';

    const entries = [...url.searchParams.entries()];
    if (entries.length !== 1 || entries[0][0] !== 'start' || !/^[A-Za-z0-9_-]{16,64}$/.test(entries[0][1])) return '';
    return url.href;
  }

  const api = Object.freeze({ validateTelegramBotLink });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SozvonTelegramLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
