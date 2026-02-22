const CACHE_NAME = 'milesaver-v14.1';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    // Network-first for API calls, cache-first for assets
    if (e.request.url.includes('/api/') || e.request.url.includes('openrouteservice') ||
        e.request.url.includes('graphhopper') || e.request.url.includes('osrm') ||
        e.request.url.includes('googleapis') || e.request.url.includes('overpass')) {
        // Network first, fall back to cache for API requests
        e.respondWith(
            fetch(e.request).catch(() => caches.match(e.request))
        );
    } else {
        // Cache first for static assets
        e.respondWith(
            caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
                if (resp.ok) {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
                }
                return resp;
            }))
        );
    }
});
