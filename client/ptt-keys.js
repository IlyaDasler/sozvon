// Рация (push-to-talk): привязка — клавиша или боковая кнопка мыши, которую держат, пока говорят.
// Событие от глобального перехватчика: { kind: 'key', keycode } или { kind: 'mouse', button }.
// Левую и правую кнопку мыши не назначаем — иначе ими нельзя было бы ничего нажать.

const MOUSE_FORBIDDEN = new Set([1, 2]);

// Понятные названия для частых клавиш; остальные — как их называет перехватчик
const KEY_LABELS = { Space: 'Пробел', Backquote: '`', Ctrl: 'Ctrl', CtrlRight: 'Правый Ctrl', Alt: 'Alt', AltRight: 'Правый Alt', Shift: 'Shift', ShiftRight: 'Правый Shift', CapsLock: 'Caps Lock', Tab: 'Tab' };

const validCode = (code) => Number.isInteger(code) && code > 0 && code < 0x10000;

/** Привязка по нажатию, которое человек сделал при назначении; null — так назначить нельзя */
function bindingFrom(event) {
  if (event?.kind === 'key' && validCode(event.keycode)) return { type: 'key', code: event.keycode };
  if (event?.kind === 'mouse' && validCode(event.button) && !MOUSE_FORBIDDEN.has(event.button)) return { type: 'mouse', code: event.button };
  return null;
}

/** Это нажатие (или отпускание) — назначенной клавиши или кнопки? */
function matches(binding, event) {
  if (!binding || !event) return false;
  return binding.type === 'key' ? event.kind === 'key' && event.keycode === binding.code : event.kind === 'mouse' && event.button === binding.code;
}

/** Название для настроек. names — коды клавиш перехватчика → их имена */
function bindingLabel(binding, names = {}) {
  if (!binding) return 'не назначена';
  if (binding.type === 'mouse') return `Кнопка мыши ${binding.code}`;
  const name = names[binding.code];
  return name ? KEY_LABELS[name] || name : `Клавиша ${binding.code}`;
}

/** Сохранённая привязка из настроек: проверяем и возвращаем её или null */
const parseBinding = (value) => (value && typeof value === 'object' ? bindingFrom(value.type === 'key' ? { kind: 'key', keycode: value.code } : { kind: value.type, button: value.code }) : null);

module.exports = { bindingFrom, matches, bindingLabel, parseBinding };
