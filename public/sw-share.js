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
    // Log Content-Type up front — helps diagnose an empty formData when
    // Android/Chrome sends something other than multipart/form-data.
    const ct = request.headers.get('content-type') || '';
    params.set('ct', ct.slice(0, 60));

    const formData = await request.formData();

    // Iterate ALL fields instead of assuming a specific file field name.
    // Some Android/Chrome versions ignore the manifest's `name` and use
    // something else, which is exactly the failure mode we hit.
    const cache = await caches.open(SHARE_CACHE);
    const fileKeys = [];
    const textFields = { title: '', text: '', url: '' };
    const fieldNames = [];
    let entryCount = 0;

    for (const [key, value] of formData.entries()) {
      entryCount++;
      fieldNames.push(key);
      if (value instanceof Blob && value.size > 0) {
        // Anything that came through as a Blob we treat as a shared file.
        const cacheKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const filename = value.name || `${key}-shared`;
        const response = new Response(value, {
          headers: {
            'Content-Type': value.type || 'application/octet-stream',
            'X-Filename': encodeURIComponent(filename),
          },
        });
        await cache.put(`/__share__/${cacheKey}`, response);
        fileKeys.push(cacheKey);
      } else if (typeof value === 'string') {
        // Route known text fields; anything else is ignored on purpose.
        if (key === 'title' || key === 'text' || key === 'url') {
          textFields[key] = value;
        }
      }
    }

    params.set('n', String(entryCount));
    params.set('stored', String(fileKeys.length));
    // Names Android actually used, deduped, useful for triage.
    const uniqueNames = Array.from(new Set(fieldNames)).slice(0, 6).join(',');
    if (uniqueNames) params.set('fields', uniqueNames);

    if (textFields.title) params.set('title', textFields.title);
    if (textFields.text) params.set('text', textFields.text);
    if (textFields.url) params.set('url', textFields.url);
    if (fileKeys.length) params.set('files', fileKeys.join(','));

    return Response.redirect(`/share?${params.toString()}`, 303);
  } catch (err) {
    console.error('[sw-share] failed', err);
    params.set('error', (err && err.message) ? String(err.message).slice(0, 120) : '1');
    return Response.redirect(`/share?${params.toString()}`, 303);
  }
}
