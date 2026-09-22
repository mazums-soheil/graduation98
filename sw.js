const BUILD = 'final_project';
const SHELL_CACHE = `mazums-shell-${BUILD}`;
const MEDIA_CACHE = `mazums-media-${BUILD}`;
const CACHE_PREFIX = 'mazums-';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, MEDIA_CACHE].includes(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response?.ok) await cache.put('./index.html', response.clone());
    return response;
  } catch (error) {
    return (await cache.match('./index.html')) || (await cache.match(request)) || Promise.reject(error);
  }
}

async function staleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: false });
  const network = fetch(request).then(async (response) => {
    if (response?.ok && response.type === 'basic') {
      try { await cache.put(request, response.clone()); } catch {}
    }
    return response;
  });
  if (cached) {
    // Refresh in the background without delaying the current scene.
    event?.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network;
}

async function warmAssets(urls = []) {
  const cache = await caches.open(MEDIA_CACHE);
  const unique = [...new Set(urls)].filter((url) => typeof url === 'string' && url.startsWith('assets/'));
  let cursor = 0;
  const concurrency = Math.min(3, Math.max(1, unique.length));
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < unique.length) {
      const raw = unique[cursor++];
      try {
        const request = new Request(new URL(raw, self.registration.scope).href, { credentials: 'same-origin' });
        if (await cache.match(request)) continue;
        const response = await fetch(request, { cache: 'force-cache' });
        if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      } catch {}
    }
  }));
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'WARM_ASSETS') return;
  event.waitUntil(warmAssets(event.data.urls));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/sw.js')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Native <video> range requests are intentionally left to the browser/network;
  // the page's full-file warmup request is cached separately and reused on revisit.
  if (request.headers.has('range')) return;

  if (url.pathname.includes('/assets/')) {
    event.respondWith(staleWhileRevalidate(request, MEDIA_CACHE, event));
    return;
  }

  if (/\.(?:css|js|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE, event));
  }
});
