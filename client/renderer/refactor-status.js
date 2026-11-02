// План рефакторинга интерфейса 3.0 — единственный источник статуса для панели «План 3.0»
(() => {
  const PLAN = [
    ['Каркас: скругление панелей во всех темах', 'done'],
    ['Жидкое стекло: единый слой glass.css', 'done'],
    ['Контролы: кнопки, поля, свитчеры, радио, вкладки', 'done'],
    ['Узкое окно: одноколоночный режим', 'done'],
    ['Экран входа и тосты под стеклом', 'done'],
    ['Единые отступы и высоты шапок', 'now'],
    ['Типографика и плотность (заголовки, компактный режим)', 'todo'],
    ['Экран звонка: плитки, панель, плавающие контролы', 'todo'],
    ['Чат: группировка сообщений, даты, ширина колонки', 'todo'],
    ['Каналы: список, группы, роли, профиль участника', 'todo'],
    ['Иконки: единая толщина штриха', 'todo'],
    ['Переходы экранов и меню: плавность', 'todo'],
    ['UI-кит: полная витрина всех экранов', 'todo'],
    ['e2e-layout на ширинах 480/760/1280', 'todo'],
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
      li.innerHTML = `<span class="plan-dot"></span><span class="plan-text">${title}</span>`;
      list.appendChild(li);
      if (status === 'now') now = title;
    }
    if (current) current.textContent = now ? 'Сейчас: ' + now : 'Готово';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();