import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server, api, reg;

before(async () => {
  server = await startServer();
  ({ api, reg } = server);
});

after(() => server.stop());

test('комнаты: порядок меняется перетаскиванием и сохраняется', async () => {
  const owner = await reg('order_owner');
  const hub = (await api('POST', '/hubs', { name: 'Канал' }, owner.token)).body;
  const room = async (name, kind) =>
    (await api('POST', '/rooms', { name, kind, hubId: hub.id }, owner.token)).body;
  const voice = [await room('Голос 1', 'voice'), await room('Голос 2', 'voice'), await room('Голос 3', 'voice')];
  const text = [await room('Текст 1', 'text'), await room('Текст 2', 'text')];

  // Канал создаётся с комнатами по умолчанию — они тоже участвуют в порядке своего раздела
  const roomsOfHub = async () => (await api('GET', '/rooms', null, owner.token)).body.filter((r) => r.hubId === hub.id);
  const namesOf = async (kind) => (await roomsOfHub()).filter((r) => r.kind === kind).map((r) => r.name);
  // Перестановка присылает весь раздел: наши комнаты в нужном порядке, остальные — как были
  const reorderKind = async (kind, ordered) => {
    const all = (await roomsOfHub()).filter((r) => r.kind === kind).map((r) => r.id);
    const ids = [...ordered, ...all.filter((id) => !ordered.includes(id))];
    return api('PUT', `/hubs/${hub.id}/rooms/order`, { ids }, owner.token);
  };

  // Новые комнаты встают в конец своего раздела — в том порядке, как их создавали
  const voiceBefore = await namesOf('voice');
  assert.ok(voiceBefore.indexOf('Голос 1') < voiceBefore.indexOf('Голос 2'));
  assert.ok(voiceBefore.indexOf('Голос 2') < voiceBefore.indexOf('Голос 3'));
  const textBefore = await namesOf('text');
  assert.ok(textBefore.indexOf('Текст 1') < textBefore.indexOf('Текст 2'));

  // Переставляем голосовые: третья — перед первой
  const reorder = await reorderKind('voice', [voice[2].id, voice[0].id, voice[1].id]);
  assert.equal(reorder.status, 200);
  const voiceAfter = await namesOf('voice');
  assert.ok(voiceAfter.indexOf('Голос 3') < voiceAfter.indexOf('Голос 1'));
  assert.ok(voiceAfter.indexOf('Голос 1') < voiceAfter.indexOf('Голос 2'));

  // Текстовые не тронуты: их порядок меняется только своим списком
  await reorderKind('text', [text[1].id, text[0].id]);
  const textAfter = await namesOf('text');
  assert.ok(textAfter.indexOf('Текст 2') < textAfter.indexOf('Текст 1'));
  assert.equal(voiceAfter.join(), (await namesOf('voice')).join());

  // Порядок переживает «перезаход»: позиции внутри раздела идут по возрастанию
  const fresh = await roomsOfHub();
  for (const kind of ['voice', 'text']) {
    const positions = fresh.filter((r) => r.kind === kind).map((r) => r.position);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), kind);
  }

  // Чужой канал и чужие комнаты в списке не пройдут
  const stranger = await reg('order_stranger');
  assert.equal((await api('PUT', `/hubs/${hub.id}/rooms/order`, { ids: [voice[0].id] }, stranger.token)).status, 404);
  assert.equal((await api('PUT', `/hubs/${hub.id}/rooms/order`, { ids: [] }, owner.token)).status, 400);
  // Комната другого канала в списке тоже не пройдёт
  const otherHub = (await api('POST', '/hubs', { name: 'Другой' }, owner.token)).body;
  const other = (await api('POST', '/rooms', { name: 'Чужая', kind: 'voice', hubId: otherHub.id }, owner.token)).body;
  assert.equal((await api('PUT', `/hubs/${hub.id}/rooms/order`, { ids: [other.id] }, owner.token)).status, 404);
});

test('неполный список комнат раздела не принимается', async () => {
  const owner = await reg('order_partial');
  const hub = (await api('POST', '/hubs', { name: 'Канал' }, owner.token)).body;
  const voice = (await api('POST', '/rooms', { name: 'Голос', kind: 'voice', hubId: hub.id }, owner.token)).body;
  const all = (await api('GET', '/rooms', null, owner.token)).body.filter((r) => r.hubId === hub.id && r.kind === 'voice');
  assert.ok(all.length > 1, 'в канале должна быть не одна голосовая комната');

  // Только одна комната из раздела — сервер обязан отказать, иначе порядок остальных поедет молча
  const partial = await api('PUT', `/hubs/${hub.id}/rooms/order`, { ids: [voice.id] }, owner.token);
  assert.equal(partial.status, 400);

  // Весь раздел — принимается
  const full = await api('PUT', `/hubs/${hub.id}/rooms/order`, { ids: all.map((r) => r.id).reverse() }, owner.token);
  assert.equal(full.status, 200);
});

test('голосовые и текстовые нельзя перемешать в одном списке', async () => {
  const owner = await reg('order_mixed');
  const hub = (await api('POST', '/hubs', { name: 'Канал' }, owner.token)).body;
  const voice = (await api('POST', '/rooms', { name: 'Голос', kind: 'voice', hubId: hub.id }, owner.token)).body;
  const text = (await api('POST', '/rooms', { name: 'Текст', kind: 'text', hubId: hub.id }, owner.token)).body;

  const mixed = await api('PUT', `/hubs/${hub.id}/rooms/order`, { ids: [voice.id, text.id] }, owner.token);
  assert.equal(mixed.status, 400);
});
