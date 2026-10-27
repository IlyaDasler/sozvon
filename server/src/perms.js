// Права в комнате. Создатель может всё; у остальных права от роли, а без роли — права по умолчанию для комнаты.
// Те же числа живут в клиенте (renderer/rooms.js) — меняйте вместе.

export const PERMS = {
  connect: 1, // заходить в голосовой канал
  speak: 2, // говорить
  video: 4, // камера и демонстрация экрана
  write: 8, // писать в чат
  invite: 16, // звать своих друзей
  kick: 32, // выгонять из комнаты и отключать от голоса
  ban: 64, // банить
  manage: 128, // название, права по умолчанию, роли
  admin: 256, // всё перечисленное
};

export const ALL_PERMS = Object.values(PERMS).reduce((a, b) => a | b, 0);
export const DEFAULT_PERMS = PERMS.connect | PERMS.speak | PERMS.video | PERMS.write | PERMS.invite;

export const cleanPerms = (value) => (Number.isInteger(value) ? value & ALL_PERMS : 0);

/** Итоговые права: admin включает всё */
export const expandPerms = (perms) => (perms & PERMS.admin ? ALL_PERMS : perms);

export const has = (perms, perm) => Boolean(expandPerms(perms) & perm);

const MODERATION = PERMS.kick | PERMS.ban | PERMS.manage;

/** Старшинство: создатель > администратор > модератор (может выгонять, банить или настраивать) > остальные.
 *  Действовать можно только на тех, кто младше */
export const rankOf = (isOwner, perms) => (isOwner ? 4 : perms & PERMS.admin ? 3 : perms & MODERATION ? 2 : 1);
