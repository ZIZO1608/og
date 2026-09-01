/* ==========================================================================
   OG SYSTEM — application shell  ·  13/17: ROUTING (VIEWS/AFTER/render/go)
   + KANBAN drag-drop
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 5732-6188). Loads after
   app-documents.js — and MUST load after every view/after-hook file above
   it (5-12, plus app-print-labels.js), since VIEWS/AFTER are object
   literals evaluated top-to-bottom that reference those functions by value
   (`products: viewProducts`) — cross-<script> execution does not hoist, so
   those functions must already exist as loaded scripts by the time this
   file runs.
   ========================================================================== */

/* ------------------------------------------------------------- 17. ROUTING */

var VIEWS = {
  /* "Home" is a different screen for different jobs. A chooser rather than a
     fifth branch inside viewDashboard, so each one stays a small readable
     function instead of one screen with four moods.

     roleOf() is null on file://, on the static demo and in _shot.html, so all
     three keep the full manager dashboard — the demo exists to show the whole
     system, and the Arabic proposal is screenshotted from it. */
  dashboard: function () {
    var r = roleOf();
    return r === 'cashier'   ? viewShiftHome()
         : r === 'warehouse' ? viewBackHome()
         : r === 'delivery'  ? viewRunsHome()
         : viewDashboard();
  },
  money: function () { return Money.view(); },
  pos: function () { return POS.render(); },
  products: viewProducts,
  warehouse: viewWarehouse,
  shelfmap:   ShelfMap.view,
  deliveries: function () { return Deliveries.view(); },
  /* A chooser, like `dashboard` above: `#customers` is the list and
     `#customers/81` is one person's page. Both are the same VIEWS entry so
     navAllowed, NAV_PERM and the sidebar's idea of "which screen am I on"
     all keep working unchanged. */
  customers: function () {
    return OG.custId ? viewCustomerProfile(OG.custId) : viewCustomers();
  },
  labels: viewPrintLabels,
  print: viewPrint,
  reports: viewReports,
  settings: viewSettings
};

var AFTER = {
  dashboard: function () {
    var r = roleOf();
    /* The charts only exist on the manager's dashboard. Calling afterDashboard
       on a shift home would hand Chart.js three canvases that are not there. */
    if (r === 'cashier' || r === 'warehouse') return;
    if (r === 'delivery') return Deliveries.after();
    afterDashboard();
  },
  deliveries: function () { return Deliveries.after(); },
  customers: function () { if (OG.custId) afterCustomerProfile(OG.custId); },
  pos: function () { POS.after(); },
  reports: afterReports,
  print: bindKanban,
  warehouse: bindWarehouse,
  shelfmap:   ShelfMap.after,
  settings: afterSettings
};

/* The scanner test box. While Settings is open the wedge reports here instead
   of opening the product sheet — otherwise every test scan would fire the
   sheet over the page you are trying to configure. */
