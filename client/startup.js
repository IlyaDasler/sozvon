// Запуск как у Discord: окошко загрузки сначала проверяет обновления. Есть новая версия — качаем её
// и ставим (приложение перезапустится уже новым); нет её, нет сети или проверка затянулась — открываем приложение.
// updater — autoUpdater из electron-updater (события и checkForUpdates/downloadUpdate), onStatus — что показать в окошке:
// { state: 'checking' | 'downloading' | 'installing' | 'starting', version?, percent? }

const CHECK_TIMEOUT_MS = 8000;

/** Чем кончился запуск: 'install' — обновление скачано, ставим; 'start' — открываем приложение */
function runStartup(updater, { onStatus, timeoutMs = CHECK_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let version = null;
    let timer = null;
    const handlers = {
      'update-available': (info) => {
        clearTimeout(timer);
        version = info.version;
        onStatus({ state: 'downloading', version, percent: 0 });
        updater.downloadUpdate().catch(() => {}); // ошибка придёт событием 'error'
      },
      'download-progress': (p) => onStatus({ state: 'downloading', version, percent: Math.round(p.percent) }),
      'update-downloaded': () => finish('install'),
      'update-not-available': () => finish('start'),
      error: () => finish('start'),
    };
    function finish(result) {
      clearTimeout(timer);
      for (const [event, fn] of Object.entries(handlers)) updater.removeListener(event, fn);
      onStatus(result === 'install' ? { state: 'installing', version } : { state: 'starting' });
      resolve(result);
    }
    for (const [event, fn] of Object.entries(handlers)) updater.on(event, fn);
    onStatus({ state: 'checking' });
    timer = setTimeout(() => finish('start'), timeoutMs);
    updater.checkForUpdates().catch(() => {});
  });
}

module.exports = { runStartup, CHECK_TIMEOUT_MS };
