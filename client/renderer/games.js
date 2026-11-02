// Запущенные игры: приложение смотрит процессы Windows (main.js), а здесь раз в 45 секунд
// сверяет и отправляет на сервер только изменения — профиль показывает «Играет: …»
(() => {
  if (!window.desktop?.games) return;

  let last;

  async function sync() {
    try {
      const list = await window.desktop.games.running();
      const game = Array.isArray(list) && list.length ? list[0] : null;
      if (game === last) return;
      last = game;
      await Api.put('/me/game', { game });
    } catch {
      // Тихо: детект игр не должен мешать работе приложения
    }
  }

  sync();
  setInterval(sync, 45_000);
  // Вернулись к компьютеру — проверяем сразу, не ждём таймер
  window.addEventListener('focus', () => sync());
})();
