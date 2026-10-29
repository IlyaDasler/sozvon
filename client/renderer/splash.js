// Окошко загрузки: main.js присылает, что происходит, — showStatus({ state, version, percent })
const TEXT = {
  checking: () => 'Проверяем обновления…',
  downloading: (s) => `Скачиваем обновление ${s.version} — ${s.percent}%`,
  installing: (s) => `Устанавливаем ${s.version}…`,
  starting: () => 'Запускаем…',
};

function showStatus(s) {
  document.getElementById('status').textContent = (TEXT[s.state] || TEXT.starting)(s);
  const bar = document.getElementById('bar');
  const known = s.state === 'downloading';
  bar.classList.toggle('known', known);
  bar.firstElementChild.style.width = known ? `${Math.max(4, s.percent)}%` : '';
}

document.getElementById('version').textContent = `версия ${new URLSearchParams(location.search).get('v') || ''}`;
