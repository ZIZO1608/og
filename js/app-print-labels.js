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
                  (v.barcode || '').toLowerCase().indexOf(q) > -1 ||
                  (v.labelCode || '').indexOf(q) > -1;
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
    '<input class="inp grow" type="text" placeholder="' + t('search_products') + '" value="' + esc(f.q) + '" data-change="lbf-q">' +
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

  /* The same three columns as the product drawer's size table, in the same
     order — the label code is what the sticker's Code 128 carries, so it is
     the one to hold a sticker up against. */
  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th class="bk-col">' + Bulk.headBox('variants') + '</th>' +
    '<th>' + t('product') + '</th><th>' + t('size') + '</th>' +
    '<th class="num">' + t('qty') + '</th><th>' + t('sku') + '</th>' +
    '<th>' + t('ean13') + '</th><th>' + t('label_code') + '</th><th>' + t('status') + '</th>' +
    '<th class="num">' + t('lbl_print_qty') + '</th>' +
    '</tr></thead><tbody>';

  if (!rows.length) {
    h += '<tr><td colspan="9" class="muted" style="text-align:center;padding:28px">' + t('none') + '</td></tr>';
  }

  /* ONE ROW PER PRODUCT, sizes folded underneath. The flat list drew every
     size as its own row - five lines of "Ahmad jersey" for one jersey - and
     the person printing a whole line had to tick five boxes. The product row
     carries a tick that means all of its sizes, the count and the total, and
     a Print-all button; a click anywhere else on it opens the sizes, which
     keep the per-size tick and the per-size print quantity they always had.
     Which products are open lives in OG.lbOpen for the session, like the
     filters do. */
  OG.lbOpen = OG.lbOpen || {};
  var groups = [], byPid = {};
  rows.forEach(function (r) {
    var g = byPid[r.p.id];
    if (!g) { g = byPid[r.p.id] = { p: r.p, rows: [] }; groups.push(g); }
    g.rows.push(r);
  });

  var ri = 0;
  groups.forEach(function (g) {
    var skus = g.rows.map(function (r) { return r.v.sku; });
    var sel = skus.filter(function (k) { return Bulk.has('variants', k); }).length;
    var all = sel === skus.length;
    var open = !!OG.lbOpen[g.p.id];
    var total = g.rows.reduce(function (n, r) { return n + (r.qty || 0); }, 0);
    /* The family part of the SKU - OG-051 of OG-051-XL - so a row still
       reads as the product it is while its sizes are folded away. */
    var fam = (g.rows[0].v.sku || '').replace(/-[^-]+$/, '');

    h += '<tr class="lb-prod' + (all ? ' bk-on' : '') + (open ? ' open' : '') +
           '" data-act="lb-open" data-pid="' + g.p.id + '">' +
      '<td class="bk-col"><label class="bk-box" title="' + esc(t('bk_select')) + '">' +
        '<input type="checkbox" data-bk="group" data-sc="variants" data-pid="' + g.p.id + '"' +
        (all ? ' checked' : '') + (sel && !all ? ' data-some="1"' : '') + '></label></td>' +
      '<td><div class="cell-prod"><span class="lb-chev"></span>' + thumb(g.p) + '<span><b>' + esc(g.p.name) + '</b>' +
        '<small>' + esc(g.p.brand) + '</small></span></div></td>' +
      '<td class="muted nowrap lb-cnt" data-pid="' + g.p.id + '">' + labelCountCell(g.rows.length, sel) + '</td>' +
      '<td class="num"><b>' + total + '</b></td>' +
      '<td class="muted num nowrap">' + esc(fam) + '</td>' +
      '<td></td><td></td><td></td>' +
      '<td class="num"><button class="btn btn-sm" data-act="lb-print-all" data-pid="' + g.p.id + '">' +
        t('lb_print_all') + '</button></td>' +
    '</tr>';

    if (!open) { ri += g.rows.length; return; }

    g.rows.forEach(function (r) {
      h += '<tr class="lb-size' + (Bulk.has('variants', r.v.sku) ? ' bk-on' : '') + '">' +
        '<td class="bk-col">' + Bulk.box('variants', r.v.sku, ri++) + '</td>' +
        '<td class="muted"></td>' +
        '<td><b style="font-family:var(--font-head)">' + r.v.size + '</b></td>' +
        '<td class="num">' + r.qty + '</td>' +
        '<td class="muted num nowrap">' + r.v.sku + '</td>' +
        '<td class="muted num nowrap">' + r.v.barcode + '</td>' +
        '<td class="num nowrap"><b>' + esc(r.v.labelCode || '—') + '</b></td>' +
        '<td>' + healthBadge(r.v.qty) + '</td>' +
        '<td class="num"><input class="inp num" type="number" min="1" max="99" value="' +
          (OG.lbQty[r.v.sku] || 1) + '" style="width:56px" data-change="lb-qty" data-sku="' + esc(r.v.sku) + '"></td>' +
      '</tr>';
    });
  });

  h += '</tbody></table></div>';
  return h;
}

