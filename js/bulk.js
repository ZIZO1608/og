/* ==========================================================================
   OG SYSTEM — bulk selection and actions
   --------------------------------------------------------------------------
   Turns the filters into a tool: filter to Size gaps -> select all -> print
   labels. One selection engine, six scopes, a floating action bar.

   Archive is the destructive action, and the only one: the record stays, so
   every past sale keeps resolving, and a filter chip brings it back. There is
   no delete — see ACTIONS_FOR below for why.

   Every action pushes to the server row by row, and so does its undo. An undo
   that only reverses the screen while the server keeps the change is worse
   than no undo at all, because it tells you the mistake is fixed.
   ========================================================================== */

var Bulk = (function () {

  var SEL = { products: {}, customers: {}, jobs: {}, movements: {}, variants: {} };
  var lastIdx = {};
  var undoEntry = null;
  var undoTimer = null;

  var VIEW_SCOPE = {
    products: 'products', customers: 'customers', print: 'jobs',
    warehouse: 'movements', labels: 'variants'
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

  /* There is no Delete.

     There used to be, and it did nothing: it spliced the rows out of the
     local arrays, showed an undo bar, and the next reload brought every one
     of them back. There is no delete route to wire it to either, and that is
     deliberate — a deleted product breaks every past sale that references it,
     which is why server/lib/catalogue.js hides instead. Archive is the same
     gesture, it is what the shop actually means, and it persists. */
  var ACTIONS_FOR = {
    products: [
      { id: 'labels', key: 'lb_studio', primary: true },
      { id: 'show',   key: 'bk_show' },
      { id: 'hide',   key: 'bk_hide' },
      { id: 'price',  key: 'bk_price' },
      { id: 'export', key: 'export_excel' },
      { id: 'archive', key: 'bk_archive' }
    ],
    customers: [
      { id: 'message', key: 'bk_message', primary: true },
      { id: 'points',  key: 'bk_points' },
      { id: 'export',  key: 'export_excel' },
      { id: 'archive', key: 'bk_archive' }
    ],
    jobs: [
      { id: 'advance', key: 'bk_advance', primary: true },
      { id: 'done',    key: 'bk_done' },
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
    var idCol = { jobs: 0, movements: null, products: null, customers: null }[sc];
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
        var now = (a === 'hide');
        list.forEach(function (p) { p.hidden = now; p.archived = now; });
        pushRows(list, function (p) { return Shop.hideProduct(p.id, now); });
        stageUndo(n + ' ' + t(a === 'hide' ? 'bk_hidden' : 'bk_shown'), function () {
          list.forEach(function (p, i) { p.hidden = before[i]; p.archived = before[i]; });
          pushRows(list, function (p, i) { return Shop.hideProduct(p.id, before[i]); });
        });
        refreshAll(); paint(); return;
      }
      if (a === 'price')  { priceModal(); return; }
      if (a === 'export') { exportSelection(sc); return; }
      if (a === 'archive') {
        /* One column, not two. `archived` and `hidden` mean the same thing on
           a product — the server has a single `hidden` and it is right — so
           archiving here is hiding there. */
        list.forEach(function (p) { p.archived = true; p.hidden = true; });
        pushRows(list, function (p) { return Shop.hideProduct(p.id, true); });
        clear(sc);
        stageUndo(n + ' ' + t('bk_archived'), function () {
          list.forEach(function (p) { p.archived = false; p.hidden = false; });
          pushRows(list, function (p) { return Shop.hideProduct(p.id, false); });
        });
        refreshAll(); paint(); return;
      }
    }

    /* ---- customers ---- */
    if (sc === 'customers') {
      var cl = selCustomers();
      if (a === 'message') { messageModal(); return; }
      if (a === 'points') {
        cl.forEach(function (c) { c.loyaltyPoints += 250; });
        pushRows(cl, function (c) { return Shop.adjustPoints(c.id, 250, t('bulk_title')); });
        stageUndo(n + ' · +250 ' + t('points'), function () {
          cl.forEach(function (c) { c.loyaltyPoints -= 250; });
          pushRows(cl, function (c) { return Shop.adjustPoints(c.id, -250, t('undo')); });
        });
        refreshAll(); paint(); return;
      }
      if (a === 'export') { exportSelection(sc); return; }
      if (a === 'archive') {
        cl.forEach(function (c) { c.archived = true; });
        pushRows(cl, function (c) { return Shop.updateCustomer(c.id, { archived: 1 }); });
        clear(sc);
        stageUndo(n + ' ' + t('bk_archived'), function () {
          cl.forEach(function (c) { c.archived = false; });
          pushRows(cl, function (c) { return Shop.updateCustomer(c.id, { archived: 0 }); });
        });
        refreshAll(); paint(); return;
      }
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
      /* Undo only the stage moves. An order that has been placed cannot be
         unplaced by a button here — another company has been told, and their
         board already shows it. Offering to take that back would be a lie of
         exactly the kind this whole pass is removing, so the jobs that were
         SENT are left out of the snapshot and their toast says "sent". */
      var moved = prev.filter(function (p) { return p.j.stage !== p.stage && p.j.order.state === p.order.state; });
      if (moved.length) {
        stageUndo(n + ' ' + t(sent === n ? 'bk_sent' : 'bk_moved'), function () {
          moved.forEach(function (p) {
            /* Through DB.setStage, not by assignment, so the server hears it
               too — it drops the later stamps itself. Assigning p.j.stage
               first would make setStage a no-op, because its very first check
               is whether the job is already there. */
            DB.setStage(p.j, p.stage, 'og');
            p.j.history = p.hist;
          });
        });
      } else {
        toast(n + ' ' + t(sent === n ? 'bk_sent' : 'bk_moved'), '', 'ok', 3200);
      }
      clear(sc); refreshAll(); paint(); return;
    }

    /* The 'orders' scope went with the storefront. It read DB.storeOrders,
       which no longer exists anywhere, so reaching it threw — nothing does
       reach it, but a branch that can only crash is worse than no branch. */

    if (sc === 'movements' && a === 'export') { exportSelection(sc); return; }

    /* ---- label printing (one line per selected variant, real hardware
       preview/print — the same Labels module the product drawer's own
       per-size "Print labels" button drives, so nothing here is a second
       implementation of preview/print/station/preset behaviour) ---- */
    if (sc === 'variants' && a === 'print') {
      var lines = ids('variants').map(function (sku) {
        return { sku: sku, qty: (typeof OG !== 'undefined' && OG.lbQty && OG.lbQty[sku]) || 1 };
      });
      if (typeof Labels !== 'undefined') {
        Labels.openPreviewModal(lines, Labels.lastChoice().preset, Labels.lastChoice().station);
      }
      return;
    }
  }

  /* Delete names the damage before it happens. */
  /* Send a bulk edit row by row.

     One request per row rather than a bulk endpoint, because the server's
     rules are per row — a price has a floor, a hidden product still has to
     exist for past sales — and a batch route would have to restate every one
     of them in a second place.

     None of this pushed at all before. The rows changed on screen, the undo
     bar appeared, and the next reload put every value back: a shop could
     reprice forty products, see it work, and find the old prices at closing.

     `undo` is given the same treatment, or it is not an undo — reversing on
     screen while the server keeps the change is worse than no undo at all. */
  function pushRows(list, make, title) {
    if (typeof Shop === 'undefined' || !Shop.live()) return;
    Promise.all(list.map(make))
      .then(function () { return Shop.reload(); })
      .catch(function (err) {
        if (typeof toast === 'function') {
          toast(title || t('bulk_title'),
                (typeof API !== 'undefined' && API.friendly) ? API.friendly(err)
                                                             : String(err.message || err),
                'err', 6000);
        }
        Shop.reload();
      });
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

    'price-apply': function () {
      var pctEl = document.getElementById('bkPct');
      var p = Number(pctEl && pctEl.value) || 0;
      var list = selProducts();
      var before = list.map(function (x) { return x.sellingPrice; });
      list.forEach(function (x) {
        x.sellingPrice = Math.max(1000, Math.round(x.sellingPrice * (1 + p / 100) / 1000) * 1000);
      });
      /* A price is stored in the product's OWN currency. x.sellingPrice is the
         lira-converted figure the screens draw, so sending that back would
         turn a dollar-priced shoe into a lira-priced one at today's rate —
         and one pass through this button would silently repeg the catalogue.
         The percentage goes onto srcSellingPrice, in srcCurrency, which
         hydrate keeps beside the converted value for exactly this. */
      var srcBefore = list.map(function (x) { return x.srcSellingPrice; });
      var priced = function (x, val) {
        return Shop.updateProduct(x.id, {
          selling_price: val,
          currency: x.srcCurrency || CONFIG.BASE_CURRENCY
        });
      };
      list.forEach(function (x) {
        if (x.srcSellingPrice != null) {
          x.srcSellingPrice = Math.max(1, Math.round(x.srcSellingPrice * (1 + p / 100)));
        }
      });
      pushRows(list, function (x) { return priced(x, x.srcSellingPrice); });

      closeModal();
      stageUndo(list.length + ' · ' + (p > 0 ? '+' : '') + p + '%', function () {
        list.forEach(function (x, i) {
          x.sellingPrice = before[i];
          x.srcSellingPrice = srcBefore[i];
        });
        pushRows(list, function (x, i) { return priced(x, srcBefore[i]); });
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
