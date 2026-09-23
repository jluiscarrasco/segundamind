// Intercept the PWA Share Target POST at /share and hand it back to the app.
// The browser can only send shared files via POST + multipart/form-data, but
// the SPA can only read them via GET query params — so we save each file in
// Cache Storage under a synthetic key and redirect to /share?files=<keys>,
// then the client reads them back with caches.match().

const SHARE_CACHE = 'share-target-v1';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Trim trailing slash so /share and /share/ both match.
  const pathname = url.pathname.replace(/\/$/, '');
  if (pathname !== '/share' || event.request.method !== 'POST') return;

  event.respondWith(handleShare(event.request));
});

async function handleShare(request) {
  // `sw=1` proves the service worker actually ran. If the client lands at
  // /share without this marker, it means the POST bypassed the SW entirely.
  const params = new URLSearchParams();
  params.set('sw', '1');

  try {
    const formData = await request.formData();
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const shareUrl = formData.get('url') || '';
    const files = formData.getAll('media');

    // Report what the SW actually saw. `n=` is the count of raw entries
    // received (including zero-byte / non-blob ones); `stored` is how many
    // ended up in the cache. Divergence points at the file field name or
    // an unsupported blob type.
    params.set('n', String(files.length));

    const cache = await caches.open(SHARE_CACHE);
    const fileKeys = [];
    for (const file of files) {
      if (!(file instanceof Blob) || file.size === 0) continue;
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const response = new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name || 'shared-image'),
        },
      });
      await cache.put(`/__share__/${key}`, response);
      fileKeys.push(key);
    }
    params.set('stored', String(fileKeys.length));

    if (title) params.set('title', title);
    if (text) params.set('text', text);
    if (shareUrl) params.set('url', shareUrl);
    if (fileKeys.length) params.set('files', fileKeys.join(','));

    return Response.redirect(`/share?${params.toString()}`, 303);
  } catch (err) {
    console.error('[sw-share] failed', err);
    params.set('error', (err && err.message) ? String(err.message).slice(0, 120) : '1');
    return Response.redirect(`/share?${params.toString()}`, 303);
  }
}
