// История переписок: одна для личных чатов и комнат. Сервер отдаёт по 50 сообщений от новых к старым;
// последняя страница приходит при открытии чата и после обрыва связи, старые — при прокрутке вверх.

const HISTORY_PAGE = 50;
const historyLoading = new Set(); // переписки, чьи старые сообщения сейчас грузятся

// Где лежит история переписки и как её показать
const dmHistory = (peerId) => ({
  map: state.history,
  key: peerId,
  conv: dmConvOf(peerId),
  url: `/messages/${peerId}`,
  open: () => state.selectedId === peerId,
  render: renderMessages,
});

const roomHistory = (roomId) => ({
  map: state.roomHistory,
  key: roomId,
  conv: roomConvOf(roomId),
  url: `/rooms/${roomId}/messages`,
  open: () => state.selectedRoomId === roomId,
  render: renderRoomMessages,
});

/** Страница с сервера, расшифрованная, от старых к новым */
async function fetchPage(h, before) {
  const page = await Api.get(before ? `${h.url}?before=${before}` : h.url);
  await decryptMessages(page, h.conv);
  return page.sort((a, b) => a.id - b.id);
}

/**
 * Что держать в памяти, когда пришла последняя страница: сервер прав во всём, что она покрывает (правки и удаления),
 * новее неё — то, что успело прийти, пока она грузилась. Старое остаётся, только если стыкуется со страницей:
 * за обрыв могло накопиться больше страницы, и тогда между ними дыра.
 */
function mergeLatest(known, page) {
  if (!page.length) return { list: [...known], older: false };
  const first = page[0].id;
  const last = page.at(-1).id;
  const joins = page.length < HISTORY_PAGE || known.some((m) => m.id >= first);
  const older = joins && page.length === HISTORY_PAGE ? known.filter((m) => m.id < first) : [];
  return { list: [...older, ...page, ...known.filter((m) => m.id > last)], older: older.length > 0 };
}

/** Последняя страница: при открытии чата и после обрыва связи */
async function loadHistory(h) {
  try {
    const page = await fetchPage(h);
    const { list, older } = mergeLatest(h.map.get(h.key) || [], page);
    h.map.set(h.key, list);
    if (page.length < HISTORY_PAGE) state.historyEnd.add(h.conv);
    else if (!older) state.historyEnd.delete(h.conv);
    if (h.open()) h.render();
  } catch (err) {
    toast(err.message);
  }
}

/** Страница постарше; false — дальше нечего показывать */
async function loadOlder(h) {
  const first = h.map.get(h.key)?.[0];
  if (!first || state.historyEnd.has(h.conv) || historyLoading.has(h.conv)) return false;
  historyLoading.add(h.conv);
  try {
    const page = await fetchPage(h, first.id);
    if (page.length < HISTORY_PAGE) state.historyEnd.add(h.conv);
    const list = h.map.get(h.key);
    if (list) list.unshift(...page.filter((m) => m.id < list[0].id));
    if (h.open()) h.render();
    return page.length > 0;
  } catch (err) {
    toast(err.message);
    return false;
  } finally {
    historyLoading.delete(h.conv);
  }
}

/** Связь вернулась: открытая переписка догоняет сервер, остальные загрузятся заново, когда их откроют */
function catchUpHistory() {
  for (const [map, open, of] of [
    [state.history, state.selectedId, dmHistory],
    [state.roomHistory, state.selectedRoomId, roomHistory],
  ]) {
    for (const key of [...map.keys()]) if (key !== open) map.delete(key);
    if (map.has(open)) loadHistory(of(open));
  }
}
