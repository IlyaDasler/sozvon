// Самая старая поддерживаемая версия приложения. Приложение сообщает свою версию в User-Agent (Sozvon/1.9.0);
// браузер и запросы без версии не трогаем. Старому приложению отвечаем 426 «обновите» — а окно обновления
// оно при запуске показывает само, когда на GitHub есть версия новее.
const MIN_MAJOR = 2;
export const UPDATE_REQUIRED = 'Эта версия Созвона больше не поддерживается — обновите приложение';

export function unsupportedClient(userAgent) {
  const m = /\bSozvon\/(\d+)\.\d+\.\d+/.exec(userAgent || '');
  return Boolean(m) && Number(m[1]) < MIN_MAJOR;
}
