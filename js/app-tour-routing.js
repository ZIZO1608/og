/* ==========================================================================
   OG SYSTEM — application shell  ·  13/17: TOUR + ROUTING (VIEWS/AFTER/
   render/go) + KANBAN drag-drop
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 5732-6188). Loads after
   app-documents.js — and MUST load after every view/after-hook file above
   it (5-12, plus app-print-labels.js), since VIEWS/AFTER are object
   literals evaluated top-to-bottom that reference those functions by value
   (`products: viewProducts`) — cross-<script> execution does not hoist, so
   those functions must already exist as loaded scripts by the time this
   file runs.
   ========================================================================== */

/* ----------------------------------------------------------------- 16. TOUR */

var Tour = {
  i: 0,
  on: false,
  steps: [
    { view: 'dashboard', sel: '#dashStats', titleEn: 'Everything about the business on one screen',
      txtEn: 'Today, this month, what is running out, who stopped buying. No notebook, no counting at midnight.',
      titleAr: 'كل شيء عن العمل في شاشة واحدة',
      txtAr: 'اليوم، الشهر، ما الذي ينفد، ومن توقف عن الشراء. بلا دفتر وبلا عدّ في آخر الليل.' },

    { view: 'pos', sel: '.pos-scanbar', titleEn: 'A sale takes 8 seconds, not a notebook page',
      txtEn: 'Scan the barcode — the product and the exact size land in the cart in one move.',
      titleAr: 'البيع يستغرق ٨ ثوانٍ لا صفحة دفتر',
      txtAr: 'امسح الباركود — المنتج والقياس المضبوط يدخلان السلة بحركة واحدة.',
      enter: function () {
        POS.reset(true);
        POS.scanBarcode(CONFIG.DEMO_BARCODE, true);
        /* A second line makes the invoice in step 3 look like a real basket. */
        var tee = DB.variantsOf(11).filter(function (v) { return v.qty > 0; })[0];
        POS.add(tee, true);
        POS.state.customerId = 1;
      } },

    { view: 'pos', sel: '.invoice-sheet', titleEn: 'The invoice prints itself',
      txtEn: 'Branded, itemised, with the loyalty points already calculated. One button and it is on paper.',
      titleAr: 'الفاتورة تطبع نفسها',
      txtAr: 'بهوية المحل ومفصّلة ونقاط الولاء محسوبة سلفاً. زر واحد وتصبح على الورق.',
      enter: function () { POS.complete(true); }, wait: 380 },

    { view: 'products', sel: '.card.table-wrap', titleEn: 'Watch the stock drop instantly',
      txtEn: 'The exact size you just sold is gone from the warehouse. Everything is connected — nothing is typed twice.',
      titleAr: 'شاهد المخزون ينقص فوراً',
      txtAr: 'القياس الذي بعته للتو نقص من المستودع. كل شيء متصل — لا شيء يُكتب مرتين.',
      enter: function () { closeModal(); OG.prod.q = 'Air Force'; } },

    { view: 'warehouse', sel: '#mvTable', titleEn: 'Every movement is recorded, forever',
      txtEn: 'Received, sold, damaged, returned — with the user, the date and the balance after it. Nothing disappears quietly.',
      titleAr: 'كل حركة مسجّلة إلى الأبد',
      txtAr: 'وارد، مبيع، تالف، مرتجع — مع المستخدم والتاريخ والرصيد. لا شيء يختفي بصمت.',
      enter: function () { OG.wh.tab = 'moves'; } },

    { view: 'print', sel: '.kanban', titleEn: 'Yalla Wear gets the job automatically',
      txtEn: 'Tick "Add print" during a sale and the job appears here in Design. Drag it as it moves. The partner sees only what they need.',
      titleAr: 'يلا وير تستلم الطلب تلقائياً',
      txtAr: 'فعّل "أضف طلب طباعة" أثناء البيع فيظهر الطلب هنا في التصميم. اسحبه مع تقدّمه. والشريك لا يرى إلا ما يخصّه.' },

    { view: 'reports', sel: '#repChart', titleEn: 'Know your real profit for the first time',
      txtEn: 'Revenue minus cost, per category, plus the capital sitting frozen on your shelves.',
      titleAr: 'اعرف ربحك الحقيقي لأول مرة',
      txtAr: 'الإيراد ناقص التكلفة لكل فئة، مع رأس المال المجمّد على رفوفك.',
      enter: function () { OG.rep.tab = 'profit'; } }
  ],

  start: function () {
    Tour.on = true; Tour.i = 0;
    document.body.classList.add('tour-on');
    Tour.show();
  },

  stop: function () {
    Tour.on = false;
    document.body.classList.remove('tour-on');
    document.getElementById('tour-root').innerHTML = '';
    OG.prod.q = '';
    closeModal();
  },

  go: function (n) {
    if (n < 0) return;
    if (n >= Tour.steps.length) { Tour.stop(); toast(t('tour_start'), OG.lang === 'ar' ? 'انتهت الجولة' : 'Tour complete', 'ok'); return; }
    Tour.i = n; Tour.show();
  },

  show: function () {
    var s = Tour.steps[Tour.i];
    if (OG.view !== s.view) { OG.view = s.view; renderSidebar(); }
    if (s.enter) { try { s.enter(); } catch (e) {} }
    render();
    setTimeout(function () { Tour.paint(); }, s.wait || 120);
  },

  paint: function () {
    var s = Tour.steps[Tour.i];
    var el = document.querySelector(s.sel) || document.querySelector('.view') || document.body;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}

    setTimeout(function () {
      var r = el.getBoundingClientRect();
      var pad = 6;
      var top = Math.max(6, r.top - pad), left = Math.max(6, r.left - pad);
      var w = Math.min(r.width + pad * 2, window.innerWidth - left - 6);
      var h = Math.min(r.height + pad * 2, window.innerHeight - top - 6);

      var popW = Math.min(306, window.innerWidth - 32);
      var popTop = top + h + 14;
      if (popTop + 210 > window.innerHeight) popTop = Math.max(12, top - 224);
      var popLeft = Math.min(Math.max(12, left), window.innerWidth - popW - 12);

      var title = OG.lang === 'ar' ? s.titleAr : s.titleEn;
      var txt = OG.lang === 'ar' ? s.txtAr : s.txtEn;

      var dots = '';
      Tour.steps.forEach(function (_, i) { dots += '<i class="' + (i <= Tour.i ? 'on' : '') + '"></i>'; });

      document.getElementById('tour-root').innerHTML =
        '<div class="spot" style="top:' + top + 'px;left:' + left + 'px;width:' + w + 'px;height:' + h + 'px"></div>' +
        '<div class="tour-pop" style="top:' + popTop + 'px;left:' + popLeft + 'px;width:' + popW + 'px">' +
          '<div class="tour-progress">' + dots + '</div>' +
          '<div class="step">' + t('step') + ' ' + (Tour.i + 1) + ' ' + t('of') + ' ' + Tour.steps.length + '</div>' +
          '<h4>' + title + '</h4><p>' + txt + '</p>' +
          '<div class="tp-foot">' +
            '<button class="btn btn-sm btn-ghost" data-act="tour-back"' +
              (Tour.i === 0 ? ' disabled' : '') + '>' + t('back_btn') + '</button>' +
            '<button class="btn btn-sm btn-primary" data-act="tour-next">' +
              (Tour.i === Tour.steps.length - 1 ? t('close') : t('next')) + '</button>' +
            '<button class="skip" data-act="tour-skip">' + t('skip') + '</button>' +
          '</div>' +
        '</div>';
    }, 260);
  }
};

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
  deliveries: function () { return Deliveries.view(); },
  customers: viewCustomers,
  labels: viewPrintLabels,
  print: viewPrint,
  reports: viewReports,
  storefront: viewStorefront,
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
  pos: function () { POS.after(); },
  reports: afterReports,
  print: bindKanban,
  warehouse: bindWarehouse,
  settings: afterSettings
};

/* The scanner test box. While Settings is open the wedge reports here instead
   of opening the product sheet — otherwise every test scan would fire the
   sheet over the page you are trying to configure. */
function afterSettings() {
  /* Before the early return below — the roles grid must still load on a
     machine with no scanner support, which is most of them. */
  loadRoleMatrix();

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

function go(view, pending) {
  if (!VIEWS[view]) view = 'dashboard';

  /* Hiding a menu item does not stop something else asking for that screen —
     a bookmarked #settings, a stale URL hash, a deep link out of a toast. A
     cashier would land on a page they should not see, half-rendered from data
     the server is refusing. Bounce to somewhere they are allowed instead. */
  if (!navAllowed(view)) {
    var first = allowedNav()[0];
    view = first ? first.id : 'dashboard';
  }
  /* Work out the travel direction before OG.view moves on. */
  if (typeof Motion !== 'undefined') {
    OG.dir = Motion.direction(OG.view, view);
    Motion.mark();
  }
  OG.view = view;
  OG.pending = pending || null;
  /* location.hash, not history.pushState — pushState throws on file:// origins. */
  if (window.location.hash !== '#' + view) window.location.hash = view;
  closeDrawer();
  renderSidebar();
  render();
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
