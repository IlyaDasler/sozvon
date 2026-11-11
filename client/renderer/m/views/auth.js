// Экран входа мобильного слоя. Возвращает профиль после успешного входа.
import { auth } from '../../core/auth.js';

const field = (label, input) => {
  const wrap = document.createElement('label');
  wrap.className = 'm-field';
  const span = document.createElement('span');
  span.className = 'm-field__label';
  span.textContent = label;
  wrap.append(span, input);
  return wrap;
};

const input = (attrs) => {
  const el = document.createElement('input');
  el.className = 'm-field__input';
  Object.assign(el, attrs);
  return el;
};

export function mountAuth(container, { onSuccess }) {
  container.replaceChildren();

  const form = document.createElement('form');
  form.className = 'm-auth';
  form.noValidate = true;

  const title = document.createElement('h2');
  title.className = 'm-auth__title';
  title.textContent = 'Вход в Созвон';

  const login = input({ type: 'text', name: 'username', autocomplete: 'username', required: true });
  login.inputMode = 'email';
  login.enterKeyHint = 'next';

  const password = input({ type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  password.enterKeyHint = 'go';

  const totp = input({ type: 'text', name: 'totp', autocomplete: 'one-time-code', inputMode: 'numeric' });
  totp.hidden = true;

  const rememberRow = document.createElement('label');
  rememberRow.className = 'm-check';
  const remember = document.createElement('input');
  remember.type = 'checkbox';
  remember.checked = true;
  const rememberText = document.createElement('span');
  rememberText.textContent = 'Запомнить меня';
  rememberRow.append(remember, rememberText);

  const error = document.createElement('p');
  error.className = 'm-auth__error';
  error.setAttribute('role', 'alert');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'm-btn m-btn--primary';
  submit.textContent = 'Войти';

  const totpWrap = field('Код из приложения', totp);
  totpWrap.hidden = true;

  form.append(
    title,
    field('Почта или логин', login),
    field('Пароль', password),
    totpWrap,
    rememberRow,
    error,
    submit
  );
  container.append(form);
  login.focus();

  let busy = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;

    const username = login.value.trim();
    const pass = password.value;
    // Пустые поля не отправляем: сервер ответит тем же, но лишний запрос ни к чему.
    if (!username || !pass) {
      error.textContent = 'Введите почту (или логин) и пароль';
      (username ? password : login).focus();
      return;
    }

    busy = true;
    submit.disabled = true;
    error.textContent = '';
    try {
      const user = await auth.login({
        username,
        password: pass,
        totp: totp.value.trim(),
        remember: remember.checked,
      });
      onSuccess(user);
    } catch (err) {
      error.textContent = err.message || 'Не удалось войти';
      // Сервер просит второй фактор — показываем поле и ведём в него.
      if (err.data?.needTotp) {
        totpWrap.hidden = false;
        totp.focus();
      } else {
        password.select();
      }
    } finally {
      busy = false;
      submit.disabled = false;
    }
  };
}
