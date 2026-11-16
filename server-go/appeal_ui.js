(() => {
  'use strict';
  const form = document.getElementById('appeal-form');
  const status = document.getElementById('appeal-status');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = 'Отправляем…';
    try {
      const response = await fetch('/api/appeals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('appeal-username').value.trim(),
          contact: document.getElementById('appeal-contact').value.trim(),
          reason: document.getElementById('appeal-reason').value.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить');
      form.reset();
      status.textContent = `Апелляция отправлена. Номер: ${data.id}. Ответ придёт на указанный контакт.`;
    } catch (error) {
      status.textContent = error.message;
    }
  });
})();
