'use strict';

function isExpectedSender(sender, expected) {
  return Boolean(expected && sender === expected);
}

function canOpenPip(sender, mainContents) {
  return isExpectedSender(sender, mainContents);
}

function canSendPipFrame(sender, mainContents) {
  return isExpectedSender(sender, mainContents);
}

function canClosePip(sender, mainContents, pipContents) {
  return isExpectedSender(sender, mainContents) || isExpectedSender(sender, pipContents);
}

module.exports = { canOpenPip, canSendPipFrame, canClosePip };
