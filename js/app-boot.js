/* ==========================================================================
   OG SYSTEM — application shell  ·  17/17: BOOT
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 7639-7846, section 20 "BOOT").
   Absolute last app-* file — bindGlobal() reads ACTIONS/CHANGES/VIEWS,
   boot()/start() call functions from every earlier file, and the trailing
   statement kicks the whole app off.
   ========================================================================== */

/* ------------------------------------------------------------------ 20. BOOT */

function bindGlobal() {
  document.addEventListener('click', function (e) {
    /* Bulk owns its own namespace — never let a checkbox also open a drawer. */
    if (e.target.closest && e.target.closest('[data-bk]')) return;

    var el = e.target.closest ? e.target.closest('[data-act]') : null;

    /* close the notification popover when clicking elsewhere */
    var pop = document.getElementById('notifPop');
    if (pop && !pop.contains(e.target) && (!el || el.getAttribute('data-act') !== 'bell')) pop.remove();

    /* same for the account menu. Clicks INSIDE it must survive, or the item
       being clicked is removed before its own handler runs. */
    var ap = document.getElementById('acctPop');
    if (ap && !ap.contains(e.target) && (!el || el.getAttribute('data-act') !== 'acct')) ap.remove();

    /* close the global search dropdown */
    var sr = document.getElementById('searchResults');
    if (sr && sr.innerHTML && !e.target.closest('.search')) sr.innerHTML = '';

    if (!el) return;
    var fn = ACTIONS[el.getAttribute('data-act')];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'globalSearch') { runSearch(el.value); return; }
    var k = el.getAttribute && el.getAttribute('data-change');
    if (k && CHANGES[k] && el.tagName !== 'SELECT' && el.type !== 'checkbox') CHANGES[k](el);
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    var k = el.getAttribute && el.getAttribute('data-change');
    if (k && CHANGES[k] && (el.tagName === 'SELECT' || el.type === 'checkbox')) CHANGES[k](el);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (modalOpen()) { closeModal(); return; }
      if (document.getElementById('drawer-root').firstChild) { closeDrawer(); return; }
      if (Tour.on) { Tour.stop(); return; }
      var sc = Bulk.scope();
      if (sc && Bulk.count(sc)) { Bulk.clear(sc); render(); Bulk.paint(); }
    }
    if (Tour.on && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      var fwd = (e.key === 'ArrowRight') !== (OG.lang === 'ar');
      Tour.go(Tour.i + (fwd ? 1 : -1));
    }
  });

  window.addEventListener('resize', function () { if (Tour.on) Tour.paint(); });
  window.addEventListener('hashchange', function () {
    var raw = window.location.hash;
    if (handleDeepLink(raw)) return;
    var v = raw.replace('#', '');
    if (v && VIEWS[v] && v !== OG.view) go(v);
  });
}

/* ---- thermal roll page sizing --------------------------------------------
   `@page { size: … }` is the one property that cannot be driven by a CSS
   variable or a class — the browser reads it from the stylesheet at print
   time, so the rule has to be WRITTEN with the numbers in it.

   Called immediately before window.print(). In roll mode each label becomes a
   page of exactly its own size with no margin; in sheet mode the A4 rule the
   app has always used is restored. */
function setRollPageSize() {
  var id = 'rollPageRule';
  var old = document.getElementById(id);
  if (old) old.parentNode.removeChild(old);

  var roll = OG.lb.mode === 'roll';
  document.body.classList.toggle('roll-labels', roll);
  if (!roll) return;

  var dim = labelDim();
  var st = document.createElement('style');
  st.id = id;
  st.textContent = '@media print{@page{size:' + dim.w + 'mm ' + dim.h + 'mm;margin:0}' +
                   'body.roll-labels .blabel{width:' + dim.w + 'mm;height:' + dim.h + 'mm}}';
  document.head.appendChild(st);
}

/* A page of rulers. Thermal printers scale silently when the driver's stock
   size does not match the roll that is actually loaded, and a barcode printed
   at 94% simply stops scanning — with nothing on screen to suggest why. The
   only honest test is to print a known length and measure it. */
function openCalibration() {
  var dim = labelDim();
  var body =
    '<div class="cal-sheet" style="width:' + dim.w + 'mm">' +
      '<div class="cal-row"><span class="cal-rule h"></span><small>10 mm</small></div>' +
      '<div class="cal-row"><span class="cal-rule v"></span><small>10 mm tall</small></div>' +
      '<div class="cal-row"><small>' + dim.w + ' &times; ' + dim.h + ' mm</small></div>' +
      '<div class="cal-row">' + Codes.code128SVG('OG-CAL-10MM', { module: 1.2, height: 26 }) + '</div>' +
    '</div>';

  openModal({
    title: t('hw_calibrate'),
    size: 'narrow',
    body: body + '<div class="partner-note mt no-print">' + t('hw_calibrate_note') + '</div>',
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
          '<button class="btn btn-primary" data-act="print-now">' + t('print') + '</button>'
  });
}

/* ---- the hardware scanner, everywhere ------------------------------------
   A cable, dongle or Bluetooth scanner types wherever the cursor happens to
   be. Before this, a scan only registered when the POS search box was focused;
   from the dashboard or the warehouse it went nowhere.

   Two rules. At the till a scan IS the sale: straight into the cart, no
   sheet, no extra Enter — the person scanning there is mid-queue with a box
   in one hand. On every other screen a scan opens the product sheet, because
   away from the till the question is "what is this?", not "sell this". */
