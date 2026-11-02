// План рефакторинга интерфейса 3.0 — единственный источник статуса для панели «План 3.0»
(() => {
  const PLAN = [
    ['Каркас: скругление панелей во всех темах', 'done'],
    ['Жидкое стекло: единый слой glass.css', 'done'],
    ['Контролы: кнопки, поля, свитчеры, радио, вкладки', 'done'],
    ['Узкое окно: одноколоночный режим', 'done'],
    ['Экран входа и тосты под стеклом', 'done'],
    ['Анимации вкладок и свитчеров только в теме стекла', 'done'],
    ['Вкладки: дальний переход без растягивания «колбасой»', 'done'],
    ['Рейл каналов: рамки больше не выходят за аватарки', 'done'],
    ['Переключение каналов с жидкой анимацией (стекло)', 'done'],
    ['Плитки каналов: фото в скруглённом квадрате, без обрезки кругом', 'done'],
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
      li.innerHTML = '<span class="plan-dot"></span><span class="plan-text">' + title + '</span>';
      list.appendChild(li);
      if (status === 'now') now = title;
    }
    if (current) current.textContent = now ? 'Сейчас: ' + now : 'Готово';

    // Плавающий индикатор на экране: этап виден, не открывая настройки
    const done = PLAN.filter(([, s]) => s === 'done').length;
    let chip = document.getElementById('plan-chip');
    if (!chip) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.id = 'plan-chip';
      chip.className = 'plan-chip';
      chip.addEventListener('click', () => {
        if (typeof openSettings === 'function') openSettings('plan');
      });
      document.body.appendChild(chip);
    }
    chip.textContent = '3.0 · этап ' + done + '/' + PLAN.length + (now ? ' · ' + now : '');
    chip.title = now ? 'В работе: ' + now + '. Открыть план' : 'План 3.0';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();