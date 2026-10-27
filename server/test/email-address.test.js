// Адрес почты приводится к одному виду: у Яндекса один ящик живёт под многими адресами
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEmail } from '../src/email-address.js';

test('почта Яндекса: все домены и точка/дефис в логине — один ящик', () => {
  for (const address of [
    'Ivan.Petrov@ya.ru',
    'ivan-petrov@yandex.ru',
    'IVAN.PETROV@yandex.com',
    'ivan.petrov@yandex.by',
    'ivan-petrov@yandex.kz',
    'ivan.petrov@yandex.ua',
    'ivan.petrov@narod.ru',
    '  ivan.petrov@Yandex.Ru  ',
  ])
    assert.equal(canonicalEmail(address), 'ivan-petrov@yandex.ru', address);
});

test('другие почтовые сервисы: только регистр и пробелы', () => {
  assert.equal(canonicalEmail(' Anna.Ivanova@Mail.ru '), 'anna.ivanova@mail.ru');
  assert.equal(canonicalEmail('anna.ivanova@gmail.com'), 'anna.ivanova@gmail.com');
  assert.equal(canonicalEmail('a.b@bk.ru'), 'a.b@bk.ru');
});

test('не почта остаётся как есть, чтобы её отклонила проверка формата', () => {
  assert.equal(canonicalEmail('не почта'), 'не почта');
  assert.equal(canonicalEmail(''), '');
  assert.equal(canonicalEmail(undefined), '');
});
