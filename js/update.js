/* ==========================================================================
   THE APP UPDATES ITSELF, ONCE, AND NEVER HALF-WAY          [Update]
   --------------------------------------------------------------------------
   `sw.js` is cache-first with `ignoreSearch`, so a browser that already has
   the app keeps serving what it has until its cache name changes. Two things
   followed from that, and both were real:

   1. A TAB LEFT OPEN NEVER GOT THE NEW CODE. Nothing told it. The shop
      laptop keeps the app open all day; the only ways out were the panel's
      Full refresh (which deliberately does not reach a cashier's tab) or
      somebody knowing to clear a cache.

   2. A MIXED SET COULD RUN. The old worker called `skipWaiting()` in install
      and `clients.claim()` in activate, so a NEW worker took over a page that
      had already parsed the OLD files — and anything fetched from then on
      (the lazily injected Chart.js, three.js, an icon) came out of the new
      cache. Old code, new files, no reload: the exact shape of "the buttons
      do nothing".

   THE RULE HERE IS THAT A PAGE RUNS ONE BUILD FROM FIRST BYTE TO RELOAD.
   The new worker now WAITS (no `skipWaiting` in install). While it waits the
   page keeps its own consistent set. When this module decides the moment is
   safe it tells the worker to take over and reloads on `controllerchange` —
   one reload, one build, never a blend of two.

   WHEN IS IT SAFE. Never under somebody's hands. `js/pulse.js` has said for
   two night shifts that a till reloading itself mid-sale is a lost sale, so
   this waits for: no open sale in the basket, no modal or drawer open, no
   print dialog, and the window actually visible. It re-asks every few
   seconds and on focus, so the reload lands in the gap between two customers
   rather than across one.
   ========================================================================== */

var Update = (function () {

  var reg = null;          /* the ServiceWorkerRegistration, once we have it */
  var ready = false;       /* a new build is installed and waiting           */
  var reloading = false;   /* the one-reload latch                           */
  var timer = null;
  var swCache = '';        /* the cache name the ACTIVE worker is serving     */

  /* -------------------------------------------------------------- the gate

     Everything that means "somebody is in the middle of something". Each is
     read off the DOM or the module that owns it, never counted — a counter
     that one path forgets to decrement wedges the update for the session. */
  function busy() {
    try {
      if (document.hidden) return true;
      if (document.body.getAttribute('data-overlay')) return true;
      if (document.querySelector('#modal-root .modal')) return true;
      if (document.querySelector('#drawer-root .drawer')) return true;
      if (document.querySelector('.og-refresh')) return true;   /* the panel's own refresh */
      /* The basket is the one piece of work a reload really costs: it lives
         in memory. The order desk's half-typed order does NOT — its draft is
         in localStorage with its own opId and comes back exactly as it was
         — so it is deliberately not a reason to wait. */
      if (typeof POS !== 'undefined' && POS.saleOpen && POS.saleOpen()) return true;
    } catch (e) { /* a broken guard must never block the update for ever */ }
    return false;
  }

  /* ------------------------------------------------------------ the reload

     `controllerchange` fires once the waiting worker has taken over. The
     latch is what keeps this to ONE reload: without it a second
     controllerchange (or a second call) reloads a page that is already on
     its way out. */
  function apply() {
    if (reloading || !ready || !reg || !reg.waiting) return;
    reloading = true;
    try {
      if (typeof toast === 'function') toast(t('up_new'), t('up_reloading'), 'ok', 4000);
    } catch (e) {}
    /* Long enough to be read, short enough not to be a wait. */
    setTimeout(function () {
      try { reg.waiting.postMessage({ type: 'skip-waiting' }); }
      catch (e) { location.reload(); }
      /* If the worker never answers, reload anyway rather than sit on old
         code for ever. */
      setTimeout(function () { if (reloading) location.reload(); }, 4000);
    }, 900);
  }

  function tick() {
    if (!ready || reloading) return;
    if (busy()) return;
    apply();
  }

  function armed() {
    if (timer) return;
    timer = setInterval(tick, 3000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    tick();
  }

  /* ------------------------------------------------------- what we watch */

  function found(sw) {
    if (!sw) return;
    sw.addEventListener('statechange', function () {
      /* `installed` WITH a controller means this is an update, not the very
         first install — a first install has nothing to replace and nothing
         to reload for. */
      if (sw.state === 'installed' && navigator.serviceWorker.controller) {
        ready = true;
        armed();
      }
    });
  }

  function watch(r) {
    if (!r) return;
    reg = r;
    if (r.waiting && navigator.serviceWorker.controller) { ready = true; armed(); }
    if (r.installing) found(r.installing);
    r.addEventListener('updatefound', function () { found(r.installing); });

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!reloading) return;      /* somebody else's claim — not ours */
      location.reload();
    });

    /* Ask the server whether there is a new worker: on focus, and every five
       minutes for a tab nobody touches. `update()` is a conditional request;
       with no new bytes it costs one 304. */
    var ask = function () { try { r.update(); } catch (e) {} };
    window.addEventListener('focus', ask);
    setInterval(ask, 5 * 60 * 1000);

    /* What build is actually running, for the label in Settings. */
    if (navigator.serviceWorker.controller) askVersion();
  }

  function askVersion() {
    try {
      var ch = new MessageChannel();
      ch.port1.onmessage = function (e) {
        if (e.data && e.data.cache) swCache = String(e.data.cache);
      };
      navigator.serviceWorker.controller.postMessage({ type: 'version' }, [ch.port2]);
    } catch (e) {}
  }

  /* --------------------------------------------------------------- public */

  /* What is running, for the developer's label. `sw` is the cache name the
     worker answered with — the one thing that proves which FILE SET this
     page is on — and `server` is what the server said about itself. */
  function info() {
    return {
      sw: swCache || (navigator.serviceWorker && navigator.serviceWorker.controller ? '…' : ''),
      controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      server: (window.OG && OG.build) || null,
      pending: ready
    };
  }

  return { watch: watch, info: info, busy: busy, _apply: apply };
})();
