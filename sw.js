/**
 * Red Read Service Worker
 * Caches app shell for offline use. Document content is stored in IndexedDB.
 */

const CACHE_NAME = 'red-reader-v25';
const APP_SHELL = [
    '/',
    '/index.html',
    '/styles.css',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

// External CDN resources to cache
const CDN_RESOURCES = [
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

// Install: cache app shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching app shell');
            // Cache local files
            const localCaching = cache.addAll(APP_SHELL).catch(err => {
                console.warn('[SW] Some local files failed to cache:', err);
            });
            // Cache CDN resources separately (they might fail due to CORS)
            const cdnCaching = Promise.all(
                CDN_RESOURCES.map(url =>
                    cache.add(url).catch(err => {
                        console.warn('[SW] Failed to cache CDN resource:', url, err);
                    })
                )
            );
            return Promise.all([localCaching, cdnCaching]);
        }).then(() => {
            // Activate immediately
            return self.skipWaiting();
        })
    );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            // Take control of all clients immediately
            return self.clients.claim();
        })
    );
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Skip chrome-extension and other non-http(s) requests
    if (!url.protocol.startsWith('http')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Return cached version
                return cachedResponse;
            }

            // Not in cache, fetch from network
            return fetch(event.request).then((networkResponse) => {
                // Don't cache non-successful responses
                if (!networkResponse || networkResponse.status !== 200) {
                    return networkResponse;
                }

                // Cache successful responses for CDN resources
                if (url.hostname === 'cdnjs.cloudflare.com') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }

                return networkResponse;
            }).catch((error) => {
                console.warn('[SW] Fetch failed:', event.request.url, error);
                // For navigation requests, return cached index.html
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
                throw error;
            });
        })
    );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
