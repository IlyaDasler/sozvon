// Поле ввода сообщения — общее для чата с другом и комнаты.
// Enter — отправить, Shift+Enter — новая строка (для списков, цитат и кода); поле растёт вместе с текстом.

function autoGrow(area) {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

function setupComposer(form, area) {
  area.addEventListener('input', () => autoGrow(area));
  area.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    form.requestSubmit();
  });
  // После отправки поле очищают — возвращаем ему высоту в одну строку
  form.addEventListener('submit', () => setTimeout(() => autoGrow(area)));
}

setupComposer($('message-form'), $('message-input'));
setupComposer($('room-message-form'), $('room-message-input'));
