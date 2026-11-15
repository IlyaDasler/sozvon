// Что странице приложения можно спрашивать у системы: микрофон и камера, уведомления, выбор динамика,
// демонстрация экрана, трансляция во весь монитор (без fullscreen она раскрывается только внутри окна).
// Остальное отклоняем. Тот же список берут e2e-проверки — чтобы они видели то же, что человек.

const ALLOWED_PERMISSIONS = ['media', 'notifications', 'speaker-selection', 'display-capture', 'fullscreen'];

function isTrustedAppUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'file:') return false;
    const pathname = decodeURIComponent(url.pathname).replace(/\\/g, '/');
    return /\/renderer\/(?:index|pip)\.html$/i.test(pathname);
  } catch {
    return false;
  }
}

function isTrustedRequester(value) {
  if (!value) return false;
  if (isTrustedAppUrl(value)) return true;
  // setPermissionCheckHandler supplies an origin rather than a document URL.
  // Electron represents the packaged app's origin as `file://` (no path).
  try {
    const url = new URL(String(value));
    return url.protocol === 'file:' && (url.pathname === '' || url.pathname === '/') && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isTrustedRequest(webContents, requestingUrl, isMainFrame) {
  if (isMainFrame !== true) return false;
  if (!isTrustedAppUrl(webContents?.getURL?.())) return false;
  // Permission checks may expose only the origin. The owning top-level
  // document must still be one of our packaged renderer pages.
  return isTrustedRequester(requestingUrl);
}

function applyPermissions(ses) {
  ses.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    callback(ALLOWED_PERMISSIONS.includes(permission) &&
      isTrustedRequest(webContents, details.requestingUrl, details.isMainFrame));
  });
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details = {}) =>
    ALLOWED_PERMISSIONS.includes(permission) &&
    isTrustedRequest(webContents, details.requestingUrl || requestingOrigin, details.isMainFrame));
}

module.exports = { applyPermissions, isTrustedAppUrl, isTrustedRequester, isTrustedRequest };
