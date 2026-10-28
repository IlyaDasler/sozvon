// Раскладка столбца сходок — личная настройка в этом приложении: свой порядок и свои группы (папки).
// Другие люди её не видят. Вид: { items: [id сходки | { folder, name, color, collapsed, hubs: [id, ...] }] }.
// Папок внутри папок нет, в папке — от двух сходок. Все функции чистые: берут раскладку и возвращают новую.

const FOLDER_NAME_MAX = 32;
const FOLDER_COLOR_RE = /^#[0-9a-f]{6}$/i;

const isHubId = (v) => Number.isInteger(v) && v > 0;
const isFolder = (v) =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v) && typeof v.folder === 'string' && v.folder !== '' && Array.isArray(v.hubs);

// Папка с одной сходкой — уже не группа, пустая — не нужна
const tidy = (items) => items.flatMap((item) => (typeof item === 'number' ? [item] : item.hubs.length > 1 ? [item] : item.hubs));

const copyItems = (layout) => layout.items.map((i) => (typeof i === 'number' ? i : { ...i, hubs: [...i.hubs] }));
const folderWith = (items, hubId) => items.find((i) => typeof i !== 'number' && i.hubs.includes(hubId));

/** Вынимает сходку отовсюду (папки пока не схлопывает — так проще вставить её обратно рядом) */
const pluck = (items, hubId) =>
  items.filter((i) => i !== hubId).map((i) => (typeof i === 'number' ? i : { ...i, hubs: i.hubs.filter((h) => h !== hubId) }));

const cleanFolderFields = ({ name, color, collapsed }) => ({
  name: typeof name === 'string' ? name.slice(0, FOLDER_NAME_MAX) : '',
  color: FOLDER_COLOR_RE.test(color) ? color : null,
  collapsed: collapsed === true,
});

/** Раскладка из сохранённых данных (каких угодно) для нынешнего списка сходок: чужое и повторы выкидываем,
 *  новые сходки — в конец */
function normalizeLayout(raw, hubIds) {
  const known = new Set(hubIds);
  const placed = new Set();
  const folderIds = new Set();
  const fresh = (id) => {
    if (!isHubId(id) || !known.has(id) || placed.has(id)) return false;
    placed.add(id);
    return true;
  };
  const items = [];
  for (const item of Array.isArray(raw?.items) ? raw.items : []) {
    if (isHubId(item)) {
      if (fresh(item)) items.push(item);
    } else if (isFolder(item)) {
      let id = item.folder.slice(0, 40);
      while (folderIds.has(id)) id += '+';
      folderIds.add(id);
      items.push({ folder: id, ...cleanFolderFields(item), hubs: item.hubs.filter(fresh) });
    }
  }
  for (const id of hubIds) if (fresh(id)) items.push(id);
  return { items: tidy(items) };
}

/** Сходку перетащили на другую: группа на месте цели, а если цель уже в группе — в ту же группу следом за ней */
function groupHubs(layout, dragId, targetId, newFolderId) {
  if (dragId === targetId) return layout;
  const items = pluck(copyItems(layout), dragId);
  const home = folderWith(items, targetId);
  if (home) home.hubs.splice(home.hubs.indexOf(targetId) + 1, 0, dragId);
  else {
    const at = items.indexOf(targetId);
    if (at < 0) return layout;
    items[at] = { folder: newFolderId, name: '', color: null, collapsed: false, hubs: [targetId, dragId] };
  }
  return { items: tidy(items) };
}

/** Переставить сходку (число) или группу (строка) перед beforeKey; null — в конец.
 *  Сходка перед сходкой из группы попадает в эту группу; группа — встаёт перед той группой */
function moveItem(layout, key, beforeKey) {
  if (key === beforeKey) return layout;
  const isHub = typeof key === 'number';
  let items = copyItems(layout);
  const moving = isHub ? key : items.find((i) => i.folder === key);
  if (moving === undefined) return layout;
  items = isHub ? pluck(items, key) : items.filter((i) => i !== moving);

  if (beforeKey === null) items.push(moving);
  else {
    const home = typeof beforeKey === 'number' && folderWith(items, beforeKey);
    if (home && isHub) home.hubs.splice(home.hubs.indexOf(beforeKey), 0, key);
    else {
      const anchor = home || (typeof beforeKey === 'number' ? beforeKey : items.find((i) => i.folder === beforeKey));
      const at = items.indexOf(anchor);
      if (at < 0) return layout;
      items.splice(at, 0, moving);
    }
  }
  return { items: tidy(items) };
}

/** Название, цвет, свёрнута ли группа */
function updateFolder(layout, folderId, patch) {
  return {
    items: layout.items.map((i) => (typeof i !== 'number' && i.folder === folderId ? { ...i, ...cleanFolderFields({ ...i, ...patch }) } : i)),
  };
}

/** Разобрать группу: сходки встают на её место */
function ungroup(layout, folderId) {
  return { items: layout.items.flatMap((i) => (typeof i !== 'number' && i.folder === folderId ? i.hubs : [i])) };
}

/** Все сходки по порядку, как в столбце */
const hubOrder = (layout) => layout.items.flatMap((i) => (typeof i === 'number' ? [i] : i.hubs));

if (typeof module !== 'undefined') module.exports = { normalizeLayout, groupHubs, moveItem, updateFolder, ungroup, hubOrder };
