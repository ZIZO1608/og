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
  /* The marketing website, not the archive — migration 039. Editing the
     catalogue, not browsing it, so it needs product.write. */
  { k: 'onWeb', label: 'visible', need: 'product.write' }
];

function prodCols() {
  return PROD_COLS_ALL.filter(function (c) { return !c.need || allow(c.need); });
}

function productRows() {
  var f = OG.prod;
  /* The catalogue screen shows the whole catalogue by default, archived lines
     included and marked. This is the one screen carrying the storefront
     switch, and a table that drops the row you just edited reads as broken:
     the product is gone and nothing says where it went. Everything that
     answers "how much stock has the shop got" filters archived out for itself
     through DB.liveVariants(), so showing them here costs no figure anywhere. */
  var base = DB.products.filter(function (p) {
    return f.arch === 'archived' ? p.archived : (f.arch === 'active' ? !p.archived : true);
  });
  var rows = base.map(function (p) {
    var qty = DB.totalQty(p.id);
    return {
      p: p, qty: qty, cost: p.costPrice, price: p.sellingPrice,
      margin: (p.sellingPrice - p.costPrice) / p.sellingPrice * 100,
      health: DB.health(qty), name: p.name, type: p.type, onWeb: p.onWeb ? 1 : 0
    };
  });

  if (f.type) rows = rows.filter(function (r) { return r.type === f.type; });
  if (f.health === 'gap') rows = rows.filter(function (r) { return DB.sizeGaps(r.p.id).length > 0; });
  else if (f.health) rows = rows.filter(function (r) { return r.health === f.health; });
  /* Name and brand only, before — so a size, a SKU, a barcode and the
     label code on the shop's own sticker all found nothing. DB.productMatch
     is the one rule, shared with the warehouse's "Where is it?" box, and it
     takes a scan an Arabic keyboard layout has mangled. */
  if (f.q) rows = rows.filter(function (r) { return DB.productMatch(r.p, f.q); });

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

/* A scan while the catalogue is on screen goes into the search box. It owns
   the scanner only when nothing is over the page — a drawer, a modal or the
   palette means the scan was meant for that, and every one of those is
   already checked ahead of this in the wedge router. */
function prodScanOwns() {
  return OG.view === 'products' &&
         !document.querySelector('.modal-root .modal') &&
         !document.querySelector('.drawer-root .drawer') &&
         !document.body.hasAttribute('data-overlay');
}

/* One row left after a scan is the answer, so it opens — the way a scan at
   the till adds the line rather than offering it. Several (a code shared by
   the colours of one size, which is this shop's own rule) or none leaves the
   list filtered and says what was scanned, because that IS the answer. */
function prodScanned(code) {
  OG.prod.q = String(code == null ? '' : code);
  /* A scan must never be hidden by a filter somebody left on yesterday. */
  OG.prod.type = '';
  OG.prod.health = '';
  render();
  var rows = productRows();
  if (rows.length === 1) { openProductDrawer(rows[0].p.id); return; }
  toast(t(rows.length ? 'pr_scan_found' : 'pr_scan_none').replace('{n}', rows.length),
        String(code).slice(0, 40), rows.length ? 'ok' : 'warn', 3500);
}

/* ---- the search box, the filters, and what is on ------------------------
   All of it reads OG.prod and nothing else: a filter that lives on the DOM
   does not survive a repaint, and this screen repaints on every live push,
   every bulk action and every save. */

function prodFindIcon() {
  return '<svg class="pr-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg>';
}

/* The filters that are ON — not the controls that exist. */
function prodChips() {
  var f = OG.prod, out = [];
  if (f.type) out.push({ f: 'type', label: DB.typeLabels[f.type] || f.type });
  if (f.health) out.push({ f: 'health', label: t(f.health === 'gap' ? 'gap_only' : f.health) });
  /* "active" is the default and therefore not a filter somebody switched on. */
  if (f.arch && f.arch !== 'active') out.push({ f: 'arch', label: t(f.arch === 'archived' ? 'bk_archived_only' : 'prod_arch_all') });
  return out;
}
function prodFilterCount() { return prodChips().length; }

function viewProducts() {
  var rows = productRows();
  var types = DB.activeTypes(DB.products.map(function (p) { return p.type; }));

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

  /* ONE BIG BOX, AND EVERYTHING ELSE BEHIND A BUTTON        (night shift 03)
     The search box used to be one of five controls in a row, and it matched
     the name and the brand only — not a size, not a SKU, not a barcode. Four
     dropdowns sat beside it whether or not anybody was filtering, and the
     only sign a filter was ON was the dropdown's own text, three controls
     along.

     Now: one box that takes a scan, a Filter button beside it, and every
     filter that IS on drawn as a chip you can press to take off. What is
     open and what is filtered live in OG.prod — module state, never a class
     on the DOM, because this screen repaints on every tick and every save
     (the Safeers menu learned that the hard way). */
  h += '<div class="pr-find">' +
    '<div class="pr-box">' + prodFindIcon() +
      '<input class="inp" type="search" id="prodFind" autocomplete="off" ' +
        'placeholder="' + esc(t('pr_find_ph')) + '" value="' + esc(OG.prod.q) + '" data-change="prod-q">' +
      (OG.prod.q ? '<button class="pr-x" type="button" data-act="prod-q-clear" ' +
        'aria-label="' + esc(t('pr_clear_filters')) + '">✕</button>' : '') +
    '</div>' +
    '<button class="btn' + (prodFilterCount() ? ' on' : '') + '" data-act="prod-filters">' +
      esc(t('pr_filter')) + (prodFilterCount() ? ' <span class="pr-n">' + prodFilterCount() + '</span>' : '') +
    '</button>' +
    (allow('product.write')
      ? '<button class="btn' + (OG.prod.select ? ' on' : '') + '" data-act="prod-select">' +
          esc(t('pr_select')) + '</button>'
      : '') +
    '<span class="badge neutral pr-count">' + rows.length + ' / ' + DB.products.length + '</span>' +
  '</div>';

  /* The chips: one per filter that is actually on, each its own undo. */
  var chips = prodChips();
  if (chips.length) {
    h += '<div class="pr-chips">' + chips.map(function (c) {
      return '<button class="pr-chip" type="button" data-act="prod-chip-off" data-f="' + c.f + '">' +
        esc(c.label) + '<span>✕</span></button>';
    }).join('') + (chips.length > 1
      ? '<button class="pr-chip pr-chip-all" type="button" data-act="prod-chip-off" data-f="all">' +
          esc(t('pr_clear_filters')) + '</button>'
      : '') + '</div>';
  }

  /* The panel itself, shut unless somebody asked for it — and it does NOT
     re-render on open, because the search box above it holds a caret. */
  h += '<div class="pr-filters"' + (OG.prod.filters ? '' : ' hidden') + ' id="prodFilters">' +
    '<label class="field"><span>' + t('type') + '</span>' +
      '<select class="inp" data-change="prod-type"><option value="">' + t('all_types') + '</option>' +
      types.map(function (ty) {
        return '<option value="' + ty + '"' + (OG.prod.type === ty ? ' selected' : '') + '>' +
          esc(DB.typeLabels[ty]) + '</option>';
      }).join('') + '</select></label>';

  /* Every option in this filter is a stock level. To someone who cannot see
     the stock column it is a dropdown that reorders the list for no visible
     reason. */
  if (allow('stock.read')) {
    h += '<label class="field"><span>' + t('stock') + '</span>' +
      '<select class="inp" data-change="prod-health"><option value="">' + t('all_health') + '</option>' +
      ['healthy', 'low', 'critical', 'out', 'gap'].map(function (hh) {
        return '<option value="' + hh + '"' + (OG.prod.health === hh ? ' selected' : '') + '>' +
          t(hh === 'gap' ? 'gap_only' : hh) + '</option>';
      }).join('') + '</select></label>';
  }

  /* Archived is not a stock level, so it gets a control of its own rather than
     a line in the dropdown above. Gated exactly like the switch it undoes:
     only product.write is sent archived rows at all (Cat.list includeHidden),
     so for anyone else this would filter a view of nothing. */
  if (allow('product.write')) {
    h += '<label class="field"><span>' + t('pr_selling') + '</span>' +
      '<select class="inp" data-change="prod-arch">' +
      [['all', 'prod_arch_all'], ['active', 'prod_arch_active'], ['archived', 'bk_archived_only']]
        .map(function (o) {
          return '<option value="' + o[0] + '"' + (OG.prod.arch === o[0] ? ' selected' : '') + '>' +
            t(o[1]) + '</option>';
        }).join('') + '</select></label>';
  }
  h += '</div>';

  var cols = prodCols();

  /* Bulk select feeds bulk EDIT. No point offering the checkboxes to someone
     who cannot act on the selection. */
  /* The tick column is a mode now, not furniture: it was drawn on every row
     for anybody with product.write, and the only thing it is for is the bulk
     bar. Press Select to get it. */
  var bulk = allow('product.write') && OG.prod.select;

  /* There used to be a barcode button at the end of every row — one-click
     label printing for a single product. It never worked reliably at the
     shop and was taken out on request; labels are printed from the product
     drawer, the Print-labels screen and the shelf map, which all reach the
     same preview. */

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>';
  if (bulk) h += '<th class="bk-col">' + Bulk.headBox('products') + '</th>';
  cols.forEach(function (c) {
    var arrow = OG.prod.sort === c.k ? (OG.prod.dir === 1 ? ' ▲' : ' ▼') : '';
    h += '<th class="sortable' + (c.num ? ' num' : '') + '" data-act="prod-sort" data-k="' + c.k + '">' +
         t(c.label) + '<span class="arrow">' + arrow + '</span></th>';
  });
  h += '</tr></thead><tbody>';

  rows.forEach(function (r, ri) {
    var gaps = DB.sizeGaps(r.p.id);

    /* Built as a map and emitted in header order, rather than as a fixed run
       of <td>s. Dropping a column from the header alone would shunt every
       later cell one place left — the cashier would not see cost, she would
       see cost UNDER the heading "price", which is worse than showing it. */
    var cell = {
      name: '<td><div class="cell-prod">' + thumb(r.p) + '<span><b>' + esc(r.p.name) + '</b>' +
        (r.p.archived ? ' <span class="badge neutral">' + t('bk_archived') + '</span>' : '') +
        '<small>' + dots(esc(r.p.brand), esc(r.p.colorway),
          (gaps.length ? '<span style="color:var(--destructive);font-weight:600">' + t('size') + ' ' + gaps.join('/') + ' = 0</span>' : '')) +
        '</small></span></div></td>',
      type: '<td><span class="badge neutral">' + esc(DB.typeLabels[r.type] || r.type || '') + '</span></td>',
      qty: '<td class="num"><b>' + nf(r.qty) + '</b> <span class="muted small">' + t('pieces') + '</span></td>',
      cost: '<td class="num muted">' + money(r.cost) + '</td>',
      price: '<td class="num"><b>' + money(r.price) + '</b></td>',
      margin: '<td class="num">' + pct(r.margin, 0) + '</td>',
      health: '<td class="nowrap">' + healthBadge(r.qty) +
        (gaps.length ? ' <span class="badge critical">' + t('size_gap') + '</span>' : '') + '</td>',
      onWeb: '<td onclick="event.stopPropagation()"><label class="switch"><input type="checkbox"' +
        (r.p.onWeb ? ' checked' : '') + ' data-change="toggle-visible" data-id="' + r.p.id + '"><i></i></label></td>'
    };

    /* Dimmed, not dropped: the row stays where the finger left it so the
       switch can be flipped straight back. .tbl tbody tr.dim is already in
       the stylesheet. */
    h += '<tr class="clickable' + (r.p.archived ? ' dim' : '') +
         (bulk && Bulk.has('products', r.p.id) ? ' bk-on' : '') +
         '" data-act="open-product" data-id="' + r.p.id + '">' +
      (bulk ? '<td class="bk-col">' + Bulk.box('products', r.p.id, ri) + '</td>' : '');
    cols.forEach(function (c) { h += cell[c.k]; });
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

  /* The picture is the button: press it to change it. Below the name, the
     address it lives at in the bucket - the one thing somebody wiring the
     website, or checking the mirror, actually asks for. */
  var canPic = allow('product.write') && typeof Shop !== 'undefined' && Shop.live();
  var head =
    '<div style="display:flex;gap:12px;align-items:flex-start;flex:1">' +
      (canPic
        ? '<button class="thumb-btn" data-act="prod-image" title="' + esc(t('img_change')) + '">' + thumb(p, 'lg') + '</button>' +
          '<input type="file" id="prodFile" accept="image/*" hidden>'
        : thumb(p, 'lg')) +
      '<div><span class="eyebrow">' + esc(DB.typeLabels[p.type] || '') + ' · ' + esc(p.brand) + '</span>' +
      '<h3 style="font-size:18px;margin:3px 0 4px">' + esc(p.name) + '</h3>' +
      healthBadge(total) + ' <span class="badge neutral">' + esc(p.colorway) + '</span>' +
      (canPic
        ? '<div class="pic-line">' +
            (p.image && p.image.src
              ? '<a href="' + esc(p.image.src) + '" target="_blank" rel="noopener" dir="ltr">' + esc(t('img_open')) + '</a>' +
                ' · <button class="link" data-act="prod-image-clear" data-id="' + p.id + '">' + esc(t('img_remove')) + '</button>'
              : '<button class="link" data-act="prod-image">' + esc(t('img_add')) + '</button>') +
          '</div>'
        : '') +
      '</div>' +
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

  /* 058 — stock as a colour × size matrix. Read-only: stock moves through
     the movement log, never by typing over a number here. */
  body += ColourForm.matrix(p);

  var many = (p.colours || []).length > 1;
  if (many) {
    vs = vs.slice().sort(function (a, b) {
      var ia = p.colours.findIndex(function (c) { return c.id === a.colourId; });
      var ib = p.colours.findIndex(function (c) { return c.id === b.colourId; });
      return ia - ib;
    });
  }

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
      '<td><b style="font-family:var(--font-head);font-size:14px">' + esc(v.size) + '</b>' +
        (many && DB.colour(v.colourId) ? '<small class="line-colour" style="display:flex">' + DB.swatch(DB.colour(v.colourId)) +
          esc(DB.colourName(DB.colour(v.colourId))) + '</small>' : '') + '</td>' +
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

  /* This was a twelve-bar sparkline of 15-day buckets. Nobody standing at a
     shelf with a shoe in one hand reads a sparkline — and with no axis and
     no dates on it, it could not say WHEN anything sold. Two sentences carry
     everything it did: how many went in six months, and how the last two
     months compare. `trend` is the same series; only the reading changed. */
  var sold6 = trend.reduce(function (a, b) { return a + b; }, 0);
  /* The last four buckets are two months, the four before them the two
     before that — the series is 15-day buckets, so this is arithmetic on the
     data already in hand, not a new statistic. */
  var recent = trend.slice(-4).reduce(function (a, b) { return a + b; }, 0);
  var before = trend.slice(-8, -4).reduce(function (a, b) { return a + b; }, 0);

  body += '<div class="card mb"><div class="card-head"><h3>' + t('sales_trend') + '</h3></div>' +
    '<div class="card-body">';
  if (!sold6) {
    body += '<div class="muted">' + t('pr_none_sold') + '</div>';
  } else {
    body += '<div><b class="big">' + nf(sold6) + '</b> ' + t('pr_sold_6m') + '</div>' +
      '<div class="muted small mt">' +
        t('pr_last_2m')
          .replace('{a}', '<bdi dir="ltr">' + nf(recent) + '</bdi>')
          .replace('{b}', '<bdi dir="ltr">' + nf(before) + '</bdi>') +
      '</div>';
  }
  body += '</div></div>';

  body += '<div class="card"><div class="card-body"><dl class="kv">' +
    '<dt>' + t('brand') + '</dt><dd>' + esc(p.brand) + '</dd>' +
    '<dt>' + t('made_in') + '</dt><dd>' + esc(p.madeIn) + '</dd>' +
    '<dt>' + t('colour') + '</dt><dd>' + esc(p.colorway) + '</dd>' +
    (seesCost() ? '<dt>' + t('cost_price') + '</dt><dd>' + money(p.costPrice) + '</dd>' : '') +
    '<dt>' + t('selling_price') + '</dt><dd>' + money(p.sellingPrice) + '</dd>' +
    '<dt>' + t('last_sold') + '</dt><dd>' + p.lastSoldDaysAgo + ' ' + t('days_ago') + '</dd>' +
    /* TWO COLUMNS, TWO QUESTIONS, AND THEY USED TO SHARE A WORD (ns02).
       `t('visible')` is "On website" and labels the Products column and the
       edit checkbox, both of which write `on_web`. This row printed `hidden`
       — the ARCHIVE flag — under the same word, so an archived product read
       "On website: No" and a product deliberately taken off the site read
       "On website: Yes". Opposite claims under one label. They are two rows
       now, each saying which question it is answering. */
    '<dt>' + t('pr_on_web') + '</dt><dd>' + (p.onWeb === false ? t('no') : t('yes')) + '</dd>' +
    '<dt>' + t('pr_selling') + '</dt><dd>' + (p.hidden
      ? '<span class="warn">' + t('pr_archived') + '</span>'
      : t('yes')) + '</dd>' +
  '</dl></div></div>';

  /* THE THREE QUICK EDITS FIRST (ns03). Changing a price is much the
     commonest reason this drawer is opened and it took the whole nine-field
     editor; adding a size or a colour was behind a button captioned "Add
     more", then a segmented control. The rest — the full editor, stopping
     the line, the two exports — is under the "…", which is where the
     deliveries board put everything that is not the next step. */
  body += '<div class="pr-acts">' +
    (allow('product.write')
      ? '<button class="btn btn-primary" data-act="pq-open" data-id="' + p.id + '">' + t('pr_change_price') + '</button>' +
        '<button class="btn" data-cf="add-more" data-pid="' + p.id + '" data-m="size">' + t('pr_add_size') + '</button>' +
        '<button class="btn" data-cf="add-more" data-pid="' + p.id + '" data-m="colour">' + t('pr_add_colour') + '</button>'
      : '') +
    /* ONE print button. There were two here — this one drove the browser
       Label Studio (SKU text in the bars) and a second opened the 60x40
       layout in js/labels60.js — beside the per-size buttons in the table
       above, which printed a third way. All of them now open the same size
       picker and the same template preview; the 60x40 template carries the
       shelf slot the second button existed for. */
    (allow('label.print')
      ? '<button class="btn" data-act="labels-for" data-id="' + p.id + '">' + t('print_labels') + '</button>'
      : '') +
    /* Everything that is not one of today's jobs. The menu is markup that
       is already here, shown by a class — the drawer repaints on every save
       and a popover built on click would be rebuilt out from under an open
       one, which is the Safeers card menu's lesson. */
    '<div class="pr-more">' +
      '<button class="btn btn-ghost pr-dots" data-act="pr-menu" aria-label="' + esc(t('cb_more')) + '">…</button>' +
      '<div class="pr-menu">' +
        (allow('product.write')
          ? '<button class="pr-mitem" data-act="prod-edit" data-id="' + p.id + '">' + t('edit_product') + '</button>'
          : '') +
        (allow('product.write')
          ? '<button class="pr-mitem" data-act="' + (p.archived ? 'pr-resume' : 'pr-stop') + '" data-id="' + p.id + '">' +
              t(p.archived ? 'pr_sell_again' : 'pr_stop_selling') + '</button>'
          : '') +
        '<button class="pr-mitem" data-act="export-rec" data-rec="product" data-kind="pdf" data-id="' + p.id + '">' + t('rec_stock_sheet') + '</button>' +
        '<button class="pr-mitem" data-act="export-rec" data-rec="product" data-kind="excel" data-id="' + p.id + '">' + t('export_excel') + '</button>' +
      '</div>' +
    '</div>' +
  '</div>';

  openDrawer({ head: head, body: body, onOpen: function (root) {
    var input = root.querySelector('#prodFile');
    if (!input) return;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      readImageFile(file, function (src, err) {
        if (err) { toast(t('image'), t('up_err_' + err), 'err', 4000); return; }
        uploadProductImage(p.id, src, function () { openProductDrawer(p.id); });
      });
    });
  } });
}


/* ---- edit a product, in place ---------------------------------------------
   The drawer's Edit button used to send somebody to the Add-product page,
   which is a form for a product that does not exist yet and therefore arrived
   empty. This is a modal over the drawer with every field the server lets a
   product change (EDITABLE in server/lib/catalogue.js), and the drawer is
   reopened where it was once the save lands.

   Prices are edited in the product's OWN currency (srcCurrency, in its minor
   units): a dollar-priced shoe must save back as dollars, or one trip through
   the editor silently repegs it at today's rate. USD is shown in dollars and
   stored in cents; SYP is whole lira both ways. Sizes and stock are not here
   on purpose — stock moves through the warehouse's own log, never by typing
   over a number. */
function openProductEditor(pid) {
  var p = DB.product(pid);
  if (!p) return;
  if (!allow('product.write')) { toast(t('edit_product'), t('no_access'), 'err'); return; }

  var cur = p.srcCurrency || CONFIG.BASE_CURRENCY || 'SYP';
  var exp = cur === 'USD' ? 2 : 0;
  var major = function (minor) {
    return minor == null ? '' : (exp ? (minor / Math.pow(10, exp)).toFixed(exp) : String(minor));
  };
  var typeOpts = DB.activeTypes([p.type]).map(function (k) {
    return '<option value="' + k + '"' + (p.type === k ? ' selected' : '') + '>' + esc(DB.typeLabels[k]) + '</option>';
  }).join('');
  var curOpts = ['SYP', 'USD'].map(function (c) {
    return '<option value="' + c + '"' + (cur === c ? ' selected' : '') + '>' + c + '</option>';
  }).join('');
  var step = exp ? '0.01' : '1';

  openModal({
    title: t('edit_product') + ' · ' + esc(p.name),
    /* EVERYDAY FIRST, THE REST BEHIND A FOLD (ns02). Nine boxes stood in one
       grid, so changing a price — much the commonest reason anybody opens
       this — meant reading past brand, made in, colourway, currency and the
       shelf zone to find it. Name, category and the two prices are the fold's
       outside; everything that changes once in a product's life is inside it.
       Nothing was removed and every id is unchanged, so readProductEditor
       still reads the same eight fields. */
    body:
      '<label class="field"><span>' + t('product_name') + '</span>' +
        '<input class="inp" id="peName" type="text" value="' + esc(p.name) + '"></label>' +
      '<div class="pe-grid">' +
        '<label class="field"><span>' + t('type') + '</span><select class="inp" id="peType">' + typeOpts + '</select></label>' +
        '<label class="field"><span>' + t('selling_price') + '</span><input class="inp num" id="pePrice" type="number" min="0" step="' + step + '" value="' + major(p.srcSellingPrice) + '"></label>' +
        (seesCost()
          ? '<label class="field"><span>' + t('cost_price') + '</span><input class="inp num" id="peCost" type="number" min="0" step="' + step + '" value="' + major(p.srcCostPrice) + '"></label>'
          : '') +
      '</div>' +
      /* The website switch says what it does. It used to be labelled
         "Visible", the same word the drawer was printing the ARCHIVE flag
         under — two opposite claims wearing one label. */
      '<label class="field pe-check"><input type="checkbox" id="peWeb"' + (p.onWeb !== false ? ' checked' : '') + '> ' +
        '<span>' + t('pr_on_web') + '</span></label>' +
      '<div class="wh-fold"><button class="wh-more-h" type="button" data-act="pe-more">' +
        t('wh_more_fields') + '<span class="wh-more-x">+</span></button>' +
        '<div class="wh-fold-b" id="peMore" hidden>' +
          '<div class="pe-grid">' +
            '<label class="field"><span>' + t('brand') + '</span><input class="inp" id="peBrand" type="text" value="' + esc(p.brand || '') + '"></label>' +
            '<label class="field"><span>' + t('made_in') + '</span><input class="inp" id="peMade" type="text" value="' + esc(p.madeIn || '') + '"></label>' +
            '<label class="field"><span>' + t('colour') + '</span><input class="inp" id="peColour" type="text" value="' + esc(p.colorway || '') + '"></label>' +
            '<label class="field"><span>' + t('currency') + '</span><select class="inp" id="peCur">' + curOpts + '</select></label>' +
            '<label class="field"><span>' + t('shelf') + '</span><input class="inp" id="peShelf" type="text" value="' + esc(p.shelfZone || '') + '"></label>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="partner-note mt">' + t('pe_note') + '</div>',
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="prod-edit-save" data-id="' + p.id + '">' + t('save') + '</button>',
    onOpen: function () {
      /* Changing the currency changes what the price boxes MEAN, so the step
         and the shown figure follow it: 2,250 lira is not $2,250. The boxes
         are cleared rather than converted — a conversion at today's rate is
         exactly the repeg the source figures exist to prevent. */
      var sel = document.getElementById('peCur');
      if (sel) sel.addEventListener('change', function () {
        var e2 = sel.value === 'USD' ? 2 : 0;
        ['peCost', 'pePrice'].forEach(function (id) {
          var el = document.getElementById(id);
          if (!el) return;
          el.step = e2 ? '0.01' : '1';
          if (sel.value !== cur) el.value = '';
          else el.value = major(id === 'peCost' ? p.srcCostPrice : p.srcSellingPrice);
        });
      });
      setTimeout(function () { var n = document.getElementById('peName'); if (n) { n.focus(); n.select(); } }, 30);
    }
  });
}

/* What the modal says, turned into the PATCH body. Prices go back as minor
   units of the chosen currency; a blank cost is left alone rather than
   written as zero, because zero is a claim about what the shop paid. */
function readProductEditor() {
  var g = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; };
  var cur = g('peCur') || 'SYP';
  var exp = cur === 'USD' ? 2 : 0;
  /* Desk.toMinor, NOT Number(String(v).replace(',', '.')) — which turned
     "120,000" into 120.000 and saved a 120,000-lira shoe at ONE HUNDRED
     AND TWENTY. The same bug as the shift boxes, on the screen where a
     price is actually typed. One parser, and it reads every digit somebody
     might use. */
  var minor = function (v) {
    if (v === undefined || String(v).trim() === '') return null;
    var n = Desk.toMinor(v, cur);
    return n > 0 ? n : (String(v).replace(/[^0-9]/g, '') === '' ? null : 0);
  };
  var web = document.getElementById('peWeb');
  var body = {
    name: String(g('peName') || '').trim(),
    type: g('peType'),
    brand: String(g('peBrand') || '').trim(),
    made_in: String(g('peMade') || '').trim(),
    colorway: String(g('peColour') || '').trim(),
    shelf_zone: String(g('peShelf') || '').trim(),
    currency: cur,
    on_web: web && web.checked ? 1 : 0
  };
  var price = minor(g('pePrice'));
  if (price !== null) body.selling_price = price;
  var cost = minor(g('peCost'));
  if (cost !== null) body.cost_price = cost;
  return body;
}
/* ---- change the price, and nothing else ---------------------------------
   Changing a price was the commonest reason the drawer was opened and it
   took the whole edit modal — nine fields, one of which was the one wanted.
   This is that one field, in the product's OWN currency and saying which,
   because a dollar-priced shoe saved back as lira is a silent repeg at
   today's rate (the reason srcCurrency exists at all). */
