/* ==========================================================================
   OG SYSTEM — application shell  ·  PRINT LABELS (variant picker for the
   real thermal label printer)
   --------------------------------------------------------------------------
   Added after the app.js -> app-*.js split (see the other app-*.js headers
   for that history). Loads after app-products.js — reuses DB.typeLabels /
   thumb() / healthBadge() — and before app-tour-routing.js, since VIEWS
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
  var f = OG.lbf;
  var rows = labelVariantRows();
  var types = Object.keys(DB.typeLabels);

  var h = '<div class="page-head"><div><h1>' + t('labels_title') + '</h1>' +
    '<div class="sub">' + t('labels_sub') + '</div></div></div>';

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
    '</tr></thead><tbody>';

  if (!rows.length) {
    h += '<tr><td colspan="7" class="muted" style="text-align:center;padding:28px">' + t('none') + '</td></tr>';
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
    '</tr>';
  });

  h += '</tbody></table></div>';
  return h;
}
