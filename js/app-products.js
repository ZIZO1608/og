/* ==========================================================================
   OG SYSTEM — application shell  ·  7/17: PRODUCTS (table + drawer)
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 2556-2801). Loads after
   app-dashboard.js.
   ========================================================================== */

/* -------------------------------------------------------------- 8. PRODUCTS */

/* `need` names the permission a column depends on. A column with no `need` is
   for everyone. Declaring it here rather than filtering at each draw site
   means the header, the body and the export all read the same list and cannot
   drift apart — which is exactly how a hidden column reappears in a
   spreadsheet six months later. */
var PROD_COLS_ALL = [
  { k: 'name',   label: 'product' },
  { k: 'type',   label: 'type' },
  { k: 'qty',    label: 'stock', num: true, need: 'stock.read' },
  { k: 'cost',   label: 'cost',  num: true, need: 'cost.read' },
  { k: 'price',  label: 'price', num: true },
  { k: 'margin', label: 'margin', num: true, need: 'profit.read' },
  { k: 'health', label: 'health', need: 'stock.read' },
  /* Marking something hidden is editing the catalogue, not
     browsing it. */
  { k: 'hidden', label: 'visible', need: 'product.write' }
];

function prodCols() {
  return PROD_COLS_ALL.filter(function (c) { return !c.need || allow(c.need); });
}

function productRows() {
  var f = OG.prod;
  var base = DB.products.filter(function (p) { return f.health === 'archived' ? p.archived : !p.archived; });
  var rows = base.map(function (p) {
    var qty = DB.totalQty(p.id);
    return {
      p: p, qty: qty, cost: p.costPrice, price: p.sellingPrice,
      margin: (p.sellingPrice - p.costPrice) / p.sellingPrice * 100,
      health: DB.health(qty), name: p.name, type: p.type, hidden: p.hidden ? 0 : 1
    };
  });

  if (f.type) rows = rows.filter(function (r) { return r.type === f.type; });
  if (f.health === 'gap') rows = rows.filter(function (r) { return DB.sizeGaps(r.p.id).length > 0; });
  else if (f.health && f.health !== 'archived') rows = rows.filter(function (r) { return r.health === f.health; });
  if (f.q) {
    var q = f.q.toLowerCase();
    rows = rows.filter(function (r) {
      return r.name.toLowerCase().indexOf(q) > -1 || r.p.brand.toLowerCase().indexOf(q) > -1;
    });
  }

  /* Sorting by a column this person cannot see would order the whole table by
     an invisible number — and cost order and price order are close enough that
     it would look like a bug rather than a secret. Fall back to name. */
  var sort = f.sort;
  if (!prodCols().some(function (c) { return c.k === sort; })) sort = 'name';

  var order = { out: 0, critical: 1, low: 2, healthy: 3 };
  rows.sort(function (a, b) {
    var x = a[sort], y = b[sort];
    if (sort === 'health') { x = order[x]; y = order[y]; }
    if (typeof x === 'string') return x.localeCompare(y) * f.dir;
    return (x - y) * f.dir;
  });
  return rows;
}

