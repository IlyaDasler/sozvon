// План рефакторинга интерфейса 3.0 — единственный источник статуса для панели «План 3.0»
(() => {
  const PLAN = [
    ['Каркас: скругление панелей во всех темах', 'done'],
    ['Жидкое стекло: единый слой glass.css', 'done'],
    ['Контролы: кнопки, поля, свитчеры, радио, вкладки', 'done'],
    ['Узкое окно: одноколоночный режим', 'done'],
    ['Экран входа и тосты под стеклом', 'done'],
    ['Анимации только в теме стекла', 'done'],
    ['Вкладки: дальний переход без растягивания', 'done'],
    ['Рейл каналов: рамки не выходят за аватарки', 'done'],
    ['Переключение каналов с жидкой анимацией', 'done'],
    ['Плитки каналов: фото в скруглённом квадрате', 'done'],
    ['Единые отступы и высоты шапок', 'done'],
    ['Типографика и плотность', 'done'],
    ['Звонок: плитки и контролы', 'done'],
    ['Система стекла по liqui.design', 'done'],
    ['Меню, прогресс, чипы, разделители, аватар, бейдж', 'done'],
    ['Тултипы в материале темы', 'done'],
    ['Чат: группировка сообщений', 'done'],
    ['Чат: разделитель дат', 'done'],
    ['Чат: ширина колонки чтения', 'done'],
    ['Каналы: список, группы, роли, профиль', 'now'],
    ['Иконки: единая толщина штриха', 'todo'],
    ['Переходы экранов и меню', 'todo'],
    ['UI-кит: полная витрина всех экранов', 'todo'],
    ['e2e-layout на ширинах 480/760/1280', 'todo'],
    ['Новый образ приложения по референсам Calab и Fluxer', 'todo'],
  ];
  function render() {
    const list = document.getElementById('plan-list');
    const current = document.getElementById('plan-current');
    if (!list) return;
    list.innerHTML = '';
    let now = null;
    for (const [title, status] of PLAN) {
      const li = document.createElement('li');
      li.className = 'plan-item ' + status;
      li.innerHTML = '<span class="plan-dot"></span><span class="plan-text">' + title + '</span>';
      list.appendChild(li);
      if (status === 'now') now = title;
    }
    if (current) current.textContent = now ? 'Сейчас: ' + now : 'Готово';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();