function afterSettings() {
  /* Before the early return below — the roles grid and presence card must
     still load on a machine with no scanner support, which is most of them. */
  loadRoleMatrix();
  loadStaffPresence();

  /* The shelf-assignment list — the same control the map's panel has,
     hitting the same route. Fetched here because the map's data is live
     server state, not part of the hydrated catalogue. */
  var shelvesHost = document.getElementById('setShelves');
  if (shelvesHost && typeof ShelfMap !== 'undefined') ShelfMap.settingsList(shelvesHost);

  var probeBox = document.getElementById('hwProbe');
  var read = document.getElementById('hwRead');
  if (!probeBox || !read || typeof Wedge === 'undefined') return;

  OG.set.captureScans = false;

  function paint(info) {
    if (!info) return;
    var ok = info.accepted;
    read.innerHTML =
      '<div class="hw-line"><span>' + t('hw_last') + '</span><b class="lat">' + esc(info.text) + '</b></div>' +
      '<div class="hw-line"><span>' + t('hw_gap') + '</span><b>' +
        (info.medianGap === null ? '—' : info.medianGap + ' ms') +
        ' · ' + info.length + ' ' + (OG.lang === 'ar' ? 'حرف' : 'chars') + '</b></div>' +
      '<div class="hw-line"><span></span><span class="badge ' + (ok ? 'healthy' : 'critical') + '">' +
        t(ok ? 'hw_accepted' : 'hw_rejected') + (info.viaPrefix ? ' · prefix' : '') + '</span></div>';
    /* A scan that resolves to real stock is the proof that matters — the
       code being readable is only half of it. */
    var hit = resolveScan(info.text);
    if (hit && hit.kind === 'variant') {
      var p = DB.product(hit.variant.productId);
      read.innerHTML += '<div class="hw-line"><span>' + t('product') + '</span><b>' +
        esc(p ? p.name : '') + ' · ' + esc(hit.variant.size) + '</b></div>';
    }
  }

  /* Only capture while the test box has focus, so the rest of Settings still
     behaves like every other screen. */
  probeBox.addEventListener('focus', function () { OG.set.captureScans = true; });
  probeBox.addEventListener('blur',  function () { OG.set.captureScans = false; });

  if (afterSettings._probe) Wedge.offProbe(afterSettings._probe);
  afterSettings._probe = function (info) {
    if (!document.getElementById('hwRead')) return;   /* screen has moved on */
    paint(info);
    var box = document.getElementById('hwProbe');
    if (box) box.value = '';
  };
  Wedge.probe(afterSettings._probe);

  var gap = document.getElementById('hwGap');
  var gapVal = document.getElementById('hwGapVal');
  if (gap) {
    gap.addEventListener('input', function () {
      Wedge.config({ maxGapMs: +gap.value });
      if (gapVal) gapVal.textContent = gap.value;
    });
  }
  var pre = document.getElementById('hwPrefix');
  if (pre) {
    pre.addEventListener('input', function () { Wedge.config({ prefix: pre.value || '' }); });
  }
}

/* Wires the three ways a picture gets in. Re-run on every warehouse render
   because the box is rebuilt each time; the listeners go on the fresh nodes,
   so there is nothing to tear down. */
function bindWarehouse() {
  if (OG.wh.tab !== 'add') return;

  /* Above the image-box guard below, for the same reason loadRoleMatrix()
     sits above the scanner probe's return in afterSettings(): the shelf
     picker must still fill on a machine where the drop box did not find its
     input. The rooms are live server state, not part of the hydrated
     catalogue, so the select paints empty and is filled once they land. */
  fillWhShelves();

  var box = document.getElementById('whDrop');
  var input = document.getElementById('whFile');
  if (!box || !input) return;

  input.addEventListener('change', function () {
    takeProductImage(input.files && input.files[0]);
    /* Cleared so picking the SAME file twice still fires a change event. */
    input.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    box.addEventListener(ev, function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      box.classList.add('drop');
    });
  });
  ['dragleave', 'dragend'].forEach(function (ev) {
    box.addEventListener(ev, function () { box.classList.remove('drop'); });
  });
  box.addEventListener('drop', function (e) {
    e.preventDefault();
    box.classList.remove('drop');
    var dt = e.dataTransfer;
    takeProductImage(dt && dt.files && dt.files[0]);
  });
}

/* Paste, bound once at the document. Scoped tightly: it must never swallow a
   Ctrl+V that was meant for a text field. */
document.addEventListener('paste', function (e) {
  if (OG.print.partner || OG.view !== 'warehouse' || OG.wh.tab !== 'add') return;
  var tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  var items = (e.clipboardData && e.clipboardData.items) || [];
  for (var i = 0; i < items.length; i++) {
    if (String(items[i].type).indexOf('image/') === 0) {
      takeProductImage(items[i].getAsFile());
      e.preventDefault();
      return;
    }
  }
});

/* A wide table cannot work at 320px however it scrolls, so on a phone each
   row restacks into a card and every cell labels itself. Rather than editing
   thirty hand-written tables, the labels are copied from the header row here,
   once per render.

   The class is added at every width — the CSS that acts on it only exists
   inside the phone breakpoint, so desktop is untouched and there is no JS
   breakpoint to drift out of sync with the stylesheet. */
