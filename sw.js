/* ==========================================================================
   OG SYSTEM — service worker
   --------------------------------------------------------------------------
   Cache-first over a precached app shell. The whole product is static and
   about 1 MB, so everything is cached on install and the app runs with the
   network off after a single visit — which is the point, given the venue.

   All paths are relative so this works from a GitHub Pages project subpath
   (https://user.github.io/og-system/) as well as from a domain root.
   Bump CACHE when shipping a new build; old caches are dropped on activate.
   ========================================================================== */

var CACHE = 'og-system-v2';

var SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'assets/fonts/fonts.css',
  'assets/logo.svg',
  'assets/yalla-wear.svg',
  'assets/yalla-mark.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'js/vendor/chart.umd.min.js',
  'js/gate.js',
  'js/codes.js',
  'js/export.js',
  'js/data.js',
  'js/charts.js',
  'js/pos.js',
  'js/bulk.js',
  'js/yalla.js',
  'js/app.js'
];

/* Cache each file on its own rather than with addAll().
   addAll() is all-or-nothing: one 404 rejects the whole promise, install
   fails, the worker never activates and NOTHING is cached. Since this app is
   uploaded by hand through the GitHub web UI, a single missed file is a real
   possibility — and it must not cost us offline support for everything else.
   Anything that fails here is simply fetched from the network later. */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (url) {
        return c.add(url)['catch'](function () {
          console.warn('[sw] could not precache', url);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;      // never touch third parties

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;

      return fetch(req).then(function (res) {
        /* Cache anything same-origin we fetched successfully — this is how
           the font subsets and any later-added file get picked up. */
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        /* Offline and not cached: for a navigation, fall back to the shell
           so deep links like #open/product/1 still resolve. */
        if (req.mode === 'navigate') return caches.match('index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
