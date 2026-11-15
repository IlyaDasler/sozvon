'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

/** Allow a top-level file navigation only to the trusted renderer entry file. */
function isTrustedLocalNavigation(rawUrl, trustedFile) {
  try {
    const url = new URL(String(rawUrl));
    if (url.protocol !== 'file:') return false;

    // Query strings and fragments do not change which local document is loaded.
    url.search = '';
    url.hash = '';
    const candidate = path.resolve(fileURLToPath(url));
    const trusted = path.resolve(String(trustedFile));
    return process.platform === 'win32'
      ? candidate.toLowerCase() === trusted.toLowerCase()
      : candidate === trusted;
  } catch {
    return false;
  }
}

module.exports = { isTrustedLocalNavigation };
