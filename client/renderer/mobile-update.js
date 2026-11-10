// OTA-проверка APK в нативной Android-оболочке.
// Кнопка «Проверить обновления» в «О приложении» сравнивает versionCode
// с /downloads/mobile/latest.json и открывает скачивание APK.
(() => {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  const App = cap.Plugins?.App;
  const Browser = cap.Plugins?.Browser;
  const button = document.getElementById('update-check-btn');
  if (!App || !Browser || !button) return;

  const META_URL = 'https://135-106-226-12.sslip.io/downloads/mobile/latest.json';

  const setStatus = (text) => {
    const el = document.getElementById('update-status');
    if (el) el.textContent = text;
  };

  const check = async () => {
    button.disabled = true;
    setStatus('Проверяем обновления…');
    try {
      const [info, metaRes] = await Promise.all([
        App.getInfo(),
        fetch(META_URL, { cache: 'no-store' }),
      ]);
      if (!metaRes.ok) throw new Error('HTTP ' + metaRes.status);
      const meta = await metaRes.json();
      const currentCode = Number(info.build || 0);
      const nextCode = Number(meta.versionCode || 0);
      document.getElementById('app-version').textContent = info.version || '';
      if (nextCode > currentCode) {
        updateStatus = {
          state: 'available',
          current: info.version,
          version: meta.version,
          notes: meta.notes || 'Исправления и улучшения.',
        };
        openUpdateModal('available');
        document.getElementById('update-now').onclick = () => Browser.open({ url: meta.url });
        document.getElementById('update-now').textContent = 'Скачать APK';
        document.getElementById('update-skip').onclick = closeUpdateModal;
        setStatus(`Доступна версия ${meta.version}`);
      } else {
        updateStatus = {
          state: 'latest',
          current: info.version,
          version: info.version,
          notes: meta.notes || '',
        };
        openUpdateModal('latest');
        setStatus('У вас последняя версия');
      }
    } catch (err) {
      updateStatus = { state: 'error', current: '', message: 'Не удалось проверить обновления' };
      openUpdateModal('error');
      setStatus('Не удалось проверить обновления');
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener('click', (event) => {
    event.preventDefault();
    check();
  });
  document.getElementById('update-close').onclick = closeUpdateModal;
  document.getElementById('update-later').onclick = closeUpdateModal;
  setStatus('Проверить обновления');
})();
