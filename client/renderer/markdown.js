// Разметка сообщений: **жирный**, *курсив*, __подчёркнутый__, ~~зачёркнутый~~, `код`, ||спойлер||,
// [текст](ссылка), адреса и www.… — ссылками, ```блок кода```, > цитата, списки и # заголовки.
// parseMarkdown — чистая функция: текст -> дерево. renderMarkdown строит из дерева элементы страницы
// через createElement, без innerHTML, поэтому из сообщения нельзя вставить ни скрипт, ни чужую разметку.

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const URL_START = /^(?:https?:\/\/|www\.)[^\s<>]+/i;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

// Точку, запятую и непарную скобку в конце адреса считаем знаками препинания предложения
function trimUrl(url) {
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (/[.,;:!?'"»…]/.test(last)) end--;
    else if (last === ')' && (url.slice(0, end).match(/\(/g) || []).length < (url.slice(0, end).match(/\)/g) || []).length) end--;
    else break;
  }
  return url.slice(0, end);
}

const hrefOf = (url) => (/^www\./i.test(url) ? `https://${url}` : url);

// Парные знаки: открывающий, закрывающий — и во что превращаются
const SPANS = [
  ['**', 'bold'],
  ['__', 'underline'],
  ['~~', 'strike'],
  ['||', 'spoiler'],
];

function findClosing(s, from, mark) {
  // Закрывающий знак — после непробельного символа и не начало более длинной серии (*** закрывает **, а не *)
  for (let j = s.indexOf(mark, from); j !== -1; j = s.indexOf(mark, j + 1)) {
    if (j > from && !/\s/.test(s[j - 1]) && s[j + mark.length] !== mark[0]) return j;
  }
  return -1;
}

function parseInline(s) {
  const out = [];
  let buf = '';
  const push = (node) => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
    out.push(node);
  };

  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const prev = i > 0 ? s[i - 1] : '';
    let m;

    if ((m = /^`([^`\n]+)`/.exec(rest))) {
      push({ type: 'code', text: m[1] });
      i += m[0].length;
      continue;
    }
    if ((m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest)) && SAFE_HREF.test(m[2])) {
      push({ type: 'link', href: m[2], children: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    if (!WORD_CHAR.test(prev) && prev !== '/' && (m = URL_START.exec(rest))) {
      const url = trimUrl(m[0]);
      if (url.length > 4) {
        push({ type: 'link', href: hrefOf(url), children: [{ type: 'text', text: url }] });
        i += url.length;
        continue;
      }
    }
    const span = SPANS.find(([mark]) => rest.startsWith(mark));
    if (span && rest.length > 2 && !/\s/.test(rest[2])) {
      const [mark, type] = span;
      const close = findClosing(s, i + 2, mark);
      if (close !== -1) {
        push({ type, children: parseInline(s.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }
    // Курсив: *текст* или _текст_ (подчёркивание — только не внутри слова, чтобы snake_case остался текстом)
    if ((rest[0] === '*' || (rest[0] === '_' && !WORD_CHAR.test(prev))) && (m = new RegExp(`^\\${rest[0]}(?=\\S)([^${rest[0]}\\n]*?\\S)\\${rest[0]}`).exec(rest))) {
      const after = s[i + m[0].length] || '';
      if (rest[0] === '*' || !WORD_CHAR.test(after)) {
        push({ type: 'italic', children: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    buf += s[i++];
  }
  if (buf) out.push({ type: 'text', text: buf });
  return out;
}

// Строки абзаца соединяются переносом строки
function paragraphInlines(lines) {
  const inlines = [];
  lines.forEach((line, n) => {
    if (n) inlines.push({ type: 'br' });
    inlines.push(...parseInline(line));
  });
  return inlines;
}

const FENCE = /^```\s*([\w+-]*)\s*$/;
const QUOTE = /^>\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.+)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
const isSpecial = (line) =>
  FENCE.test(line) || QUOTE.test(line) || BULLET.test(line) || NUMBERED.test(line) || HEADING.test(line) || TABLE_ROW.test(line);

function parseMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) {
      i++;
    } else if ((m = FENCE.exec(line))) {
      const body = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      i++; // закрывающие ```
      blocks.push({ type: 'codeblock', lang: m[1], text: body.join('\n') });
    } else if (QUOTE.test(line)) {
      const inner = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) inner.push(QUOTE.exec(lines[i])[1]);
      blocks.push({ type: 'quote', blocks: parseMarkdown(inner.join('\n')) });
    } else if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line);
      const pattern = ordered ? NUMBERED : BULLET;
      const start = ordered ? Number(NUMBERED.exec(line)[1]) : 1;
      const items = [];
      for (; i < lines.length && pattern.test(lines[i]); i++) {
        const item = pattern.exec(lines[i]);
        items.push(parseInline(ordered ? item[2] : item[1]));
      }
      blocks.push({ type: 'list', ordered, start, items });
    } else if (HEADING.test(line)) {
      const heading = HEADING.exec(line);
      blocks.push({ type: 'heading', level: heading[1].length, inlines: parseInline(heading[2]) });
      i++;
    } else if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      // Таблица: строка заголовков, линия-разделитель, затем строки
      const head = cellsOf(line);
      const rows = [];
      for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++) rows.push(cellsOf(lines[i]));
      blocks.push({ type: 'table', head, rows });
    } else {
      // Первую строку берём всегда: иначе строка «|», не ставшая таблицей, зациклила бы разбор
      const para = [lines[i]];
      for (i++; i < lines.length && lines[i].trim() && !isSpecial(lines[i]); i++) para.push(lines[i]);
      blocks.push({ type: 'paragraph', inlines: paragraphInlines(para) });
    }
  }
  return blocks;
}

/** Адреса ссылок из сообщения по порядку, без повторов (для предпросмотра) */
function findLinks(text) {
  const found = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'link' && /^https?:/i.test(n.href) && !found.includes(n.href)) found.push(n.href);
      for (const key of ['children', 'inlines', 'blocks']) if (n[key]) walk(n[key]);
      if (n.items) n.items.forEach(walk);
    }
  };
  walk(parseMarkdown(text));
  return found;
}

// ---------- Построение элементов страницы ----------

const INLINE_TAGS = { bold: 'strong', italic: 'em', underline: 'u', strike: 's' };

function renderInlines(doc, nodes, parent) {
  for (const n of nodes) {
    if (n.type === 'text') parent.append(doc.createTextNode(n.text));
    else if (n.type === 'br') parent.append(doc.createElement('br'));
    else if (n.type === 'code') {
      const el = doc.createElement('code');
      el.textContent = n.text;
      parent.append(el);
    } else if (n.type === 'link') {
      const a = doc.createElement('a');
      a.href = n.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = n.href;
      renderInlines(doc, n.children, a);
      parent.append(a);
    } else if (n.type === 'spoiler') {
      const el = doc.createElement('span');
      el.className = 'spoiler';
      el.title = 'Спойлер — нажмите, чтобы показать';
      el.onclick = () => el.classList.add('open');
      renderInlines(doc, n.children, el);
      parent.append(el);
    } else {
      const el = doc.createElement(INLINE_TAGS[n.type]);
      renderInlines(doc, n.children, el);
      parent.append(el);
    }
  }
}

const KEYWORDS =
  /^(?:abstract|and|as|assert|async|await|base|bool|break|byte|case|catch|char|class|const|continue|def|default|delegate|delete|do|double|echo|elif|else|enum|esac|event|except|explicit|export|extends|extern|false|fi|final|finally|float|for|foreach|from|func|function|get|global|go|if|implements|implicit|import|in|init|instanceof|int|interface|internal|is|lambda|let|local|lock|long|namespace|new|nil|None|nonlocal|not|null|object|operator|or|out|override|package|params|pass|private|protected|public|raise|readonly|ref|return|sealed|select|set|short|sizeof|static|string|struct|super|switch|then|this|throw|true|True|False|try|type|typeof|uint|ulong|using|var|virtual|void|volatile|when|where|while|with|yield|done)$/;