/* "5 sizes - 3 ticked", as its own function because js/bulk.js repaints this
   cell when a tick changes rather than rebuilding the table: a full render
   throws the scroll back to the top, which on a long catalogue moves the row
   out from under the hand that just ticked it. */
function labelCountCell(total, sel) {
  return t('lb_sizes').replace('{n}', total) +
    (sel ? ' <span class="badge neutral">' + t('lb_sel').replace('{n}', sel) + '</span>' : '');
}

/* The lines a whole product prints as: every size the current filter shows,
   at the quantity typed beside it (or one). Shared by the product row's
   button and nothing else - the bulk bar builds its own from the ticks. */
function labelLinesForProduct(pid) {
  return labelVariantRows().filter(function (r) { return r.p.id === pid; }).map(function (r) {
    return { sku: r.v.sku, qty: (OG.lbQty && OG.lbQty[r.v.sku]) || 1 };
  });
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
    thumb(p, 'lg') + '<div><span class="eyebrow">' + dots(esc(p.brand), DB.typeLabels[p.type]) + '</span>' +
    '<h3 style="font-size:16px;margin:2px 0 3px">' + esc(p.name) + '</h3></div></div>';

  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap">' +
    '<span class="lbl">' + t('pick_size') + '</span>' +
    '<span><button class="btn btn-sm btn-ghost" data-act="qlp-all">' + t('lbl_pick_in_stock') + '</button> ' +
    '<button class="btn btn-sm btn-ghost" data-act="qlp-per-pair" title="' + esc(t('l60_per_pair')) + '">' + t('lbl_per_pair') + '</button> ' +
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

/* `opts.perPair` opens with every in-stock size already picked at its stock
   count — one sticker per pair — which is what a reprint after a shelf
   move needs (the shelf map's "reprint" toast) and what the old 60x40
   product label did by default. A plain open starts empty. */
function openQuickLabelPicker(pid, opts) {
  var p = DB.product(pid);
  if (!p) return;
  quickPick = { pid: pid, sel: {} };
  if (opts && opts.perPair) {
    DB.variantsOf(pid).forEach(function (v) { if (v.qty > 0) quickPick.sel[v.sku] = Math.min(99, v.qty); });
  }

  openModal({
    title: t('print_labels') + ' · ' + esc(p.name),
    size: 'narrow',
    body: quickPickerBodyHTML(),
    foot: quickPickerFootHTML(),
    onClose: function () { quickPick = null; }
  });
}

/* Re-render the grid/selected-list and the footer count in place — the
   modal stays open, same pattern as the shelf labels' repaint() in js/labels60.js. */
function repaintQuickLabelPicker() {
  if (!quickPick) return;
  var body = document.querySelector('.modal-body');
  var foot = document.querySelector('.modal-foot');
  if (body) body.innerHTML = quickPickerBodyHTML();
  if (foot) foot.innerHTML = quickPickerFootHTML();
}
