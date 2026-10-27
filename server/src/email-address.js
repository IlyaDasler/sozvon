// Один вид для адреса почты, чтобы один ящик не стал двумя профилями.
// У Яндекса один ящик доступен на всех его доменах, а точка и дефис в логине — одно и то же:
// Ivan.Petrov@ya.ru, ivan-petrov@yandex.com и ivan.petrov@narod.ru — это ivan-petrov@yandex.ru.

const YANDEX_DOMAINS = new Set(['yandex.ru', 'ya.ru', 'yandex.com', 'yandex.by', 'yandex.kz', 'yandex.ua', 'narod.ru']);

export function canonicalEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  const login = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!YANDEX_DOMAINS.has(domain)) return email;
  return `${login.replace(/\./g, '-')}@yandex.ru`;
}