/** Подсветка кода в духе VS Code: ключевые слова, функции, свойства, строки, числа, классы и теги */
function highlightInto(doc, target, text, lang) {
  const l = String(lang || '').toLowerCase();
  const hashComments = /^(?:bash|sh|shell|zsh|yaml|yml|python|py|ruby|rb|perl|toml|ini|conf)$/.test(l);
  const sqlComments = l === 'sql';
  const css = /^(?:css|scss|less)$/.test(l);
  const json = l === 'json';

  const strings = '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|@"(?:""|[^"])*"|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`';
  const comments = ['//[^\\n]*', '/\\*[\\s\\S]*?\\*/'];
  if (hashComments) comments.push('#[^\\n]*');
  if (sqlComments) comments.push('--[^\\n]*');
  const token = new RegExp(
    `(${strings})|(${comments.join('|')})|(\\b\\d+(?:\\.\\d+)?\\b)|(\\$\\{?[A-Za-z_]\\w*\\}?)|([A-Za-z_$][\\w$]*)`,
    'g'
  );
  const push = (value, cls) => {
    if (!value) return;
    if (!cls) {
      target.append(doc.createTextNode(value));
      return;
    }
    const span = doc.createElement('span');
    span.className = cls;
    span.textContent = value;
    target.append(span);
  };

  let last = 0;
  let prevWord = '';
  let m;
  while ((m = token.exec(text))) {
    push(text.slice(last, m.index));
    if (m[1]) {
      // Строка-ключ в JSON или перед двоеточием — как свойство
      const after = text.slice(token.lastIndex);
      push(m[1], json || /^\s*:/.test(after) ? 'tok-prop' : 'tok-string');
      prevWord = '';
    } else if (m[2]) {
      push(m[2], 'tok-comment');
      prevWord = '';
    } else if (m[3]) {
      push(m[3], 'tok-number');
      prevWord = '';
    } else if (m[4]) {
      push(m[4], 'tok-prop');
      prevWord = '';
    } else {
      const id = m[5];
      const before = text[m.index - 1] || '';
      const after = text.slice(token.lastIndex);
      let cls = '';
      if (KEYWORDS.test(id)) cls = 'tok-keyword';
      else if (prevWord === 'function' || prevWord === 'def' || prevWord === 'func' || /^\s*\(/.test(after)) cls = 'tok-func';
      else if (before === '.') cls = 'tok-prop';
      else if (css && /^\s*:/.test(after)) cls = 'tok-prop';
      else if (before === '<' || /<\/$/.test(text.slice(0, m.index))) cls = 'tok-keyword';
      else if (/^[A-Z]/.test(id)) cls = 'tok-type';
      push(id, cls);
      prevWord = id;
    }
    last = token.lastIndex;
  }
  push(text.slice(last));
}

function renderBlocks(doc, blocks, parent) {
  for (const b of blocks) {
    let el;
    if (b.type === 'paragraph') {
      el = doc.createElement('p');
      renderInlines(doc, b.inlines, el);
    } else if (b.type === 'codeblock') {
      el = doc.createElement('div');
      el.className = 'code-block';
      if (b.lang) {
        const cap = doc.createElement('span');
        cap.className = 'code-lang';
        cap.textContent = b.lang;
        el.append(cap);
      }
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      highlightInto(doc, code, b.text, b.lang);
      pre.append(code);
      el.append(pre);
    } else if (b.type === 'quote') {
      el = doc.createElement('blockquote');
      renderBlocks(doc, b.blocks, el);
    } else if (b.type === 'list') {
      el = doc.createElement(b.ordered ? 'ol' : 'ul');
      if (b.ordered && b.start !== 1) el.start = b.start;
      for (const item of b.items) {
        const li = doc.createElement('li');
        renderInlines(doc, item, li);
        el.append(li);
      }
    } else if (b.type === 'heading') {
      el = doc.createElement(`h${b.level + 3}`);
      renderInlines(doc, b.inlines, el);
    } else if (b.type === 'table') {
      el = doc.createElement('table');
      const thead = doc.createElement('thead');
      const headRow = doc.createElement('tr');
      for (const cell of b.head) {
        const th = doc.createElement('th');
        renderInlines(doc, parseInline(cell), th);
        headRow.append(th);
      }
      thead.append(headRow);
      el.append(thead);
      const tbody = doc.createElement('tbody');
      for (const row of b.rows) {
        const tr = doc.createElement('tr');
        for (const cell of row) {
          const td = doc.createElement('td');
          renderInlines(doc, parseInline(cell), td);
          tr.append(td);
        }
        tbody.append(tr);
      }
      el.append(tbody);
    }
    parent.append(el);
  }
}

/** Элементы страницы для текста сообщения */
function renderMarkdown(text, doc = document) {
  const fragment = doc.createDocumentFragment();
  renderBlocks(doc, parseMarkdown(text), fragment);
  return fragment;
}

if (typeof module !== 'undefined') module.exports = { parseMarkdown, findLinks, renderMarkdown };
