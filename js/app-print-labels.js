/* ==========================================================================
   OG SYSTEM — application shell  ·  PRINT LABELS (variant picker for the
   real thermal label printer)
   --------------------------------------------------------------------------
   Added after the app.js -> app-*.js split (see the other app-*.js headers
   for that history). Loads after app-products.js — reuses DB.typeLabels /
   thumb() / healthBadge() — and before app-routing.js, since VIEWS
   there references viewPrintLabels by value.

   A dedicated screen for choosing exactly which product x size combinations
   to print barcodes for, across the whole catalogue — filtered by type,
   warehouse and stock level, then handed straight to the Labels module
   (js/labels.js) the product drawer's single-size "Print labels" button
   already drives, so preview/print/station/preset behaviour is identical,
   not reimplemented. Selection itself is a new Bulk scope ('variants',
   keyed by SKU) added in js/bulk.js.
   ========================================================================== */

function labelVariantRows() {
  var f = OG.lbf;
  var rows = [];
  DB.products.forEach(function (p) {
    if (p.archived) return;
    if (f.type && p.type !== f.type) return;
    DB.variantsOf(p.id).forEach(function (v) {
      if (f.wh !== 'all' && DB.stockAt(v, f.wh) <= 0) return;
      if (f.stock && DB.health(v.qty) !== f.stock) return;
      if (f.q) {
        var q = f.q.toLowerCase();
        var hit = p.name.toLowerCase().indexOf(q) > -1 ||
                  v.sku.toLowerCase().indexOf(q) > -1 ||
                  (v.barcode || '').toLowerCase().indexOf(q) > -1;
        if (!hit) return;
      }
      rows.push({ p: p, v: v, qty: f.wh === 'all' ? v.qty : DB.stockAt(v, f.wh) });
    });
  });
  return rows;
}

function viewPrintLabels() {
  OG.lbf = OG.lbf || { q: '', type: '', wh: 'all', stock: '' };
  /* {sku: qty} — how many of EACH selected variant to print, set inline on
     this table before/while ticking the bulk checkbox. Survives filter
     changes and re-renders exactly like OG.lbf does; a stale entry for a
     sku that scrolls out of the current filter is harmless (only read by
     sku lookup at print time, in js/bulk.js's variants/print runner). */
  OG.lbQty = OG.lbQty || {};
  var f = OG.lbf;
  var rows = labelVariantRows();
  var types = Object.keys(DB.typeLabels);

  var h = '<div class="page-head"><div><h1>' + t('labels_title') + '</h1>' +
    '<div class="sub">' + t('labels_sub') + '</div></div>' +
    /* The shelf labels have no product to pick, so they do not belong in the
       variant table below — they are the other thing this screen prints. */
    '<div><button class="btn" data-act="l60-shelf-labels">' +
      t('l60_shelf_title') + '</button></div></div>';

  h += '<div class="filters">' +
    '<input class="inp grow" type="text" placeholder="' + t('search_ph') + '" value="' + esc(f.q) + '" data-change="lbf-q">' +
    '<select class="inp" data-change="lbf-type"><option value="">' + t('all_types') + '</option>';
  types.forEach(function (ty) {
    h += '<option value="' + ty + '"' + (f.type === ty ? ' selected' : '') + '>' + DB.typeLabels[ty] + '</option>';
  });
  h += '</select>';

  h += '<select class="inp" data-change="lbf-wh"><option value="all"' + (f.wh === 'all' ? ' selected' : '') + '>' +
       t('all_warehouses') + '</option>';
  DB.warehouses.forEach(function (w) {
    h += '<option value="' + w.id + '"' + (f.wh === w.id ? ' selected' : '') + '>' +
         DB.whName(w.id, OG.lang === 'ar') + '</option>';
  });
  h += '</select>';

  h += '<select class="inp" data-change="lbf-stock"><option value="">' + t('all_health') + '</option>';
  ['healthy', 'low', 'critical', 'out'].forEach(function (hh) {
    h += '<option value="' + hh + '"' + (f.stock === hh ? ' selected' : '') + '>' + t(hh) + '</option>';
  });
  h += '</select>';

  h += '<span class="badge neutral">' + rows.length + '</span></div>';

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th class="bk-col">' + Bulk.headBox('variants') + '</th>' +
    '<th>' + t('product') + '</th><th>' + t('size') + '</th>' +
    '<th class="num">' + t('qty') + '</th><th>' + t('sku') + '</th>' +
    '<th>' + t('barcode') + '</th><th>' + t('status') + '</th>' +
    '<th class="num">' + t('lbl_print_qty') + '</th>' +
    '</tr></thead><tbody>';

  if (!rows.length) {
    h += '<tr><td colspan="8" class="muted" style="text-align:center;padding:28px">' + t('none') + '</td></tr>';
  }

  rows.forEach(function (r, ri) {
    h += '<tr' + (Bulk.has('variants', r.v.sku) ? ' class="bk-on"' : '') + '>' +
      '<td class="bk-col">' + Bulk.box('variants', r.v.sku, ri) + '</td>' +
      '<td><div class="cell-prod">' + thumb(r.p) + '<span><b>' + esc(r.p.name) + '</b>' +
        '<small>' + esc(r.p.brand) + '</small></span></div></td>' +
      '<td><b style="font-family:var(--font-head)">' + r.v.size + '</b></td>' +
      '<td class="num">' + r.qty + '</td>' +
      '<td class="muted num nowrap">' + r.v.sku + '</td>' +
      '<td class="muted num nowrap">' + r.v.barcode + '</td>' +
      '<td>' + healthBadge(r.v.qty) + '</td>' +
      '<td class="num"><input class="inp num" type="number" min="1" max="99" value="' +
        (OG.lbQty[r.v.sku] || 1) + '" style="width:56px" data-change="lb-qty" data-sku="' + esc(r.v.sku) + '"></td>' +
    '</tr>';
  });

  h += '</tbody></table></div>';
  return h;
}

