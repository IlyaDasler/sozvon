'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canOpenPip, canSendPipFrame, canClosePip } = require('../pip-bridge-policy');

const main = {};
const pip = {};
const untrusted = {};

test('only the main renderer can open PiP and send captured frames', () => {
  assert.equal(canOpenPip(main, main), true);
  assert.equal(canOpenPip(pip, main), false);
  assert.equal(canOpenPip(untrusted, main), false);
  assert.equal(canSendPipFrame(main, main), true);
  assert.equal(canSendPipFrame(pip, main), false);
  assert.equal(canSendPipFrame(untrusted, main), false);
  assert.equal(canOpenPip(main, null), false);
});

test('only the main renderer and PiP renderer can close the PiP window', () => {
  assert.equal(canClosePip(main, main, pip), true);
  assert.equal(canClosePip(pip, main, pip), true);
  assert.equal(canClosePip(untrusted, main, pip), false);
  assert.equal(canClosePip(pip, main, null), false);
});