function handleScan(code) {
  /* Only an EXACT product code goes into the cart — the same three matchers
     labels.js trusts, and pointedly not resolveScan's cropped-label prefix
     guess: a guess picks whichever size sorts first, and a guessed size in
     the cart with only a toast to announce it is a mischarge waiting at the
     door. Everything else — a QR deep link, an invoice, a job card, a
     partial or unknown code — falls through to the sheet, which knows what
     to do with each and asks before selling anything.

     The partner check matters because OG.view stays 'pos' while a manager
     previews the Yalla portal: a scan taken there must not feed a cart
     nobody can see. */
  if (OG.view === 'pos' && !(OG.print && OG.print.partner) && typeof POS !== 'undefined') {
    var c = String(code || '').trim();
    var v = DB.variantByBarcode(c) || DB.variantBySku(c) ||
            (DB.variantByLabelCode && DB.variantByLabelCode(c));
    if (v) {
      closeModal();
      POS.add(v);
      return;
    }
  }
  closeModal();
  openScanResult(code);
}

function bindWedge() {
  if (typeof Wedge === 'undefined') return;

  /* A scanner left in presentation mode re-reads the same label every few
     hundred milliseconds while it sits under the beam, and each re-read
     used to be a whole extra unit in the cart — or, on the sheet, a
     phantom press of its Sell button. Two deliberate scans of a second
     identical box are essentially never this fast, so inside this window
     the same code is one scan. The camera has its own, longer window
     (scan.js's DUPE_MS) because video re-decodes for as long as the label
     is in frame. */
  var DUPE_MS = 700;
  var lastCode = null, lastAt = 0;

  Wedge.onScan(function (code) {
    /* The hardware settings page owns the scanner while it is open, or its
       own test box would fire the product sheet on every test scan. */
    if (OG.view === 'settings' && OG.set && OG.set.captureScans) return;

    /* Scanning IS the answer to "what did you want?" — a palette left open
       would sit over whatever the scan produces and feed the next Enter to
       its highlighted row instead of the page. */
    if (typeof Palette !== 'undefined' && Palette.isOpen()) Palette.close();

    /* The label batch modal owns the scanner — labels.js turns a scan into
       +1 on the matching row. Acting here too would close the batch
       mid-count. But labels.js only knows exact product codes and stays
       silent otherwise, so the one thing owed from here is feedback on a
       code it will ignore — silence reads as a dead scanner. */
    if (document.querySelector('.lbl-picker')) {
      var known = DB.variantByBarcode(code) || DB.variantBySku(code) ||
                  (DB.variantByLabelCode && DB.variantByLabelCode(code));
      if (!known) toast(t('lbl_unknown_code'), String(code).slice(0, 40), 'warn');
      return;
    }

    var now = Date.now();
    if (code === lastCode && (now - lastAt) < DUPE_MS) { lastAt = now; return; }
    lastCode = code; lastAt = now;

    /* A second scan of the same code confirms whatever the sheet is already
       offering, so a fast cashier never has to reach for the keyboard. */
    var open = document.getElementById('scPrimary');
    if (open && open.getAttribute('data-code') === code) { open.click(); return; }

    handleScan(code);
  });
}

function boot() {
  applyLang();

  /* Yalla Wear signs in and is already inside their portal. Set before the
     first paint, so there is no frame in which the shop's dashboard is on
     screen — and set here rather than by hiding the toggle, because the
     toggle is a button and buttons can be clicked from a console. */
  if (isPartnerAccount()) OG.print.partner = true;

  /* deliveries.js adds its own handlers to the shared ACTIONS table. Done at
     boot rather than at load time because ACTIONS is a var in this file and
     script order should not decide whether the buttons work. */
  if (typeof Deliveries !== 'undefined') Deliveries.register();
  if (typeof Receipt !== 'undefined') Receipt.register();
  if (typeof Labels !== 'undefined') Labels.register();

  renderTopbar();
  var raw = window.location.hash;
  var v = raw.replace('#', '');
  OG.view = (v && VIEWS[v]) ? v : 'dashboard';

  /* The same guard go() applies, because the case go()'s comment names — a
     bookmarked #settings — arrives HERE, not there. Landing straight on a
     screen from the address bar skipped the check entirely: a cashier with
     #settings saved would have rendered the roles grid, half-filled from data
     the server then refuses. */
  if (!navAllowed(OG.view)) {
    var firstAllowed = allowedNav()[0];
    OG.view = firstAllowed ? firstAllowed.id : 'dashboard';
  }
  /* First paint gets the full entrance — this is the moment he first sees
     the app, and it is the one time the animation is unambiguously worth it. */
  if (typeof Motion !== 'undefined') Motion.mark();
  renderSidebar();
  render();
  bindGlobal();
  bindWedge();
  /* a scanned QR lands here — route after the shell exists */
  if (raw.indexOf('#open/') === 0) handleDeepLink(raw);

  if (!Charts.has()) {
    console.info('Chart.js unavailable — charts fall back to CSS bars.');
  }
  setTimeout(function () {
    toast('OG System', OG.lang === 'ar' ? 'جاهز للعرض — اضغط "جولة العرض"' : 'Ready — press "Demo tour" to begin', 'ok', 4200);
  }, 700);
}

/* The login holds boot() back on http(s) until someone is signed in; on
   file:// there is no server to ask, so it releases immediately and the app
   runs on demo data. Double-clicking index.html behaves exactly as before.

   In live mode the shop's real data is loaded BEFORE the first paint. Drawing
   the seeded catalogue first and swapping it underneath would put invented
   prices on screen for a moment, and a cashier who scanned in that moment
   would be looking at a product the server does not have. */
function start() {
  if (typeof Auth === 'undefined') return boot();

  Auth.guard(function () {
    if (Auth.demoMode() || typeof Shop === 'undefined') return boot();
    /* No fallback to demo data on failure. A till that boots anyway is a till
       that takes real money into memory nobody keeps. */
    Shop.load().then(boot, Shop.fail);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
