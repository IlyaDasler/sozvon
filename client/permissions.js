// Что странице приложения можно спрашивать у системы: микрофон и камера, уведомления, выбор динамика,
// демонстрация экрана, трансляция во весь монитор (без fullscreen она раскрывается только внутри окна).
// Остальное отклоняем. Тот же список берут e2e-проверки — чтобы они видели то же, что человек.

const ALLOWED_PERMISSIONS = ['media', 'notifications', 'speaker-selection', 'display-capture', 'fullscreen'];

function applyPermissions(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.includes(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.includes(permission));
}

module.exports = { applyPermissions };