function labelWideTables(root) {
  if (!root) return;
  root.querySelectorAll('table.tbl').forEach(function (tbl) {
    var ths = tbl.querySelectorAll('thead th');
    /* Narrow tables read fine as tables; restacking them wastes vertical
       space and makes them harder to scan, not easier. */
    if (ths.length < 5) return;
    var heads = [].map.call(ths, function (th) { return th.textContent.trim(); });
    tbl.classList.add('tbl-cards');
    tbl.querySelectorAll('tbody tr').forEach(function (tr) {
      [].forEach.call(tr.children, function (td, i) {
        if (heads[i] && !td.getAttribute('data-l')) td.setAttribute('data-l', heads[i]);
      });
    });
  });
}

function render() {
  Charts.destroyAll();
  var host = document.getElementById('view');

  /* The last gate. Whatever set OG.print.partner false — a stale hash, a
     console poke, a toggle that should not exist for them — a partner account
     renders the portal. Checked at the point of drawing rather than at the
     point of navigating, because there is only one of the former. */
  if (isPartnerAccount()) OG.print.partner = true;

  var partner = OG.print.partner;

  /* Claimed exactly once per view change. Every other repaint — a keystroke
     in the search box, a filter chip, a sort click — renders silently, so
     the entrance animation and the counting numbers do not replay while the
     user is typing. This is the difference between polish and a twitch. */
  var entering = (typeof Motion !== 'undefined') && Motion.claim();

  document.body.setAttribute('data-view', partner ? 'yalla' : OG.view);
  if (partner) document.body.setAttribute('data-portal', 'yalla');
  else document.body.removeAttribute('data-portal');

  host.className = 'view' + (entering ? '' : ' fade-in') +
                   (!partner && OG.view === 'pos' ? ' pos-view' : '');
  host.innerHTML = partner ? YALLA.view() : (VIEWS[OG.view] || viewDashboard)();
  host.scrollTop = 0;

  if (partner) { try { YALLA.after(); } catch (e) { console.warn('yalla after', e); } }
  else if (AFTER[OG.view]) { try { AFTER[OG.view](); } catch (e) { console.warn('after hook', e); } }

  try { Bulk.paint(); } catch (e) { console.warn('bulk paint', e); }

  try { labelWideTables(host); } catch (e) { console.warn('table labels', e); }

  if (entering) {
    try {
      Motion.enter(host, OG.dir);
      Motion.countAll(host);
      Motion.navIndicator();
    } catch (e) { console.warn('motion', e); }
  }
  OG.dir = null;

  if (OG.pending) { var p = OG.pending; OG.pending = null; try { p(); } catch (e) {} }
}

/* ---- the second routing layer -------------------------------------------
   Until Stage C the hash WAS a view id, full stop, and the only thing with a
   slash in it was `#open/<type>/<id>` — which is not a route but a one-shot
   instruction, consumed by handleDeepLink and then replaced.

   `#customers/81` is a real place: it survives a refresh, it can be
   bookmarked, and Back leaves it. One optional parameter is enough for every
   screen that needs one, so this stays a split on the first slash rather than
   a pattern matcher. Every hash WITHOUT a slash parses to exactly what it
   parsed to before — `{ view: 'settings', param: null }`.

   Order matters at both call sites: handleDeepLink runs FIRST, or `#open/…`
   would parse here as the view `open`. */