function viewProducts() {
  var rows = productRows();
  var types = Object.keys(DB.typeLabels);

  /* The products sheet is an inventory document — stock levels, pieces,
     critical SKUs. Without stock.read it would export a list of names and
     prices under a heading about inventory, which is worse than no button. */
  var canExport = allow('stock.read');

  var h = '<div class="page-head"><div><h1>' + t('products_title') + '</h1>' +
    '<div class="sub">' + t('products_sub') + '</div></div>' +
    '<div class="head-actions">' +
      (canExport ? exportButtons() : '') +
      ifNav('labels',
        '<button class="btn btn-ghost" data-act="nav" data-view="labels">' + t('nav_labels') + '</button>') +
      /* data-tab, so this lands ON the Add form. Without it the button only
         opened the Warehouse and left somebody to find the right tab. */
      ifNav('warehouse',
        '<button class="btn btn-primary" data-act="nav" data-view="warehouse" data-tab="add">+ ' +
          t('tab_add') + '</button>') +
    '</div></div>';

  h += '<div class="filters">' +
    '<input class="inp grow" type="text" placeholder="' + t('search_products') + '" value="' + esc(OG.prod.q) + '" data-change="prod-q">' +
    '<select class="inp" data-change="prod-type"><option value="">' + t('all_types') + '</option>';
  types.forEach(function (ty) {
    h += '<option value="' + ty + '"' + (OG.prod.type === ty ? ' selected' : '') + '>' + DB.typeLabels[ty] + '</option>';
  });
  h += '</select>';

  /* Every option in this filter is a stock level. To someone who cannot see
     the stock column it is a dropdown that reorders the list for no visible
     reason. */
  if (allow('stock.read')) {
    h += '<select class="inp" data-change="prod-health"><option value="">' + t('all_health') + '</option>';
    ['healthy', 'low', 'critical', 'out', 'gap', 'archived'].forEach(function (hh) {
      h += '<option value="' + hh + '"' + (OG.prod.health === hh ? ' selected' : '') + '>' +
           t(hh === 'gap' ? 'gap_only' : (hh === 'archived' ? 'bk_archived_only' : hh)) + '</option>';
    });
    h += '</select>';
  }

  h += '<span class="badge neutral">' + rows.length + ' / ' + DB.products.length + '</span></div>';

  var cols = prodCols();

  /* Bulk select feeds bulk EDIT. No point offering the checkboxes to someone
     who cannot act on the selection. */
  var bulk = allow('product.write');

  /* One-click "just this size" printing, right from the row — the bulk
     Print labels screen is for a batch; this is for the one sticker that
     fell off a shoe on the shelf. Opens straight to that product's own
     sizes, no drawer in between. */
  var canLabel = allow('label.print');

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>';
  if (bulk) h += '<th class="bk-col">' + Bulk.headBox('products') + '</th>';
  cols.forEach(function (c) {
    var arrow = OG.prod.sort === c.k ? (OG.prod.dir === 1 ? ' ▲' : ' ▼') : '';
    h += '<th class="sortable' + (c.num ? ' num' : '') + '" data-act="prod-sort" data-k="' + c.k + '">' +
         t(c.label) + '<span class="arrow">' + arrow + '</span></th>';
  });
  if (canLabel) h += '<th></th>';
  h += '</tr></thead><tbody>';

  rows.forEach(function (r, ri) {
    var gaps = DB.sizeGaps(r.p.id);

    /* Built as a map and emitted in header order, rather than as a fixed run
       of <td>s. Dropping a column from the header alone would shunt every
       later cell one place left — the cashier would not see cost, she would
       see cost UNDER the heading "price", which is worse than showing it. */
    var cell = {
      name: '<td><div class="cell-prod">' + thumb(r.p) + '<span><b>' + esc(r.p.name) + '</b>' +
        '<small>' + dots(esc(r.p.brand), esc(r.p.colorway),
          (gaps.length ? '<span style="color:var(--destructive);font-weight:600">' + t('size') + ' ' + gaps.join('/') + ' = 0</span>' : '')) +
        '</small></span></div></td>',
      type: '<td><span class="badge neutral">' + DB.typeLabels[r.type] + '</span></td>',
      qty: '<td class="num"><b>' + nf(r.qty) + '</b> <span class="muted small">' + t('pieces') + '</span></td>',
      cost: '<td class="num muted">' + money(r.cost) + '</td>',
      price: '<td class="num"><b>' + money(r.price) + '</b></td>',
      margin: '<td class="num">' + pct(r.margin, 0) + '</td>',
      health: '<td class="nowrap">' + healthBadge(r.qty) +
        (gaps.length ? ' <span class="badge critical">' + t('size_gap') + '</span>' : '') + '</td>',
      hidden: '<td onclick="event.stopPropagation()"><label class="switch"><input type="checkbox"' +
        (r.p.hidden ? '' : ' checked') + ' data-change="toggle-visible" data-id="' + r.p.id + '"><i></i></label></td>'
    };

    h += '<tr class="clickable' + (bulk && Bulk.has('products', r.p.id) ? ' bk-on' : '') +
         '" data-act="open-product" data-id="' + r.p.id + '">' +
      (bulk ? '<td class="bk-col">' + Bulk.box('products', r.p.id, ri) + '</td>' : '');
    cols.forEach(function (c) { h += cell[c.k]; });
    if (canLabel) {
      /* No onclick="event.stopPropagation()" here. It used to carry one, which
         killed the click before it reached the delegated [data-act] dispatcher
         on `document` — so this button had never once printed a label. It was
         never needed either: the dispatcher resolves e.target.closest('[data-act]'),
         which finds THIS button, not the open-product row around it. Same bug
         and same fix as the POS cart's Clear button. */
      /* An icon, not the words. "Print barcode labels" as text was the widest
         thing in a nine-column table and pushed itself off the right edge on
         a 1440 screen — the one button the shop uses most, hidden behind a
         scrollbar. The label survives as the title and the accessible name. */
      h += '<td class="td-act"><button class="btn btn-sm btn-ghost btn-icon" ' +
        'data-act="quick-label" data-id="' + r.p.id + '" ' +
        'title="' + esc(t('print_labels')) + '" aria-label="' + esc(t('print_labels')) + '">' +
        '<svg viewBox="0 0 24 24" stroke-linecap="square" stroke-linejoin="miter">' +
          '<path d="M4 5v14M8 5v14M11 5v9M14 5v14M17 5v9M20 5v14"/></svg></button></td>';
    }
    h += '</tr>';
  });

  h += '</tbody></table></div>';
  return h;
}

