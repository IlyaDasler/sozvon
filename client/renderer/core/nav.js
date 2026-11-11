// Стек экранов. Без DOM: только порядок, чтобы back можно было проверить тестом.
export function createNav(initial) {
  const stack = [initial];
  return {
    get current() {
      return stack.at(-1);
    },
    get depth() {
      return stack.length;
    },
    // Открыть экран. Повтор того же экрана не плодит шагов.
    push(route) {
      if (stack.at(-1).name === route.name && route.name !== 'chat') return route;
      stack.push(route);
      return route;
    },
    // Шаг назад. null — уже на корне, отдаём событие системе.
    back() {
      if (stack.length < 2) return null;
      stack.pop();
      return stack.at(-1);
    },
    // Сброс к одному экрану (после выхода из аккаунта).
    reset(route) {
      stack.length = 0;
      stack.push(route);
      return route;
    },
  };
}