/* ---- quick per-product size picker ----------------------------------------
   The Products table's per-row "Print labels" button — for the one sticker
   that fell off, not a batch. Reuses the same .size-pop/.size-btn grid
   js/pos.js's openSizePicker draws at the till, but multi-select rather than
   single-pick-then-navigate: every size stays a toggle, so several can be
   queued for one print run.

   Module-scoped, one product at a time — same shape as js/labels.js's own
   `activeLines` — holding which sizes are picked and at what quantity.
   Mutated by the qlp-* actions/changes below and repainted in place (the
   .modal-body/.modal-foot are patched directly) so the modal never has to
   close and reopen mid-pick. */
var quickPick = null;   // { pid, sel: { sku: qty, ... } }

function quickPickCount() {
  var sizes = 0, labels = 0;
  Object.keys(quickPick.sel).forEach(function (sku) { sizes++; labels += quickPick.sel[sku]; });
  return { sizes: sizes, labels: labels };
}

function quickPickerBodyHTML() {
  var p = DB.product(quickPick.pid);
  var vs = DB.variantsOf(quickPick.pid);

  var h = '<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">' +
    thumb(p, 'lg') + '<div><span class="eyebrow">' + esc(p.brand) + ' · ' + DB.typeLabels[p.type] + '</span>' +
    '<h3 style="font-size:16px;margin:2px 0 3px">' + esc(p.name) + '</h3></div></div>';

  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap">' +
    '<span class="lbl">' + t('pick_size') + '</span>' +
    '<span><button class="btn btn-sm btn-ghost" data-act="qlp-all">' + t('lbl_pick_in_stock') + '</button> ' +
    '<button class="btn btn-sm btn-ghost" data-act="qlp-clear">' + t('clear') + '</button></span></div>';

  /* Zero-stock sizes stay clickable — printing a sticker ahead of an
     incoming delivery, or a reprint, is a real reason to want one even at
     zero on hand. They just lose the healthy stock note in favour of a
     flagged one, same as the old table's row-danger treatment. */
  h += '<div class="size-pop" style="margin-bottom:16px">';
  vs.forEach(function (v) {
    var picked = Object.prototype.hasOwnProperty.call(quickPick.sel, v.sku);
    var note = v.qty > 0 ? (v.qty + ' ' + t('in_stock')) : t('out');
    h += '<button class="size-btn' + (picked ? ' on' : '') + '" data-act="qlp-toggle" data-sku="' + esc(v.sku) + '">' +
      v.size + '<small' + (v.qty === 0 && !picked ? ' style="color:var(--destructive)"' : '') + '>' + note + '</small></button>';
  });
  h += '</div>';

  var skus = Object.keys(quickPick.sel);
  if (skus.length) {
    h += '<div class="table-wrap"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('size') + '</th><th class="num">' + t('lbl_qty') + '</th>' +
      '</tr></thead><tbody>';
    skus.forEach(function (sku) {
      var v = DB.variantBySku(sku);
      if (!v) return;
      h += '<tr>' +
        '<td><b style="font-family:var(--font-head);font-size:14px">' + v.size + '</b></td>' +
        '<td class="num"><input class="inp num" type="number" min="1" max="99" value="' + quickPick.sel[sku] +
          '" style="width:56px" data-change="qlp-qty" data-sku="' + esc(sku) + '"></td>' +
      '</tr>';
    });
    h += '</tbody></table></div>';
  }

  return h;
}

function quickPickerFootHTML() {
  var c = quickPickCount();
  var summary = c.sizes
    ? (c.sizes + ' ' + t('size') + ' · ' + c.labels + ' ' + t('lb_labels'))
    : t('lbl_none_picked');
  return '<span class="muted small" style="margin-inline-end:auto;align-self:center">' + summary + '</span>' +
    '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
    '<button class="btn btn-primary" data-act="qlp-print"' + (c.sizes ? '' : ' disabled') + '>' + t('print_labels') + '</button>';
}

function openQuickLabelPicker(pid) {
  var p = DB.product(pid);
  if (!p) return;
  quickPick = { pid: pid, sel: {} };

  openModal({
    title: t('print_labels') + ' · ' + esc(p.name),
    size: 'narrow',
    body: quickPickerBodyHTML(),
    foot: quickPickerFootHTML(),
    onClose: function () { quickPick = null; }
  });
}

/* Re-render the grid/selected-list and the footer count in place — the
   modal stays open, same pattern as repaintLabels() in app-warehouse.js. */
function repaintQuickLabelPicker() {
  if (!quickPick) return;
  var body = document.querySelector('.modal-body');
  var foot = document.querySelector('.modal-foot');
  if (body) body.innerHTML = quickPickerBodyHTML();
  if (foot) foot.innerHTML = quickPickerFootHTML();
}
