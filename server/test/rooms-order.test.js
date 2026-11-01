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

  // Канал создаётся с комнатами по умолчанию — смотрим только на свои
  const ours = new Set(['Голос 1', 'Голос 2', 'Голос 3', 'Текст 1', 'Текст 2']);
  const names = async () =>
    (await api('GET', '/rooms', null, owner.token)).body.filter((r) => r.hubId === hub.id && ours.has(r.name)).map((r) => r.name);

  // Новые комнаты встают в конец — сначала в том порядке, как их создавали
  assert.deepEqual(await names(), ['Голос 1', 'Голос 2', 'Голос 3', 'Текст 1', 'Текст 2']);

  // Переставляем голосовые: третья — перед первой
  const reorder = await api(
    'PUT',
    `/hubs/${hub.id}/rooms/order`,
    { ids: [voice[2].id, voice[0].id, voice[1].id] },
    owner.token
  );
  assert.equal(reorder.status, 200);
  assert.deepEqual(await names(), ['Голос 3', 'Голос 1', 'Голос 2', 'Текст 1', 'Текст 2']);

  // Текстовые не тронуты: их порядок меняется только своим списком
  await api('PUT', `/hubs/${hub.id}/rooms/order`, { ids: [text[1].id, text[0].id] }, owner.token);
  assert.deepEqual(await names(), ['Голос 3', 'Голос 1', 'Голос 2', 'Текст 2', 'Текст 1']);

  // Порядок переживает «перезаход»: данные комнат отдаются с позицией (позиции — внутри своего раздела)
  const fresh = (await api('GET', '/rooms', null, owner.token)).body.filter((r) => r.hubId === hub.id && ours.has(r.name));
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