function parseHash(raw) {
  var s = String(raw || '').replace(/^#/, '');
  if (!s) return { view: '', param: null };
  var i = s.indexOf('/');
  if (i < 0) return { view: s, param: null };
  var p = s.slice(i + 1);
  try { p = decodeURIComponent(p); } catch (e) { /* keep the raw text */ }
  return { view: s.slice(0, i), param: p };
}

function hashFor(view, param) {
  return '#' + view + (param == null || param === '' ? '' : '/' + encodeURIComponent(param));
}

function go(view, pending, param) {
  if (!VIEWS[view]) view = 'dashboard';

  /* Hiding a menu item does not stop something else asking for that screen —
     a bookmarked #settings, a stale URL hash, a deep link out of a toast. A
     cashier would land on a page they should not see, half-rendered from data
     the server is refusing. Bounce to somewhere they are allowed instead. */
  if (!navAllowed(view)) {
    var first = allowedNav()[0];
    view = first ? first.id : 'dashboard';
    param = null;                 /* a bounced screen keeps nobody's record open */
  }
  /* Work out the travel direction before OG.view moves on. */
  if (typeof Motion !== 'undefined') {
    OG.dir = Motion.direction(OG.view, view);
    Motion.mark();
  }
  OG.view = view;
  applyRouteParam(view, param == null ? null : String(param));
  OG.pending = pending || null;
  /* location.hash, not history.pushState — pushState throws on file:// origins. */
  var want = hashFor(view, OG.viewParam);
  if (window.location.hash !== want) window.location.hash = want;
  closeDrawer();
  renderSidebar();
  render();
}

/* Where a route parameter is KEPT. One place, so a screen that grows a
   parameter later does not each invent its own field on OG.

   Held on OG rather than read from location.hash at render time because the
   hash is a string the user can edit; this is the parsed, validated version
   the screens actually draw from. */
function applyRouteParam(view, param) {
  OG.viewParam = param;
  OG.custId = (view === 'customers' && param) ? Number(param) : null;
}

function applyLang() {
  var ar = OG.lang === 'ar';
  document.documentElement.lang = ar ? 'ar' : 'en';
  document.documentElement.dir = ar ? 'rtl' : 'ltr';
  document.body.classList.toggle('rtl', ar);
}

function refreshAll() {
  /* Language and currency switches redraw the whole shell, so they get the
     entrance too — otherwise flipping to Arabic looks like a hard cut. */
  if (typeof Motion !== 'undefined') Motion.mark();
  renderSidebar();
  renderTopbar();
  render();
}

/* --------------------------------------------------------------- 18. KANBAN */

function bindKanban() {
  if (OG.print.partner) return;
  var dragId = null;

  document.querySelectorAll('.kcard').forEach(function (card) {
    card.addEventListener('dragstart', function (e) {
      dragId = card.getAttribute('data-id');
      card.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
    });
    card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
  });

  document.querySelectorAll('.kcol').forEach(function (col) {
    col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', function () { col.classList.remove('over'); });
    col.addEventListener('drop', function (e) {
      e.preventDefault();
      col.classList.remove('over');
      var id = dragId;
      try { id = e.dataTransfer.getData('text/plain') || dragId; } catch (err) {}
      var stage = col.getAttribute('data-stage');
      var job = DB.printJobs.filter(function (j) { return j.id === id; })[0];
      if (!job) return;

      /* A refused drop used to just snap back and say nothing, which reads as
         a broken board rather than a rule. Both rules that can refuse it are
         worth stating out loud. */
      if (stage === 'sent' && DB.orderState(job) !== 'accepted') {
        toast(job.id, t('or_blocked_stage'), 'warn', 5000,
              DB.orderState(job) === 'draft'
                ? { label: t('or_send'), attrs: 'data-act="or-send" data-id="' + job.id + '"' }
                : null);
        return;
      }
      if (DB.blockedBy(job, stage) === 'tbc') {
        toast(job.id, t('or_why_tbc'), 'warn', 5000);
        return;
      }

      /* setStage stamps the history so the tracker stays truthful. `og` tells
         Yalla Wear it moved. */
      if (!DB.setStage(job, stage, 'og')) return;
      toast(job.id + ' → ' + t('print_' + stage), job.customer + ' · ' + job.qty + ' pcs', 'ok');
      Notify.refresh();
      renderSidebar();
      render();
    });
  });
}

/* Stage labels are looked up as print_<stage> so they translate cleanly. */
['design', 'sent', 'printing', 'delivery', 'done'].forEach(function (s, i) {
  I18N.en['print_' + s] = ['Design', 'Sent to print', 'Printing', 'Delivery', 'Done'][i];
  I18N.ar['print_' + s] = ['تصميم', 'أُرسل للطباعة', 'قيد الطباعة', 'التوصيل', 'منجز'][i];
});
I18N.en.if_sold_all = 'if everything sells';
I18N.ar.if_sold_all = 'لو بيع كل شيء';
I18N.en.invoices = 'Invoices';
I18N.ar.invoices = 'الفواتير';

/* ---- Yalla Wear portal, tracker and Label Studio strings ---------------- */
