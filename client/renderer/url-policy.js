// URL policy for sender-controlled preview metadata. Decrypted attachment blob
// URLs are created by the app and intentionally use a separate code path.
(() => {
  function safeHttpUrl(value) {
    if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f]/.test(value)) return null;
    try {
      const url = new URL(value);
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function normalizeLinkPreview(preview) {
    if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return null;
    const url = safeHttpUrl(preview.url);
    if (!url) return null;
    return { ...preview, url, image: safeHttpUrl(preview.image), video: safeHttpUrl(preview.video) };
  }

  window.sozvonUrlPolicy = Object.freeze({ safeHttpUrl, normalizeLinkPreview });
})();
