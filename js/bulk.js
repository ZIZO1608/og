/* ==========================================================================
   OG SYSTEM — bulk selection and actions
   --------------------------------------------------------------------------
   Turns the filters into a tool: filter to Size gaps -> select all -> print
   labels. One selection engine, six scopes, a floating action bar.

   Destructive work is two-step: archive is the everyday action (recoverable
   from a filter chip, and sales history keeps resolving because the record is
   never removed), delete is behind it for real mistakes. Both push an undo
   snapshot and raise a toast with an Undo button for 8 seconds — that is the
   safety net if he wipes the catalogue in front of the client.
   ========================================================================== */

var Bulk = (function () {

  var SEL = { products: {}, customers: {}, jobs: {}, orders: {}, movements: {}, variants: {} };
  var lastIdx = {};
  var undoEntry = null;
  var undoTimer = null;

  var VIEW_SCOPE = {
    products: 'products', customers: 'customers', print: 'jobs',
    storefront: 'orders', warehouse: 'movements', labels: 'variants'
  };

  function scope() {
    if (OG.print.partner) return null;
    if (OG.view === 'warehouse' && OG.wh.tab !== 'moves') return null;
    return VIEW_SCOPE[OG.view] || null;
  }

  /* ------------------------------------------------------------ selection */

  function ids(sc) { return Object.keys(SEL[sc] || {}); }
  function count(sc) { return ids(sc).length; }
  function has(sc, id) { return !!(SEL[sc] && SEL[sc][id]); }
  function clear(sc) { SEL[sc] = {}; lastIdx[sc] = null; }
  function clearAll() { Object.keys(SEL).forEach(clear); }

  function setMany(sc, list, on) {
    list.forEach(function (id) {
      if (on) SEL[sc][id] = true; else delete SEL[sc][id];
    });
  }

  /* The ids the current filter matches — select-all must respect filters,
     not silently grab the whole table. */
  function visibleIds(sc) {
    switch (sc) {
      case 'products':  return productRows().map(function (r) { return String(r.p.id); });
      case 'customers': return customerRows().map(function (c) { return String(c.id); });
      case 'jobs':      return DB.printJobs.map(function (j) { return j.id; });
      case 'orders':    return DB.storeOrders.map(function (o) { return o.id; });
      case 'movements': return DB.stockMovements.slice(0, 90).map(function (m) { return m.id; });
      case 'variants':  return labelVariantRows().map(function (r) { return r.v.sku; });
      default:          return [];
    }
  }

  /* ------------------------------------------------------------- markup */

  function box(sc, id, idx) {
    return '<label class="bk-box" title="' + esc(t('bk_select')) + '">' +
      '<input type="checkbox" data-bk="tog" data-sc="' + sc + '" data-id="' + esc(id) + '"' +
      (idx === undefined ? '' : ' data-idx="' + idx + '"') +
      (has(sc, id) ? ' checked' : '') + '></label>';
  }

  function headBox(sc) {
    var vis = visibleIds(sc);
    var sel = vis.filter(function (i) { return has(sc, i); }).length;
    return '<label class="bk-box" title="' + esc(t('bk_select_all')) + '">' +
      '<input type="checkbox" id="bkHead" data-bk="all" data-sc="' + sc + '"' +
      (sel && sel === vis.length ? ' checked' : '') + '></label>';
  }

  /* ------------------------------------------------------------- actions */

  function selProducts() {
    return ids('products').map(function (i) { return DB.product(+i); }).filter(Boolean);
  }
  function selCustomers() {
    return ids('customers').map(function (i) { return DB.customer(+i); }).filter(Boolean);
  }
  function selJobs() {
    var set = SEL.jobs;
    return DB.printJobs.filter(function (j) { return set[j.id]; });
  }

  var ACTIONS_FOR = {
    products: [
      { id: 'labels', key: 'lb_studio', primary: true },
      { id: 'show',   key: 'bk_show' },
      { id: 'hide',   key: 'bk_hide' },
      { id: 'price',  key: 'bk_price' },
      { id: 'export', key: 'export_excel' },
      { id: 'archive', key: 'bk_archive' },
      { id: 'delete', key: 'bk_delete', danger: true }
    ],
    customers: [
      { id: 'message', key: 'bk_message', primary: true },
      { id: 'points',  key: 'bk_points' },
      { id: 'export',  key: 'export_excel' },
      { id: 'archive', key: 'bk_archive' },
      { id: 'delete',  key: 'bk_delete', danger: true }
    ],
    jobs: [
      { id: 'advance', key: 'bk_advance', primary: true },
      { id: 'done',    key: 'bk_done' },
      { id: 'export',  key: 'export_excel' }
    ],
    orders: [
      { id: 'confirm', key: 'confirm', primary: true },
      { id: 'export',  key: 'export_excel' }
    ],
    movements: [
      { id: 'export', key: 'export_excel', primary: true }
    ],
    variants: [
      { id: 'print', key: 'print_labels', primary: true }
    ]
  };

  function bar() {
    var sc = scope();
    if (!sc) return '';
    var n = count(sc);
    if (!n) return '';

    var acts = ACTIONS_FOR[sc] || [];
    var h = '<div class="bk-bar"><span class="bk-count"><b>' + n + '</b> ' + t('bk_selected') + '</span>';
    acts.forEach(function (a) {
      h += '<button class="btn btn-sm ' + (a.primary ? 'btn-primary' : (a.danger ? 'bk-danger' : 'btn-ghost')) +
           '" data-bk="run" data-sc="' + sc + '" data-a="' + a.id + '">' + t(a.key) + '</button>';
    });
    h += '<button class="bk-x" data-bk="clear" data-sc="' + sc + '" title="' + esc(t('bk_clear')) + '">&times;</button></div>';
    return h;
  }

  function paint() {
    var root = document.getElementById('bulk-root');
    if (!root) return;
    root.innerHTML = bar();

    /* indeterminate cannot be expressed in markup */
    var sc = scope();
    var head = document.getElementById('bkHead');
    if (head && sc) {
      var vis = visibleIds(sc);
      var sel = vis.filter(function (i) { return has(sc, i); }).length;
      head.indeterminate = sel > 0 && sel < vis.length;
    }
  }

  /* --------------------------------------------------------------- undo */

  function stageUndo(label, restore) {
    undoEntry = restore;
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(function () { undoEntry = null; }, 8000);
    toast(label, t('bk_undo_hint'), 'warn', 8000,
          { label: t('bk_undo'), attrs: 'data-bk="undo"' });
  }

  function runUndo() {
    if (!undoEntry) return;
    var fn = undoEntry;
    undoEntry = null;
    if (undoTimer) clearTimeout(undoTimer);
    fn();
    toast(t('bk_restored'), '', 'ok', 2600);
    refreshAll();
    paint();
  }

  /* ------------------------------------------------------------- runners */

  function exportSelection(sc) {
    var spec = currentExportSpec();
    if (!spec) return;
    var keep = {};
    ids(sc).forEach(function (i) { keep[i] = true; });

    /* Match rows back to the selection by their first column, which is the
       id for every scope except products and customers (name first). */
    var idCol = { jobs: 0, orders: 0, movements: null, products: null, customers: null }[sc];
    if (sc === 'products') {
      var names = {};
      selProducts().forEach(function (p) { names[p.name] = true; });
      spec.rows = spec.rows.filter(function (r) { return names[r[0]]; });
    } else if (sc === 'customers') {
      var cn = {};
      selCustomers().forEach(function (c) { cn[c.name] = true; });
      spec.rows = spec.rows.filter(function (r) { return cn[r[0]]; });
    } else if (idCol !== null && idCol !== undefined) {
      spec.rows = spec.rows.filter(function (r) { return keep[r[idCol]]; });
    }
    spec.totals = null;
    spec.subtitle = count(sc) + ' ' + t('bk_selected');
    spec.kind = 'xlsx';
    Export.run(spec);
  }

  function priceModal() {
    var list = selProducts();
    openModal({
      title: t('bk_price') + ' · ' + list.length,
      size: 'narrow',
      body: '<label class="field"><span>' + t('bk_price_pct') + '</span>' +
              '<input class="inp num" id="bkPct" type="number" value="10" step="1"></label>' +
            '<div class="partner-note">' + t('bk_price_hint') + '</div>' +
            '<div class="mt small muted">' + list.slice(0, 3).map(function (p) {
              return esc(p.name) + ' · ' + money(p.sellingPrice);
            }).join('<br>') + (list.length > 3 ? '<br>…' : '') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-bk="price-apply">' + t('apply') + '</button>'
    });
  }

  function messageModal() {
    var list = selCustomers();
    var body = '<div class="partner-note mb">' + t('bk_message_hint') + '</div>' +
      '<div class="field"><span class="lbl">' + t('whatsapp_msg') + '</span>' +
      '<textarea class="inp" id="bkMsg" dir="rtl" rows="5">' +
      esc('مرحباً! وصلتنا موديلات جديدة في OG — تعال شوفها قبل ما تخلص المقاسات. 🖤') +
      '</textarea></div><div class="table-wrap" style="max-height:220px;overflow-y:auto">' +
      '<table class="tbl tbl-compact"><tbody>';
    list.forEach(function (c) {
      body += '<tr><td>' + esc(c.name) + '</td><td class="muted num">' + tel(c.phone) + '</td>' +
        '<td class="num"><a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="' +
        waLink(c.phone, 'مرحباً ' + c.name.split(' ')[0] + '، وصلتنا موديلات جديدة في OG!') +
        '">' + t('send') + '</a></td></tr>';
    });
    body += '</tbody></table></div>';

    openModal({
      title: t('bk_message') + ' · ' + list.length,
      size: 'wide', body: body,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
            '<button class="btn btn-primary" data-bk="msg-log">' + t('bk_log_all') + '</button>'
    });
  }

  /* wa.me works from file:// and genuinely opens WhatsApp with the text ready */
  function waLink(phone, text) {
    return 'https://wa.me/' + String(phone).replace(/\D/g, '') + '?text=' + encodeURIComponent(text);
  }

  function run(sc, a) {
    var n = count(sc);
    if (!n) return;

    /* ---- products ---- */
    if (sc === 'products') {
      var list = selProducts();
      /* Every size of every selected product, one line each at qty 1 — same
         shape and the same Labels.openPreviewModal call the 'variants' scope
         below and the quick per-product picker (js/app-print-labels.js) both
         use, so bulk-selecting from the Products table lands on the real
         preview/print pipeline (station, presets incl. 60x40, live barcode
         preview) instead of the older browser-print Label Studio. Quantities
         are editable per line right there in that preview, same as anywhere
         else labels are queued. */
      if (a === 'labels') {
        var labelLines = [];
        list.forEach(function (p) {
          DB.variantsOf(p.id).forEach(function (v) { labelLines.push({ sku: v.sku, qty: 1 }); });
        });
        if (typeof Labels !== 'undefined') {
          Labels.openPreviewModal(labelLines, Labels.lastChoice().preset, Labels.lastChoice().station);
        }
        return;
      }
      if (a === 'show' || a === 'hide') {
        var before = list.map(function (p) { return p.hidden; });
        list.forEach(function (p) { p.hidden = (a === 'hide'); });
        stageUndo(n + ' ' + t(a === 'hide' ? 'bk_hidden' : 'bk_shown'), function () {
          list.forEach(function (p, i) { p.hidden = before[i]; });
        });
        refreshAll(); paint(); return;
      }
      if (a === 'price')  { priceModal(); return; }
      if (a === 'export') { exportSelection(sc); return; }
      if (a === 'archive') {
        list.forEach(function (p) { p.archived = true; });
        clear(sc);
        stageUndo(n + ' ' + t('bk_archived'), function () {
          list.forEach(function (p) { p.archived = false; });
        });
        refreshAll(); paint(); return;
      }
      if (a === 'delete') { confirmDelete(sc, list); return; }
    }

    /* ---- customers ---- */
    if (sc === 'customers') {
      var cl = selCustomers();
      if (a === 'message') { messageModal(); return; }
      if (a === 'points') {
        cl.forEach(function (c) { c.loyaltyPoints += 250; });
        stageUndo(n + ' · +250 ' + t('points'), function () {
          cl.forEach(function (c) { c.loyaltyPoints -= 250; });
        });
        refreshAll(); paint(); return;
      }
      if (a === 'export') { exportSelection(sc); return; }
      if (a === 'archive') {
        cl.forEach(function (c) { c.archived = true; });
        clear(sc);
        stageUndo(n + ' ' + t('bk_archived'), function () {
          cl.forEach(function (c) { c.archived = false; });
        });
        refreshAll(); paint(); return;
      }
      if (a === 'delete') { confirmDelete(sc, cl); return; }
    }

    /* ---- print jobs ---- */
    if (sc === 'jobs') {
      var jl = selJobs();
      if (a === 'export') { exportSelection(sc); return; }
      var prev = jl.map(function (j) {
        return {
          j: j, stage: j.stage, hist: j.history.slice(),
          order: JSON.parse(JSON.stringify(DB.order(j) || {}))
        };
      });
      var sent = 0;
      jl.forEach(function (j) {
        /* An unsent job cannot be "advanced" — the next thing that happens to
           it is not a stage change, it is being offered to Yalla Wear. Moving
           it silently to Sent was the old behaviour and it was a lie: the
           printer had never seen the job. */
        if (a !== 'done' && DB.canSendOrder(j) === null) {
          if (DB.sendOrder(j)) sent++;
          return;
        }
        var i = DB.printStages.indexOf(j.stage);
        var to = (a === 'done') ? 'done' : DB.printStages[Math.min(i + 1, DB.printStages.length - 1)];
        DB.setStage(j, to, 'og');
      });
      stageUndo(n + ' ' + t(sent === n ? 'bk_sent' : 'bk_moved'), function () {
        prev.forEach(function (p) {
          p.j.stage = p.stage;
          p.j.history = p.hist;
          if (p.j.order) p.j.order = p.order;
        });
      });
      clear(sc); refreshAll(); paint(); return;
    }

    /* ---- orders ---- */
    if (sc === 'orders') {
      if (a === 'export') { exportSelection(sc); return; }
      var ol = DB.storeOrders.filter(function (o) { return SEL.orders[o.id]; });
      var st = ol.map(function (o) { return o.status; });
      ol.forEach(function (o) { o.status = 'confirmed'; });
      stageUndo(n + ' ' + t('confirmed').toLowerCase(), function () {
        ol.forEach(function (o, i) { o.status = st[i]; });
      });
      clear(sc); refreshAll(); paint(); return;
    }

    if (sc === 'movements' && a === 'export') { exportSelection(sc); return; }

    /* ---- label printing (one line per selected variant, real hardware
       preview/print — the same Labels module the product drawer's own
       per-size "Print labels" button drives, so nothing here is a second
       implementation of preview/print/station/preset behaviour) ---- */
    if (sc === 'variants' && a === 'print') {
      var lines = ids('variants').map(function (sku) { return { sku: sku, qty: 1 }; });
      if (typeof Labels !== 'undefined') {
        Labels.openPreviewModal(lines, Labels.lastChoice().preset, Labels.lastChoice().station);
      }
      return;
    }
  }

  /* Delete names the damage before it happens. */
  function confirmDelete(sc, list) {
    var extra = '';
    if (sc === 'products') {
      var pcs = list.reduce(function (a2, p) { return a2 + DB.totalQty(p.id); }, 0);
      var skus = list.reduce(function (a2, p) { return a2 + DB.variantsOf(p.id).length; }, 0);
      extra = nf(pcs) + ' ' + t('pieces') + ' · ' + skus + ' SKU';
    } else {
      extra = list.reduce(function (a2, c) { return a2 + c.history.length; }, 0) + ' ' + t('invoices').toLowerCase();
    }

    openModal({
      title: t('bk_delete_title'), size: 'narrow',
      body: '<div class="alert-row alert-danger" style="margin-bottom:14px">' +
              '<span class="alert-ico red">!</span>' +
              '<span class="alert-txt"><b>' + t('bk_delete_q').replace('{n}', list.length) + '</b>' +
              '<small>' + extra + '</small></span></div>' +
            '<div class="partner-note">' + t('bk_delete_note') + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn bk-danger" data-bk="delete-go" data-sc="' + sc + '">' +
              t('bk_delete') + ' ' + list.length + '</button>'
    });
  }

  function doDelete(sc) {
    var arr = sc === 'products' ? DB.products : DB.customers;
    var list = sc === 'products' ? selProducts() : selCustomers();
    /* remember index so Undo puts each record back where it was */
    var snap = list.map(function (o) { return { o: o, i: arr.indexOf(o) }; })
                   .sort(function (a, b) { return a.i - b.i; });

    snap.slice().reverse().forEach(function (s) { if (s.i > -1) arr.splice(s.i, 1); });
    clear(sc);
    closeModal();

    stageUndo(snap.length + ' ' + t('bk_deleted'), function () {
      snap.forEach(function (s) { arr.splice(Math.min(s.i, arr.length), 0, s.o); });
    });
    refreshAll();
    paint();
  }

  /* ---------------------------------------------------------------- events */

  var ACT = {
    tog: function (el, e) {
      var sc = el.getAttribute('data-sc'), id = el.getAttribute('data-id');
      var idx = el.getAttribute('data-idx');
      idx = idx === null ? null : +idx;

      /* shift-click selects the whole range since the last click */
      if (e.shiftKey && idx !== null && lastIdx[sc] !== null && lastIdx[sc] !== undefined) {
        var vis = visibleIds(sc);
        var a = Math.min(lastIdx[sc], idx), b = Math.max(lastIdx[sc], idx);
        setMany(sc, vis.slice(a, b + 1), true);
      } else {
        if (has(sc, id)) delete SEL[sc][id]; else SEL[sc][id] = true;
      }
      if (idx !== null) lastIdx[sc] = idx;
      render();
      paint();
    },

    all: function (el) {
      var sc = el.getAttribute('data-sc'), vis = visibleIds(sc);
      var allOn = vis.length && vis.every(function (i) { return has(sc, i); });
      setMany(sc, vis, !allOn);
      lastIdx[sc] = null;
      render();
      paint();
    },

    clear: function (el) { clear(el.getAttribute('data-sc')); render(); paint(); },
    run: function (el) { run(el.getAttribute('data-sc'), el.getAttribute('data-a')); },
    undo: runUndo,
    'delete-go': function (el) { doDelete(el.getAttribute('data-sc')); },

    'price-apply': function () {
      var pctEl = document.getElementById('bkPct');
      var p = Number(pctEl && pctEl.value) || 0;
      var list = selProducts();
      var before = list.map(function (x) { return x.sellingPrice; });
      list.forEach(function (x) {
        x.sellingPrice = Math.max(1000, Math.round(x.sellingPrice * (1 + p / 100) / 1000) * 1000);
      });
      closeModal();
      stageUndo(list.length + ' · ' + (p > 0 ? '+' : '') + p + '%', function () {
        list.forEach(function (x, i) { x.sellingPrice = before[i]; });
      });
      refreshAll(); paint();
    },

    'msg-log': function () {
      var n = count('customers');
      closeModal();
      toast(t('bk_message'), n + ' · ' + t('bk_logged'), 'ok');
    }
  };

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-bk]') : null;
      if (!el) return;
      var fn = ACT[el.getAttribute('data-bk')];
      if (fn) { e.stopPropagation(); fn(el, e); }
    });

    document.addEventListener('keydown', function (e) {
      var sc = scope();
      if (!sc) return;
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setMany(sc, visibleIds(sc), true);
        render(); paint();
      }
    });
  }
  bind();

  return {
    scope: scope, box: box, headBox: headBox, paint: paint,
    count: count, has: has, ids: ids, clear: clear, clearAll: clearAll,
    visibleIds: visibleIds, run: run, undo: runUndo, waLink: waLink,
    _sel: SEL
  };
})();
