// Включение мобильного слоя. По умолчанию выключен: мобильная версия остаётся прежней.
// Включить вручную: localStorage.setItem('sozvon.mobileShell', '1') и перезагрузить.
const FLAG = 'sozvon.mobileShell';

const enabled = () => {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
};

if (enabled() && matchMedia('(max-width: 900px)').matches) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'm/m.css';
  document.head.append(link);
  import('./m.js');
}
