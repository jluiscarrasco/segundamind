// Intercept the PWA Share Target POST at /share and hand it back to the app.
// The browser can only send shared files via POST + multipart/form-data, but
// the SPA can only read them via GET query params — so we save each file in
// Cache Storage under a synthetic key and redirect to /share?files=<keys>,
// then the client reads them back with caches.match().

const SHARE_CACHE = 'share-target-v1';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname !== '/share' || event.request.method !== 'POST') return;

  event.respondWith(handleShare(event.request));
});

async function handleShare(request) {
  try {
    const formData = await request.formData();
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const shareUrl = formData.get('url') || '';
    const files = formData.getAll('media');

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

    const params = new URLSearchParams();
    if (title) params.set('title', title);
    if (text) params.set('text', text);
    if (shareUrl) params.set('url', shareUrl);
    if (fileKeys.length) params.set('files', fileKeys.join(','));

    return Response.redirect(`/share?${params.toString()}`, 303);
  } catch (err) {
    console.error('[sw-share] failed', err);
    return Response.redirect('/share?error=1', 303);
  }
}
