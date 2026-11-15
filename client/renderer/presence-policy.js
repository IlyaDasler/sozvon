(function exposePresencePolicy(root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  if (root) root.SozvonPresence = policy;
})(typeof window === 'undefined' ? globalThis : window, function createPresencePolicy() {
  const USER_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible', 'offline']);
  const SELF_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible']);

  function normalize(status, allowed, fallback) {
    return typeof status === 'string' && allowed.has(status) ? status : fallback;
  }

  return Object.freeze({
    forUser(user) {
      return normalize(user?.status, USER_STATUSES, user?.online ? 'online' : 'offline');
    },
    forSelf(status) {
      return normalize(status, SELF_STATUSES, 'online');
    },
    forAvatar(value) {
      return normalize(typeof value === 'string' ? value : value ? 'online' : 'offline', USER_STATUSES, 'offline');
    },
  });
});
