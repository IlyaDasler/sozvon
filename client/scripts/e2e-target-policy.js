'use strict';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function assertE2EServerAllowed(value, allowRemote = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('E2E server must be a valid HTTP(S) URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('E2E server must use HTTP or HTTPS');
  }

  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) && !allowRemote) {
    throw new Error('Refusing to run E2E against a remote server; set SOZVON_ALLOW_REMOTE_E2E=1 only for a dedicated test server');
  }

  return url.origin;
}

module.exports = { assertE2EServerAllowed };
