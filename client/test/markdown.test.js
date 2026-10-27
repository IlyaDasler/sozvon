// Разбор разметки сообщений: что видит человек — жирный, ссылки, код, цитаты, списки — и что ссылки только безопасные
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMarkdown, findLinks } = require('../renderer/markdown');

const text = (t) => ({ type: 'text', text: t });
const para = (...inlines) => ({ type: 'paragraph', inlines });

test('обычный текст — один абзац, перенос строки сохраняется', () => {
  assert.deepEqual(parseMarkdown('Привет'), [para(text('Привет'))]);
  assert.deepEqual(parseMarkdown('раз\nдва'), [para(text('раз'), { type: 'br' }, text('два'))]);
  assert.deepEqual(parseMarkdown('раз\n\nдва'), [para(text('раз')), para(text('два'))]);
});

test('жирный, курсив, зачёркнутый, код, спойлер и вложенность', () => {
  assert.deepEqual(parseMarkdown('**жир** и *курсив* и ~~нет~~'), [
    para({ type: 'bold', children: [text('жир')] }, text(' и '), { type: 'italic', children: [text('курсив')] }, text(' и '), {
      type: 'strike',
      children: [text('нет')],
    }),
  ]);
  assert.deepEqual(parseMarkdown('`**не жир**`'), [para({ type: 'code', text: '**не жир**' })]);
  assert.deepEqual(parseMarkdown('||сюрприз||'), [para({ type: 'spoiler', children: [text('сюрприз')] })]);
  assert.deepEqual(parseMarkdown('**жир *и курсив***'), [
    para({ type: 'bold', children: [text('жир '), { type: 'italic', children: [text('и курсив')] }] }),
  ]);
  assert.deepEqual(parseMarkdown('__подчёркнуто__'), [para({ type: 'underline', children: [text('подчёркнуто')] })]);
});

test('одиночные звёздочки и подчёркивания в словах — просто текст', () => {
  assert.deepEqual(parseMarkdown('2 * 3 = 6'), [para(text('2 * 3 = 6'))]);
  assert.deepEqual(parseMarkdown('snake_case_name'), [para(text('snake_case_name'))]);
  assert.deepEqual(parseMarkdown('**не закрыто'), [para(text('**не закрыто'))]);
});

test('ссылки: адреса в тексте, [текст](адрес), www', () => {
  assert.deepEqual(parseMarkdown('смотри https://ya.ru/search?q=1.'), [
    para(text('смотри '), { type: 'link', href: 'https://ya.ru/search?q=1', children: [text('https://ya.ru/search?q=1')] }, text('.')),
  ]);
  assert.deepEqual(parseMarkdown('[Яндекс](https://ya.ru)'), [para({ type: 'link', href: 'https://ya.ru', children: [text('Яндекс')] })]);
  assert.deepEqual(parseMarkdown('www.example.com'), [
    para({ type: 'link', href: 'https://www.example.com', children: [text('www.example.com')] }),
  ]);
  assert.deepEqual(parseMarkdown('(см. https://a.ru/x)'), [
    para(text('(см. '), { type: 'link', href: 'https://a.ru/x', children: [text('https://a.ru/x')] }, text(')')),
  ]);
});

test('опасные адреса ссылкой не становятся', () => {
  assert.deepEqual(parseMarkdown('[клик](javascript:alert(1))'), [para(text('[клик](javascript:alert(1))'))]);
  assert.deepEqual(parseMarkdown('[файл](file:///C:/Windows)'), [para(text('[файл](file:///C:/Windows)'))]);
});

test('блоки: код, цитата, списки, заголовки', () => {
  assert.deepEqual(parseMarkdown('```js\nconst a = 1;\n**x**\n```'), [{ type: 'codeblock', lang: 'js', text: 'const a = 1;\n**x**' }]);
  assert.deepEqual(parseMarkdown('> цитата\n> вторая'), [{ type: 'quote', blocks: [para(text('цитата'), { type: 'br' }, text('вторая'))] }]);
  assert.deepEqual(parseMarkdown('- раз\n- **два**'), [
    { type: 'list', ordered: false, start: 1, items: [[text('раз')], [{ type: 'bold', children: [text('два')] }]] },
  ]);
  assert.deepEqual(parseMarkdown('3. три\n4. четыре'), [{ type: 'list', ordered: true, start: 3, items: [[text('три')], [text('четыре')]] }]);
  assert.deepEqual(parseMarkdown('# Заголовок\nтекст'), [{ type: 'heading', level: 1, inlines: [text('Заголовок')] }, para(text('текст'))]);
});

test('findLinks находит адреса для предпросмотра, без повторов', () => {
  assert.deepEqual(findLinks('глянь https://ya.ru и www.mail.ru, и снова https://ya.ru'), ['https://ya.ru', 'https://www.mail.ru']);
  assert.deepEqual(findLinks('`https://в-коде.ru` не считается'), []);
  assert.deepEqual(findLinks('ничего'), []);
});