function openQuickPrice(pid) {
  var p = DB.product(pid);
  if (!p) return;
  if (!allow('product.write')) { toast(t('pr_change_price'), t('no_access'), 'err'); return; }
  var cur = p.srcCurrency || CONFIG.BASE_CURRENCY || 'SYP';

  openModal({
    title: t('pr_change_price'), size: 'narrow',
    body: '<div class="pq-who">' + thumb(p) + '<span><b>' + esc(p.name) + '</b>' +
        '<small>' + dots(esc(p.brand), esc(p.colorway)) + '</small></span></div>' +
      '<label class="field cb-big mt"><span>' + t('selling_price') + ' · <bdi dir="ltr">' + esc(cur) + '</bdi></span>' +
        '<input class="inp num cb-big-in" id="pqPrice" type="text" inputmode="decimal" dir="ltr" ' +
          'autocomplete="off" data-change="pq-price" value="' + esc(srcWhole(p.srcSellingPrice, cur)) + '"></label>' +
      '<div class="cb-result" id="pqNow"></div>',
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
      '<button class="btn btn-primary" data-act="pq-save" data-id="' + p.id + '" data-cur="' + esc(cur) + '">' +
        t('save') + '</button>',
    onOpen: function () {
      quickPriceHint();
      if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) {
        var el = document.getElementById('pqPrice');
        if (el) { try { el.focus(); el.select(); } catch (e) {} }
      }
    }
  });
}

