// Intercept the PWA Share Target POST at /share and hand it back to the app.
// The browser can only send shared files via POST + multipart/form-data, but
// the SPA can only read them via GET query params — so we save each file in
// Cache Storage under a synthetic key and redirect to /share?files=<keys>,
// then the client reads them back with caches.match().
//
// We do NOT use request.formData(): Chrome on Android returns an empty
// FormData for many share_target POSTs even though the body is intact.
// Instead we read request.arrayBuffer() and parse the multipart body by
// hand — reliable and boundary-agnostic.

const SHARE_CACHE = 'share-target-v1';

function indexOfBytes(hay, needle, start) {
  outer: for (let i = start; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// Parse a multipart/form-data body into [{ name, filename?, type, data }].
// Handles CRLF between parts and strips the trailing CRLF from each part.
async function parseMultipart(request) {
  const ct = request.headers.get('content-type') || '';
  const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundaryMatch) throw new Error('missing multipart boundary');
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  const buf = new Uint8Array(await request.arrayBuffer());
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const delim = enc.encode(`--${boundary}`);
  const CRLF = 0x0d0a;

  const entries = [];
  let cursor = indexOfBytes(buf, delim, 0);
  while (cursor !== -1) {
    let partStart = cursor + delim.length;
    // Check for terminating "--" after the boundary
    if (buf[partStart] === 0x2d && buf[partStart + 1] === 0x2d) break;
    // Skip CRLF after boundary
    if (buf[partStart] === 0x0d && buf[partStart + 1] === 0x0a) partStart += 2;

    const nextBoundary = indexOfBytes(buf, delim, partStart);
    if (nextBoundary === -1) break;
    // Part body ends at CRLF right before next boundary
    let partEnd = nextBoundary;
    if (buf[partEnd - 2] === 0x0d && buf[partEnd - 1] === 0x0a) partEnd -= 2;

    // Split headers / body at first CRLFCRLF within the part
    const headerEnd = indexOfBytes(buf, enc.encode('\r\n\r\n'), partStart);
    if (headerEnd === -1 || headerEnd > partEnd) {
      cursor = nextBoundary;
      continue;
    }
    const headersText = dec.decode(buf.slice(partStart, headerEnd));
    const bodyBytes = buf.slice(headerEnd + 4, partEnd);

    const dispMatch = headersText.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (dispMatch) {
      const name = dispMatch[1];
      const filename = dispMatch[2];
      const typeMatch = headersText.match(/content-type:\s*([^\r\n]+)/i);
      const type = typeMatch ? typeMatch[1].trim() : (filename !== undefined ? 'application/octet-stream' : 'text/plain');
      entries.push({ name, filename, type, data: bodyBytes });
    }

    cursor = nextBoundary;
  }
  return entries;
}

async function handleShare(request) {
  const params = new URLSearchParams();
  params.set('sw', '1');

  try {
    const ct = request.headers.get('content-type') || '';
    params.set('ct', ct.slice(0, 60));
    const cl = request.headers.get('content-length') || '';
    if (cl) params.set('cl', cl);

    // Read the body first so we can report its true size — even if parsing
    // then fails downstream.
    const buf = new Uint8Array(await request.clone().arrayBuffer());
    params.set('bytes', String(buf.length));

    // Body is tiny → include it verbatim so we can see whether Chrome sent
    // a real multipart with files or just the boundary delimiters. Base64
    // keeps CRLFs and non-ASCII safe inside the query string.
    if (buf.length > 0 && buf.length < 600) {
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      params.set('body', btoa(bin));
    }

    const parts = await parseMultipart(request);
    params.set('n', String(parts.length));

    const cache = await caches.open(SHARE_CACHE);
    const fileKeys = [];
    const text = { title: '', text: '', url: '' };
    const seenNames = [];

    for (const part of parts) {
      seenNames.push(part.name);
      const isFile = part.filename !== undefined || part.type.startsWith('image/');
      if (isFile && part.data.length > 0) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const blob = new Blob([part.data], { type: part.type });
        const response = new Response(blob, {
          headers: {
            'Content-Type': part.type,
            'X-Filename': encodeURIComponent(part.filename || `${part.name}-shared`),
          },
        });
        await cache.put(`/__share__/${key}`, response);
        fileKeys.push(key);
      } else if (!isFile) {
        const value = new TextDecoder().decode(part.data);
        if (part.name in text) text[part.name] = value;
      }
    }
    params.set('stored', String(fileKeys.length));
    const uniqueNames = Array.from(new Set(seenNames)).slice(0, 6).join(',');
    if (uniqueNames) params.set('fields', uniqueNames);

    if (text.title) params.set('title', text.title);
    if (text.text) params.set('text', text.text);
    if (text.url) params.set('url', text.url);
    if (fileKeys.length) params.set('files', fileKeys.join(','));

    return Response.redirect(`/share?${params.toString()}`, 303);
  } catch (err) {
    console.error('[sw-share] failed', err);
    params.set('error', (err && err.message) ? String(err.message).slice(0, 120) : '1');
    return Response.redirect(`/share?${params.toString()}`, 303);
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Trim trailing slash so /share and /share/ both match.
  const pathname = url.pathname.replace(/\/$/, '');
  if (pathname !== '/share' || event.request.method !== 'POST') return;

  event.respondWith(handleShare(event.request));
});
