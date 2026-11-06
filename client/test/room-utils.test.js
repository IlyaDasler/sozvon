'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('formatVoiceTime: минуты и часы', async () => {
  const { formatVoiceTime } = await import('../renderer/room-utils.mjs');
  assert.equal(formatVoiceTime(0), '00:00');
  assert.equal(formatVoiceTime(65_000), '01:05');
  assert.equal(formatVoiceTime(3_665_000), '1:01:05');
  assert.equal(formatVoiceTime(-1000), '00:00');
});

test('sameRoomGroup: null и id', async () => {
  const { sameRoomGroup } = await import('../renderer/room-utils.mjs');
  assert.equal(sameRoomGroup({ groupId: 2 }, { groupId: 2 }), true);
  assert.equal(sameRoomGroup({ groupId: 2 }, { groupId: null }), false);
  assert.equal(sameRoomGroup({}, {}), true);
});
