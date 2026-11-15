'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const presence = require('../renderer/presence-policy');

test('accepts known server presence values and safely falls back on unknown values', () => {
  assert.equal(presence.forUser({ status: 'dnd', online: false }), 'dnd');
  assert.equal(presence.forUser({ status: 'unknown', online: true }), 'online');
  assert.equal(presence.forUser({ status: '" onmouseover="alert(1)', online: false }), 'offline');
  assert.equal(presence.forSelf('<svg onload=alert(1)>'), 'online');
  assert.equal(presence.forAvatar('online" onmouseover="alert(1)'), 'offline');
});
