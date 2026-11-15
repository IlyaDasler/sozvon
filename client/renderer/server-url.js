(function exposeServerUrlPolicy(root) {
  'use strict';
  function isLoopback(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
  }
  function normalizeServerUrl(value, options = {}) {
    let input = String(value || '').trim();
    if (!input) return '';
    if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
    let parsed;
    try { parsed = new URL(input); } catch { throw new Error('Проверьте адрес сервера'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password ||
      (parsed.pathname !== '' && parsed.pathname !== '/') || parsed.search || parsed.hash) {
      throw new Error('Укажите корректный адрес сервера');
    }
    if (parsed.protocol === 'http:' && (options.allowLoopbackHttp === false || !isLoopback(parsed.hostname))) {
      throw new Error('Удалённые серверы должны использовать HTTPS. HTTP разрешён только для localhost в режиме разработки.');
    }
    return parsed.origin;
  }
  const policy = Object.freeze({ isLoopback, normalizeServerUrl });
  if (root) root.SozvonServerUrl = policy;
  if (typeof module !== 'undefined' && module.exports) module.exports = policy;
})(typeof window !== 'undefined' ? window : null);
