const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../renderer/url-policy.js'), 'utf8');
const context = { URL, window: {} };
vm.runInNewContext(source, context);
const policy = context.window.sozvonUrlPolicy;

test('preview URLs accept canonical HTTP and HTTPS only', () => {
  assert.equal(policy.safeHttpUrl('https://EXAMPLE.com/a'), 'https://example.com/a');
  assert.equal(policy.safeHttpUrl('http://example.com/a'), 'http://example.com/a');
});

test('preview URLs reject executable, local, relative, malformed and credential URLs', () => {
  for (const value of [
    'javascript:alert(1)', 'data:image/svg+xml,hello', 'blob:https://example.com/id',
    'file:///etc/passwd', 'mailto:user@example.com', '/relative/path', 'not a URL',
    'https://user:pass@example.com/', 'https://example.com/\n@evil.test',
  ]) assert.equal(policy.safeHttpUrl(value), null, value);
});

test('preview metadata drops unsafe destinations and sanitizes media separately', () => {
  assert.equal(policy.normalizeLinkPreview({ url: 'javascript:alert(1)', image: 'https://cdn.test/a.png' }), null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(policy.normalizeLinkPreview({
      url: 'https://example.com/post', image: 'data:image/png;base64,AA', video: 'https://cdn.test/video.mp4',
    }))),
    { url: 'https://example.com/post', image: null, video: 'https://cdn.test/video.mp4' },
  );
});