/* How many customers on file wear this size — and a way through to them.

   THIS IS THE PAYOFF for the size work in Stages A and C. A shipment landing
   stops being "twelve pairs arrived" and becomes "six people to message", and
   the six are already known: the server aggregates each customer's top sizes
   from every non-voided sale they ever made.

   Counted off the hydrated customer rows, which already carry `sizes` — no
   request, and no second definition of what "wears a 43" means. */
function wearers(v) {
  if (typeof allow === 'function' && !allow('customer.read')) return '';
  var n = DB.customers.filter(function (c) {
    return !c.archived && (c.sizes || []).some(function (s) {
      return String(s.size) === String(v.size);
    });
  }).length;
  if (!n) return '';
  return ' <span class="badge accent clickable" data-act="cu-size" data-size="' + esc(v.size) + '" ' +
    'title="' + esc(t('pr_wearers_hint')) + '">' + nf(n) + ' ' + t('pr_wear') + '</span>';
}

function openProductDrawer(pid) {
  var p = DB.product(pid);
  if (!p) return;
  var vs = DB.variantsOf(pid);
  var total = DB.totalQty(pid);
  var gaps = DB.sizeGaps(pid);
  var trend = DB.productTrend(pid);
  var max = Math.max.apply(null, trend.concat([1]));

  var head =
    '<div style="display:flex;gap:12px;align-items:flex-start;flex:1">' +
      thumb(p, 'lg') +
      '<div><span class="eyebrow">' + DB.typeLabels[p.type] + ' · ' + esc(p.brand) + '</span>' +
      '<h3 style="font-size:18px;margin:3px 0 4px">' + esc(p.name) + '</h3>' +
      healthBadge(total) + ' <span class="badge neutral">' + esc(p.colorway) + '</span></div>' +
    '</div>';

  var body = '';

  if (gaps.length) {
    body += '<div class="alert-row alert-danger" style="margin-bottom:14px">' +
      '<span class="alert-ico red">!</span><span class="alert-txt"><b>' + t('size_gap_warn') + '</b>' +
      '<small>' + t('size') + ' ' + gaps.join(', ') + ' = 0 · ' + t('total_stock') + ' ' + total + '</small></span>' +
      '<button class="btn btn-sm btn-primary" data-act="reorder" data-id="' + p.id + '">' + t('reorder') + '</button></div>';
  }

  /* Stock, then what it is worth to us, then what we make on it — the last
     two are only for people allowed the numbers. The selling price is on the
     header above and stays: a cashier has to be able to answer "how much?". */
  var kpi = [
    '<div class="stat"><span class="eyebrow">' + t('total_stock') + '</span><div class="val">' + nf(total) + '</div></div>'
  ];
  if (seesCost()) {
    kpi.push('<div class="stat"><span class="eyebrow">' + t('stock_value') + '</span><div class="val">' +
             moneyShort(total * p.costPrice) + '</div></div>');
  }
  if (seesProfit()) {
    kpi.push('<div class="stat"><span class="eyebrow">' + t('margin') + '</span><div class="val accent">' +
             pct((p.sellingPrice - p.costPrice) / p.sellingPrice * 100, 0) + '</div></div>');
  }
  body += '<div class="grid" style="grid-template-columns:repeat(' + kpi.length +
          ',1fr);margin-bottom:16px">' + kpi.join('') + '</div>';

  var canLabel = allow('label.print');
  body += '<div class="card mb"><div class="card-head"><h3>' + t('per_size') + '</h3>' +
    '<div class="card-actions"><span class="badge neutral">' + vs.length + ' SKU</span></div></div>' +
    /* Three codes per size, each named for what it is: the SKU a person
       types, the EAN-13 a supplier's scanner reads, and the label code —
       the number the shop's own Code 128 stickers carry, which is what a
       scan of one of them sends. Showing only "barcode" left people
       comparing a sticker's digits against a column they never matched. */
    '<div class="table-wrap"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('size') + '</th><th>' + t('sku') + '</th><th>' + t('ean13') + '</th><th>' + t('label_code') + '</th>' +
      '<th class="num">' + t('qty') + '</th><th>' + t('shelf') + '</th><th>' + t('status') + '</th>' +
      (canLabel ? '<th class="num">' + t('lbl_qty') + '</th><th></th>' : '') +
    '</tr></thead><tbody>';
  vs.forEach(function (v) {
    body += '<tr' + (v.qty === 0 ? ' class="row-danger"' : '') + '>' +
      '<td><b style="font-family:var(--font-head);font-size:14px">' + v.size + '</b></td>' +
      '<td class="muted num nowrap">' + v.sku + '</td>' +
      '<td class="num muted nowrap">' + v.barcode + '</td>' +
      '<td class="num nowrap"><b>' + esc(v.labelCode || '—') + '</b></td>' +
      '<td class="num"><b>' + v.qty + '</b></td>' +
      '<td><span class="badge neutral">' + v.shelf + '</span></td>' +
      '<td>' + healthBadge(v.qty) + wearers(v) + '</td>' +
      (canLabel
        ? '<td class="num"><input class="inp num lbl-qty-inp" type="number" min="1" max="99" value="1" style="width:56px"></td>' +
          '<td><button class="btn btn-sm" data-act="preview-labels" data-variant-sku="' + esc(v.sku) + '">' +
            t('print_labels') + '</button></td>'
        : '') +
      '</tr>';
  });
  body += '</tbody></table></div></div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('sales_trend') + '</h3>' +
    '<div class="card-actions muted small">' + trend.reduce(function (a, b) { return a + b; }, 0) + ' ' + t('units').toLowerCase() + '</div></div>' +
    '<div class="card-body"><div class="sparkline">';
  trend.forEach(function (v, i) {
    body += '<i class="' + (i === trend.length - 1 ? 'last' : '') + '" style="height:' + Math.max(4, v / max * 100) + '%" title="' + v + '"></i>';
  });
  body += '</div></div></div>';

  body += '<div class="card"><div class="card-body"><dl class="kv">' +
    '<dt>' + t('brand') + '</dt><dd>' + esc(p.brand) + '</dd>' +
    '<dt>' + t('made_in') + '</dt><dd>' + esc(p.madeIn) + '</dd>' +
    '<dt>' + t('colour') + '</dt><dd>' + esc(p.colorway) + '</dd>' +
    (seesCost() ? '<dt>' + t('cost_price') + '</dt><dd>' + money(p.costPrice) + '</dd>' : '') +
    '<dt>' + t('selling_price') + '</dt><dd>' + money(p.sellingPrice) + '</dd>' +
    '<dt>' + t('last_sold') + '</dt><dd>' + p.lastSoldDaysAgo + ' ' + t('days_ago') + '</dd>' +
    '<dt>' + t('visible') + '</dt><dd>' + (p.hidden ? t('no') : t('yes')) + '</dd>' +
  '</dl></div></div>';

  body += '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" data-act="nav-close" data-view="warehouse" data-tab="add">' + t('edit_product') + '</button>' +
    /* ONE print button. There were two here — this one drove the browser
       Label Studio (SKU text in the bars) and a second opened the 60x40
       layout in js/labels60.js — beside the per-size buttons in the table
       above, which printed a third way. All of them now open the same size
       picker and the same template preview; the 60x40 template carries the
       shelf slot the second button existed for. */
    (allow('label.print')
      ? '<button class="btn" data-act="labels-for" data-id="' + p.id + '">' + t('print_labels') + '</button>'
      : '') +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="product" data-kind="pdf" data-id="' + p.id + '">' + t('rec_stock_sheet') + '</button>' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="product" data-kind="excel" data-id="' + p.id + '">' + t('export_excel') + '</button>' +
  '</div>';

  openDrawer({ head: head, body: body });
}