/* The stored minor units as a person writes them — whole lira, or dollars
   with their cents. */
function srcWhole(minor, cur) {
  var n = Number(minor) || 0;
  if (!n) return '';
  return cur === 'USD' ? (n / 100).toFixed(n % 100 ? 2 : 0) : String(n);
}

/* What will be true afterwards: the old price, the new one, and — only for
   somebody allowed the numbers — what it does to the margin. */
function quickPriceHint() {
  var host = document.getElementById('pqNow');
  var box = document.getElementById('pqPrice');
  if (!host || !box) return;
  var btn = document.querySelector('[data-act="pq-save"]');
  var p = DB.product(+(btn ? btn.getAttribute('data-id') : 0));
  if (!p) return;
  var cur = btn.getAttribute('data-cur');
  var now = Desk.toMinor(box.value, cur);
  var was = Number(p.srcSellingPrice) || 0;

  if (!now) { host.className = 'cb-why'; host.innerHTML = t('price_required'); return; }
  host.className = 'cb-result';
  var line = t('pr_price_was').replace('{was}', Desk.fmt(was, cur)).replace('{now}', Desk.fmt(now, cur));
  if (seesProfit() && p.srcCostPrice > 0) {
    line += ' · ' + t('margin') + ' ' + pct((now - p.srcCostPrice) / now * 100, 0);
  }
  host.innerHTML = line;
}

/* The drawer's "…", closed by a press anywhere else. Bound once, at the
   document, in the CAPTURE phase so it runs before the delegated dispatcher
   decides what the press meant — the same shape the deliveries board's row
   menu uses, and for the same reason. */
function closePrMenus() {
  document.querySelectorAll('.pr-more.is-menu').forEach(function (m) { m.classList.remove('is-menu'); });
}
function bindPrMenuClose() {
  if (bindPrMenuClose._on) return;
  bindPrMenuClose._on = true;
  document.addEventListener('click', function (e) {
    var inside = e.target.closest && e.target.closest('.pr-more');
    if (!inside) closePrMenus();
    else if (e.target.closest('.pr-mitem')) setTimeout(closePrMenus, 0);
  }, true);
}
