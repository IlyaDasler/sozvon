// Веб-версия: после релиза не ждём, пока человек сам почистит кэш.
// Сервер кладёт текущий тег в /.release; открытая вкладка замечает смену
// и перезагружается без ручных действий. В Electron этот код не работает.
(() => {
  if (window.desktop) return;
  const KEY = 'sozvonWebRelease';
  let checking = false;

  async function check() {
    if (checking) return;
    checking = true;
    try {
      const res = await fetch(`/.release?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const release = (await res.text()).trim();
      if (!release) return;
      const seen = sessionStorage.getItem(KEY);
      if (!seen) {
        sessionStorage.setItem(KEY, release);
        return;
      }
      if (seen !== release) {
        sessionStorage.setItem(KEY, release);
        location.reload();
      }
    } catch {
      // нет сети — просто попробуем в следующий раз
    } finally {
      checking = false;
    }
  }

  check();
  setInterval(check, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check();
  });
  window.addEventListener('focus', check);
})();
