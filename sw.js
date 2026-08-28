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

/* Bumped for the real-login build: gate.js is gone, api.js and auth.js are new.
   Bump this on EVERY upload or phones that already have the app will keep
   serving the old cached copy — including, here, a copy that still expects a
   passcode screen that no longer exists. */
var CACHE = 'og-system-v36';

var SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/shell.css',
  'css/motion-cards.css',
  'css/inputs-dashboard-pos.css',
  'css/dialogs-customers-jobs.css',
  'css/warehouse-storefront-settings.css',
  'css/tour-yalla-scan.css',
  'css/yalla-invoice-tracker-labels.css',
  'css/bulk-gate-responsive.css',
  'css/print-hardware-receipt-newlabels.css',
  'assets/fonts/fonts.css',
  'assets/logo.svg',
  'assets/cursor.svg',
  'assets/cursor-pointer.svg',
  'assets/yalla-wear.svg',
  'assets/yalla-mark.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'js/vendor/chart.umd.min.js',
  'js/api.js',
  'js/auth.js',
  'js/codes.js',
  'js/export.js',
  'js/data.js',
  'js/receipt.js',
  'js/escpos.js',
  'js/labels.js',
  'js/shop.js',
  'js/charts.js',
  'js/pos.js',
  'js/bulk.js',
  'js/motion.js',
  'js/scan.js',
  'js/wedge.js',
  'js/stock.js',
  'js/money.js',
  'js/palette.js',
  'js/whatsapp.js',
  'js/notify.js',
  'js/ylinvoice.js',
  'js/yalla.js',
  'js/deliveries.js',
  'js/app-state.js',
  'js/app-i18n.js',
  'js/app-util.js',
  'js/app-export.js',
  'js/app-shell.js',
  'js/app-dashboard.js',
  'js/app-products.js',
  'js/app-print-labels.js',
  'js/app-warehouse.js',
  'js/app-customers-scan.js',
  'js/app-jobs-reports.js',
  'js/app-storefront-settings.js',
  'js/app-documents.js',
  'js/app-tour-routing.js',
  'js/app-i18n-extra.js',
  'js/app-actions.js',
  'js/app-changes.js',
  'js/app-boot.js'
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

  /* THE SERVER IS NEVER CACHED.
     ------------------------------------------------------------------------
     This worker is cache-first with ignoreSearch, which is right for an app
     shell and catastrophic for an API. Two ways it went wrong before this
     line existed:

       - ignoreSearch means /api/sales?limit=3 is served the cached response
         to /api/sales?limit=200. Different question, previous answer.
       - cache-first means the SECOND load of the catalogue returns the first
         one. Every stock move, every new product and every sale would be
         written to the server correctly and then vanish from the screen on
         the next read, forever, with no way for the user to clear it.

     A till showing stale stock is worse than a till showing none. `/i/` is
     the public receipt: one customer's invoice must never be handed to the
     next person who scans a code on the same device. */
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/i/') === 0) return;

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
