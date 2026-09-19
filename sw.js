/* ==========================================================================
   OG SYSTEM — service worker
   --------------------------------------------------------------------------
   Cache-first over a precached app shell. The app needs the server — every
   screen reads from it — so this is not an offline mode: it caches the shell
   (HTML, CSS, JS, fonts, icons) so a reload is fast and survives a blip in
   the wifi. /api/ and /i/ are never cached; see the fetch handler.

   All paths are relative, so the shell resolves against wherever the server
   serves it from. Old caches are dropped on activate.
   ========================================================================== */

/* Bump this on EVERY change under css/, js/ or index.html (the panel's Full
   refresh does it), or browsers that already have the app will keep serving
   the old cached copy — cache-first with ignoreSearch, so no query string
   gets past it. */
var CACHE = 'og-system-v283';

var SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/shell.css',
  'css/motion-cards.css',
  'css/inputs-dashboard-pos.css',
  'css/dialogs-customers-jobs.css',
  'css/warehouse-settings.css',
  'css/yalla-scan.css',
  'css/yalla-invoice-tracker-labels.css',
  'css/bulk-gate-responsive.css',
  'css/splash.css',
  'css/print-hardware-receipt-newlabels.css',
  'css/yalla-theme.css',
  'css/og-skin.css',
  'assets/fonts/fonts.css',
  /* Cairo carries the Arabic on a 60x40 thermal label; Montserrat has no
     Arabic glyphs at all. Precached because the shop is regularly offline. */
  'assets/fonts/Cairo-700.ttf',
  'assets/logo.svg',
  'assets/instagram-mark.svg',
  'assets/telegram-mark.svg',
  'assets/cursor.svg',
  'assets/cursor-pointer.svg',
  'assets/yalla-wear.svg',
  'assets/yalla-mark.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'js/vendor/chart.umd.min.js',
  'js/vendor/three.min.js',
  'js/update.js',
  'js/layers.js',
  'js/api.js',
  'js/auth.js',
  'js/codes.js',
  'js/export.js',
  'js/data.js',
  'js/receipt.js',
  'js/escpos.js',
  'js/labels.js',
  'js/labels60.js',
  'js/shelfroom.js',
  'js/shelfmap.js',
  'js/shop.js',
  'js/splash.js',
  'js/charts.js',
  'js/pos.js',
  'js/bulk.js',
  'js/motion.js',
  'js/scan.js',
  'js/wedge.js',
  'js/stock.js',
  'js/receive.js',
  'js/home.js',
  'js/money.js',
  'js/cashbook.js',
  'js/payables.js',
  'js/statement.js',
  'js/selectbox.js',
  'js/datepick.js',
  'js/catset.js',
  'js/colourpick.js',
  'js/colourform.js',
  'js/access.js',
  'js/staff.js',
  'js/safeers.js',
  'js/palette.js',
  'js/whatsapp.js',
  'js/notify.js',
  'js/pulse.js',
  'js/ylinvoice.js',
  'js/yalla.js',
  'js/deliveries.js',
  'js/reviews.js',
  'js/desk.js',
  'js/road.js',
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
  'js/app-settings.js',
  'js/app-documents.js',
  'js/app-routing.js',
  'js/app-i18n-extra.js',
  'js/app-actions.js',
  'js/app-changes.js',
  'js/app-boot.js'
];

/* Cache each file on its own rather than with addAll().
   addAll() is all-or-nothing: one 404 rejects the whole promise, install
   fails, the worker never activates and NOTHING is cached. A file dropped from
   the tree but still named in SHELL is a real possibility, and it must not
   cost the cache for everything else. Anything that fails here is simply
   fetched from the network later. */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (url) {
        return c.add(url)['catch'](function () {
          console.warn('[sw] could not precache', url);
        });
      }));
    })
    /* NO skipWaiting HERE, and that is the point. It used to take over the
       moment it had installed, so a page that had already parsed the OLD
       files started being served the NEW ones for anything it fetched later
       — the lazily injected Chart.js, three.js, an icon. Old code, new
       files, and no reload to settle it.

       The new worker WAITS instead. The page keeps its own consistent set
       until js/update.js decides nobody is mid-sale, tells this worker to
       take over (the message below) and reloads once. One page, one build.
       fix_05_log.md has the story. */
  );
});

/* The page's two questions. `skip-waiting` is js/update.js saying it is safe
   to swap; `version` is the developer's label in Settings asking which file
   set is actually being served — the one thing that settles "am I looking at
   the new build?" without anybody guessing. */
self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'skip-waiting') { self.skipWaiting(); return; }
  if (d.type === 'version' && e.ports && e.ports[0]) {
    e.ports[0].postMessage({ cache: CACHE });
  }
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

/* NO PUSH HANDLERS HERE ANY MORE (052). They served only the office's order
   alerts, which moved to the shop's Telegram bot: a service worker will not
   register on a self-signed certificate, so on a LAN-only shop this bell could
   never have worked anywhere but the till. The CUSTOMER's push is untouched —
   the tracking page has its own worker at /i/sw.js (Tracking.WORKER, scope
   /i/), and that is the only worker a customer's browser subscribes through. */
