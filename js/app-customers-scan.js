/* ==========================================================================
   OG SYSTEM — application shell  ·  9/17: CUSTOMERS + duplicate guard +
   SCAN → PRODUCT + REORDER
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 3684-4282). Loads after
   app-warehouse.js.
   ========================================================================== */

/* ------------------------------------------------------------- 10. CUSTOMERS */

/* The filtered customer list, shared by the view and by bulk select-all so
   "select all" can never grab more than the filter is showing. */
function customerRows() {
  var f = OG.cust;
  var list = DB.customers.filter(function (c) { return f.filter === 'archived' ? c.archived : !c.archived; });
  /* Somebody who has never bought is not "at risk" — there is nothing to lose
     yet. null from daysSince is that person, and is left out on purpose. */
  if (f.filter === 'risk') list = list.filter(function (c) {
    var n = DB.daysSince(c.lastPurchaseDate);
    return n !== null && n >= 90;
  });
  if (f.filter === 'gold') list = list.filter(function (c) { return DB.tier(c.loyaltyPoints) === 'gold'; });
  if (f.q) {
    var q = f.q.toLowerCase();
    list = list.filter(function (c) {
      return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q) > -1 || c.city.toLowerCase().indexOf(q) > -1;
    });
  }
  return list.sort(function (a, b) { return b.totalSpent - a.totalSpent; });
}

function viewCustomers() {
  var list = customerRows();
  var risk = DB.inactiveCustomers(90).length;

  var h = '<div class="page-head"><div><h1>' + t('customers_title') + '</h1>' +
    '<div class="sub">' + t('customers_sub') + '</div></div>' +
    '<div class="head-actions">' +
      '<span class="badge critical">' + risk + ' ' + t('at_risk') + '</span>' +
      (allow('customer.write')
        ? '<button class="btn btn-primary btn-sm" data-act="cu-new">+ ' + t('cu_new') + '</button>'
        : '') +
      exportButtons() +
    '</div></div>';

  h += '<div class="filters">' +
    '<input class="inp grow" type="text" placeholder="' + t('search_ph') + '" value="' + esc(OG.cust.q) + '" data-change="cust-q">' +
    '<div class="chip-row">' +
      '<button class="chip ' + (OG.cust.filter === 'all' ? 'on' : '') + '" data-act="cust-filter" data-f="all">' + t('all_customers') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'risk' ? 'on' : '') + '" data-act="cust-filter" data-f="risk">' + t('risk_only') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'gold' ? 'on' : '') + '" data-act="cust-filter" data-f="gold">' + t('gold_only') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'archived' ? 'on' : '') + '" data-act="cust-filter" data-f="archived">' + t('bk_archived_only') + '</button>' +
    '</div>' +
    '<span class="badge neutral">' + list.length + ' / ' + DB.customers.length + '</span></div>';

  h += '<div class="cust-grid">';
  list.forEach(function (c, ci) {
    var since = DB.daysSince(c.lastPurchaseDate);     /* null = never bought */
    var atRisk = since !== null && since >= 90;
    var tier = DB.tier(c.loyaltyPoints);
    h += '<div class="cust-card' + (atRisk ? ' risk' : '') + (Bulk.has('customers', c.id) ? ' bk-on' : '') +
         '" data-act="open-customer" data-id="' + c.id + '">' +
      '<span class="bk-corner">' + Bulk.box('customers', c.id, ci) + '</span>' +
      '<div class="cc-top"><span class="cc-av">' + esc(c.name.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('')) + '</span>' +
        '<div style="flex:1;min-width:0"><b>' + esc(c.name) + '</b>' +
        '<small class="num">' + tel(c.phone) + '</small>' +
        '<small>' + esc(c.city) + ' · ' + t(c.source === 'online' ? 'online' : 'in_store') + '</small></div>' +
        '<span class="badge ' + tier + '">' + t(tier) + '</span>' +
      '</div>' +
      '<div class="cc-stats">' +
        '<div><span class="eyebrow">' + t('total_spent') + '</span><b>' + moneyShort(c.totalSpent) + '</b></div>' +
        '<div><span class="eyebrow">' + t('loyalty') + '</span><b>' + nf(c.loyaltyPoints) + '</b></div>' +
        '<div><span class="eyebrow">' + t('orders') + '</span><b>' + c.history.length + '</b></div>' +
        '<div><span class="eyebrow">' + t('last_purchase') + '</span><b style="font-size:11.5px;font-weight:700">' + relDate(c.lastPurchaseDate) + '</b></div>' +
      '</div>' +
      (atRisk
        ? '<div style="display:flex;gap:6px;align-items:center">' +
            '<span class="badge critical">' + t('at_risk') + '</span>' +
            '<button class="btn btn-sm btn-primary" style="margin-inline-start:auto" data-act="whatsapp" data-id="' + c.id + '">' + t('send_whatsapp') + '</button>' +
          '</div>'
        : '') +
    '</div>';
  });
  h += '</div>';
  return h;
}

function openCustomerDrawer(cid) {
  var c = DB.customer(cid);
  if (!c) return;
  var invoices = c.history.map(function (id) { return DB.sale(id); }).filter(Boolean)
    .sort(function (a, b) { return b.date - a.date; });

  /* Infer the sizes this customer actually buys, split by category family. */
  var sizeCount = {};
  invoices.forEach(function (s) {
    s.items.forEach(function (it) {
      var fam = (it.type === 'sneakers' || it.type === 'boots' || it.type === 'crocs') ? 'Footwear'
              : (it.type === 'jeans' ? 'Jeans' : 'Tops');
      sizeCount[fam] = sizeCount[fam] || {};
      sizeCount[fam][it.size] = (sizeCount[fam][it.size] || 0) + it.qty;
    });
  });

  var tier = DB.tier(c.loyaltyPoints);
  var since = DB.daysSince(c.lastPurchaseDate);      /* null = never bought */
  var atRisk = since !== null && since >= 90;

  var head =
    '<div style="display:flex;gap:12px;align-items:flex-start;flex:1">' +
      '<span class="cc-av" style="width:52px;height:52px;font-size:18px">' +
        esc(c.name.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('')) + '</span>' +
      '<div><span class="eyebrow">' + esc(c.city) + ' · ' + t(c.source === 'online' ? 'online' : 'in_store') + '</span>' +
        '<h3 style="font-size:19px;margin:3px 0 5px">' + esc(c.name) + '</h3>' +
        '<span class="badge ' + tier + '">' + t(tier) + '</span> ' +
        (atRisk ? '<span class="badge critical">' + t('at_risk') + '</span>' : '') +
        ' <span class="badge neutral num">' + tel(c.phone) + '</span></div>' +
    '</div>';

  var body = '<div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">' +
    '<div class="stat"><span class="eyebrow">' + t('total_spent') + '</span><div class="val">' + moneyShort(c.totalSpent) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('loyalty') + '</span><div class="val accent">' + nf(c.loyaltyPoints) + '</div>' +
      '<div class="foot">= ' + money(c.loyaltyPoints * CONFIG.LOYALTY_POINT_VALUE) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('last_purchase') + '</span><div class="val" style="font-size:15px">' + relDate(c.lastPurchaseDate) + '</div>' +
      '<div class="foot">' + fmtDate(c.lastPurchaseDate) + '</div></div>' +
  '</div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('preferred_sizes') + '</h3>' +
    '<div class="card-actions muted small">' + (OG.lang === 'ar' ? 'مستنتجة من المشتريات' : 'inferred from purchases') + '</div></div><div class="card-body">';
  var fams = Object.keys(sizeCount);
  if (fams.length) {
    body += '<div style="display:flex;gap:18px;flex-wrap:wrap">';
    fams.forEach(function (f) {
      var best = Object.keys(sizeCount[f]).sort(function (a, b) { return sizeCount[f][b] - sizeCount[f][a]; })[0];
      body += '<div><span class="eyebrow">' + f + '</span>' +
        '<div class="strong-num" style="font-size:24px">' + best + '</div>' +
        '<small class="muted">' + sizeCount[f][best] + ' ' + t('units').toLowerCase() + '</small></div>';
    });
    body += '</div>';
  } else {
    body += '<span class="muted">' + t('none') + '</span>';
  }
  body += '</div></div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('purchase_history') + '</h3>' +
    '<div class="card-actions"><span class="badge neutral">' + invoices.length + '</span></div></div>' +
    '<div class="table-wrap" style="max-height:250px;overflow-y:auto"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('invoice') + '</th><th>' + t('date') + '</th><th>' + t('items') + '</th><th class="num">' + t('total') + '</th>' +
    '</tr></thead><tbody>';
  invoices.forEach(function (s) {
    body += '<tr class="clickable" data-act="open-invoice" data-id="' + s.id + '">' +
      '<td><b>' + s.id + '</b></td><td class="muted num">' + fmtDate(s.date) + '</td>' +
      '<td class="muted">' + s.items.map(function (i) { return esc(i.name) + ' (' + i.size + ')'; }).join(', ').slice(0, 46) + '</td>' +
      '<td class="num"><b>' + money(s.total) + '</b></td></tr>';
  });
  body += '</tbody></table></div></div>';

  body += '<div class="card"><div class="card-head"><h3>' + t('points_timeline') + '</h3></div><div class="card-body">' +
    '<ul class="timeline" style="margin:0;padding-inline-start:14px">';
  invoices.slice(0, 6).forEach(function (s) {
    body += '<li class="plus"><b>+' + nf(s.pointsEarned) + ' ' + t('points') + '</b>' +
      '<small>' + s.id + ' · ' + fmtDate(s.date) + ' · ' + money(s.total) + '</small></li>';
  });
  body += '</ul></div></div>';

  body += '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="customer" data-kind="pdf" data-id="' + c.id + '">' + t('rec_statement') + '</button>' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="customer" data-kind="excel" data-id="' + c.id + '">' + t('export_excel') + '</button>' +
  '</div>';

  if (atRisk) {
    body += '<button class="btn btn-primary btn-block btn-lg mt" data-act="whatsapp" data-id="' + c.id + '">' + t('send_whatsapp') + '</button>';
  }

  openDrawer({ head: head, body: body });
}

/* Routed through the WA layer so the Send button opens a real conversation
   instead of raising a toast and discarding the message. */
function openWhatsapp(cid) {
  var c = DB.customer(cid);
  WA.compose({
    title: t('whatsapp_msg') + ' · ' + esc(c.name),
    to: c.phone,
    name: c.name,
    kind: 'winback',
    text: WA.templates.winback(c),
    note: OG.lang === 'ar'
      ? 'آخر شراء: ' + relDate(c.lastPurchaseDate) + ' · إجمالي الإنفاق ' + money(c.totalSpent)
      : 'Last purchase ' + relDate(c.lastPurchaseDate) + ' · lifetime ' + money(c.totalSpent)
  });
}

/* -------------------------------------------------- DUPLICATE PRODUCT GUARD
   Shown before a near-identical product is created. It offers the useful
   action first — open the one that already exists and add stock to it —
   because that is almost always what he actually meant to do. */
function openDuplicateGuard(name, dupes) {
  var h = '<div class="yl-block" style="margin-bottom:14px">' +
    '<span class="yb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square">' +
      '<path d="M12 8v5M12 16h.01M10.3 3.9L2.4 18a1.9 1.9 0 0 0 1.7 2.9h15.8a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z"/>' +
    '</svg></span>' +
    '<span class="yb-txt"><b>' + t('dup_head') + '</b>' +
      '<small>' + t('dup_sub') + '</small></span></div>';

  h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t('product') + '</th><th class="num">' + t('in_stock') + '</th>' +
    '<th class="num">' + t('price') + '</th><th class="num">' + t('dup_match') + '</th><th></th>' +
  '</tr></thead><tbody>';
  dupes.slice(0, 5).forEach(function (d) {
    var p = d.product;
    h += '<tr><td><div class="cell-prod">' + thumb(p) +
        '<span><b>' + esc(p.name) + '</b><small>' + esc(p.brand) + ' · ' + esc(p.colorway) + '</small></span></div></td>' +
      '<td class="num">' + healthBadge(DB.totalQty(p.id)) + ' ' + DB.totalQty(p.id) + '</td>' +
      '<td class="num">' + money(p.sellingPrice) + '</td>' +
      '<td class="num"><b>' + Math.round(d.score * 100) + '%</b></td>' +
      '<td><button class="btn btn-sm btn-primary" data-act="dup-open" data-id="' + p.id + '">' +
        t('dup_use') + '</button></td></tr>';
  });
  h += '</tbody></table></div></div>';

  h += '<div class="partner-note mt">' + t('dup_note').replace('{n}', esc(name)) + '</div>';

  openModal({
    title: t('dup_title'), size: 'wide', body: h,
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn" data-act="dup-anyway">' + t('dup_anyway') + '</button>'
  });
}

/* ======================================================== SCAN → PRODUCT
   "when they scan will appear all details from this product, how many exist,
   available sizes" — this is that screen.

   It accepts anything a label can carry: an EAN-13, a SKU, a deep link from a
   QR, or an invoice number. Whatever comes back from the camera is resolved
   here rather than in the scanner, so every entry point behaves identically. */
function resolveScan(raw) {
  var code = String(raw || '').trim();
  if (!code) return null;

  /* A QR on a label or a printed document carries a deep link. */
  var m = /#open\/([a-z]+)\/(.+)$/.exec(code);
  if (m) return { kind: 'route', hash: '#open/' + m[1] + '/' + m[2] };

  var v = DB.variantByBarcode(code);
  if (v) return { kind: 'variant', variant: v };

  v = DB.variantBySku(code);
  if (v) return { kind: 'variant', variant: v };

  /* The numeric code printed under a thermal label's Code128 barcode —
     matching it here is the other half of "scanning must match printing":
     server/lib/catalogue.js's byBarcode() checks the same three fields for
     a real server. */
  v = DB.variantByLabelCode(code);
  if (v) return { kind: 'variant', variant: v };

  var sale = DB.sale(code);
  if (sale) return { kind: 'invoice', sale: sale };

  var job = DB.job(code);
  if (job) return { kind: 'job', job: job };

  /* Bare SKU prefix — the label may have been cropped. */
  var partial = DB.variants.filter(function (x) {
    return x.sku.toLowerCase().indexOf(code.toLowerCase()) === 0;
  })[0];
  if (partial) return { kind: 'variant', variant: partial };

  return null;
}

/* A scanned code that matches nothing — printing a code the till can't
   resolve is the worst failure here, it stops a sale with a customer
   standing there. Rather than a dead-end error, offer to attach the code
   to whichever product it actually belongs to (a supplier barcode typed by
   hand, or a label whose code was never recorded). */
function attachResultsHTML(q, code) {
  var query = String(q || '').trim().toLowerCase();
  if (query.length < 2) return '<p class="small muted">' + t('lbl_attach_search') + '</p>';
  var hits = DB.variants.filter(function (v) {
    var p = DB.product(v.productId);
    return p && (p.name.toLowerCase().indexOf(query) > -1 || v.sku.toLowerCase().indexOf(query) > -1);
  }).slice(0, 12);
  if (!hits.length) return '<p class="small muted">' + t('none') + '</p>';
  return hits.map(function (v) {
    var p = DB.product(v.productId);
    return '<div class="rule-row"><div class="rr-txt"><b>' + esc(p.name) + '</b>' +
      '<small>' + esc(v.sku) + ' · ' + t('size') + ' ' + esc(v.size) + '</small></div>' +
      '<button class="btn btn-sm btn-primary" data-act="variant-attach-save" data-sku="' + esc(v.sku) +
        '" data-code="' + esc(code) + '">' + t('lbl_attach_save') + '</button></div>';
  }).join('');
}

function openUnknownCodeModal(code) {
  openModal({
    title: t('lbl_unknown_code'),
    body: '<p class="num" style="margin-top:0">' + esc(code) + '</p>' +
      '<label class="field"><span>' + t('lbl_attach_code') + '</span>' +
      '<input class="inp" id="attachSearchInp" data-change="attach-search" placeholder="' + esc(t('lbl_attach_search')) + '" autocomplete="off"></label>' +
      '<div id="attachSearchResults" data-code="' + esc(code) + '">' + attachResultsHTML('', code) + '</div>',
    foot: '<button class="btn btn-primary" data-act="modal-close">' + t('close') + '</button>'
  });
  setTimeout(function () { var el = document.getElementById('attachSearchInp'); if (el) el.focus(); }, 60);
}

/* The product sheet a scan lands on: the size that was scanned, every other
   size with its stock, where each one sits, and what to do next. */
function openScanResult(raw) {
  var found = resolveScan(raw);

  if (!found) {
    openUnknownCodeModal(String(raw).slice(0, 40));
    return;
  }
  if (found.kind === 'route')   { handleDeepLink(found.hash); return; }
  if (found.kind === 'invoice') { openInvoice(found.sale); return; }
  if (found.kind === 'job')     { openJobDrawer(found.job.id); return; }

  var v = found.variant;
  var p = DB.product(v.productId);
  var vs = DB.variantsOf(p.id);
  var total = DB.totalQty(p.id);
  var gaps = DB.sizeGaps(p.id);
  var rate = DB.weeklyRate(p.id, v.size);
  var cover = DB.daysOfCover(v);

  /* thumbBox, not thumb: a two-letter chip cannot tell two similar shoes
     apart, and the first question with a box in hand is "is this the right
     one?". thumbBox already shows the uploaded photo when there is one and
     falls back to the colour block when there is not. */
  var h = '<div class="sc-hit">' +
    thumbBox(p, 'sc-photo') +
    '<div class="sc-hit-txt"><b>' + esc(p.name) + '</b>' +
      '<span>' + esc(p.brand) + ' · ' + DB.typeLabels[p.type] + ' · ' + esc(p.colorway) + '</span>' +
      '<span class="num">' + esc(v.barcode) + '</span>' +
      '<span class="num sc-sku">' + esc(v.sku) + '</span></div>' +
    healthBadge(v.qty) +
  '</div>';

  /* The scanned size first and loudest — that is the one in his hand. */
  h += '<div class="grid mt" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
    '<div class="stat"><span class="eyebrow">' + t('sc_this_size') + '</span>' +
      '<div class="val accent">' + v.size + '</div>' +
      '<div class="foot">' + v.qty + ' ' + t('in_stock') + ' · ' + esc(v.shelf) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('total_stock') + '</span>' +
      '<div class="val">' + nf(total) + '</div>' +
      '<div class="foot">' + vs.length + ' ' + t('sizes').toLowerCase() + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('price') + '</span>' +
      '<div class="val">' + moneyStat(p.sellingPrice) + '</div>' +
      '<div class="foot">' + t('margin') + ' ' +
        pct((p.sellingPrice - p.costPrice) / p.sellingPrice * 100, 0) + '</div></div>' +
  '</div>';

  /* How this size is actually moving. cover and rate were already computed
     above and then thrown away unless cover < 21 — which meant the sheet went
     quiet exactly when the news was good. Both are now always shown. */
  var lastSold = DB.lastSoldFor(p.id, v.size);
  h += '<div class="grid mt" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
    '<div class="stat"><span class="eyebrow">' + t('sc_sells') + '</span>' +
      '<div class="val" style="font-size:20px">' +
        (rate > 0 ? (Math.round(rate * 10) / 10) + '<span class="cur">/' + t('po_week') + '</span>' : '—') +
      '</div><div class="foot">' + t('sc_last_8w') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('sc_cover') + '</span>' +
      '<div class="val' + (cover !== Infinity && cover < 21 ? ' warn' : '') + '" style="font-size:20px">' +
        coverText(cover) +
      '</div><div class="foot">' + (cover === Infinity ? t('sc_not_moving') : t('sc_at_this_rate')) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('last_sold') + '</span>' +
      '<div class="val" style="font-size:20px">' +
        /* A dash, never "today" — a size that has never sold must not be
           mistaken for one that sold this morning. */
        (lastSold ? relDate(lastSold) : '—') +
      '</div><div class="foot">' + (lastSold ? fmtDate(lastSold) : t('sc_never_sold')) + '</div></div>' +
  '</div>';

  if (cover !== Infinity && cover < 21) {
    h += '<div class="yl-block mt"><span class="yb-txt"><b>' +
      t('sc_running_out').replace('{d}', cover) + '</b><small>' +
      (Math.round(rate * 10) / 10) + ' ' + t('sc_per_week') + '</small></span>' +
      '<button class="btn btn-sm btn-primary" data-act="reorder" data-id="' + p.id + '">' +
        t('reorder') + '</button></div>';
  }

  /* Every size, so he can answer "do you have it in 43?" without walking. */
  h += '<div class="card mt"><div class="card-head"><h3>' + t('sc_all_sizes') + '</h3>' +
    (gaps.length ? '<div class="card-actions"><span class="badge critical">' +
       t('size_gap') + ': ' + gaps.join(', ') + '</span></div>' : '') + '</div>' +
    '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('size') + '</th><th class="num">' + t('qty') + '</th>' +
      '<th class="num">' + t('wh_split_hint') + '</th>' +
      '<th>' + t('shelf') + '</th><th>' + t('health') + '</th><th class="num">' + t('po_rate') + '</th>' +
    '</tr></thead><tbody>';
  vs.forEach(function (x) {
    var xr = DB.weeklyRate(p.id, x.size);
    h += '<tr' + (x.sku === v.sku ? ' class="sc-row-on"' : '') + '>' +
      '<td><b>' + x.size + '</b>' + (x.sku === v.sku ? ' <span class="badge accent">' + t('sc_scanned') + '</span>' : '') + '</td>' +
      '<td class="num"><b>' + x.qty + '</b></td>' +
      /* Split by place, because "we have 8" is useless if all 8 are in the
         back and the customer is standing at the shelf. */
      '<td class="num">' + DB.stockAt(x, 'floor') + ' / ' + DB.stockAt(x, 'store') + '</td>' +
      '<td class="muted">' + esc(x.shelf) + '</td>' +
      '<td>' + healthBadge(x.qty) + '</td>' +
      '<td class="num muted">' + (xr > 0 ? (Math.round(xr * 10) / 10) + '/' + t('po_week') : '—') + '</td>' +
    '</tr>';
  });
  h += '</tbody></table></div></div>';

  /* ---- where it comes from ----------------------------------------------
     Deliberately below the size table rather than beside the selling price:
     this card carries the COST, and a glance at the top of the sheet across
     the counter should not tell a customer what the shoe cost. */
  var sup = DB.supplierFor(p);
  var deliv = DB.lastDelivery(p.id);
  h += '<div class="card mt"><div class="card-head"><h3>' + t('sc_sourcing') + '</h3>' +
    '<div class="card-actions muted small">' + esc(p.madeIn) + '</div></div>' +
    '<div class="card-body"><div class="sc-src">' +
      '<div><span class="eyebrow">' + t('supplier') + '</span>' +
        '<b>' + esc(sup ? sup.name : '—') + '</b>' +
        '<small class="muted num">' + esc(sup ? sup.contact : '') + '</small></div>' +
      '<div><span class="eyebrow">' + t('cost') + '</span>' +
        '<b>' + money(p.costPrice) + '</b>' +
        '<small class="muted">' + t('margin') + ' ' + money(p.sellingPrice - p.costPrice) + '</small></div>' +
      '<div><span class="eyebrow">' + t('sc_last_delivery') + '</span>' +
        '<b>' + (deliv ? fmtDate(deliv.date) : '—') + '</b>' +
        '<small class="muted">' + (deliv
          ? '+' + deliv.delta + ' · ' + esc(DB.whName(deliv.wh, OG.lang === 'ar'))
          : t('sc_no_delivery')) + '</small></div>' +
    '</div></div></div>';

  /* ---- where the pieces went --------------------------------------------
     The same audited log every sale, delivery and transfer writes to, so it
     cannot disagree with the stock figure above it. This is the card that
     answers "where did the other three go?" while the box is still in hand. */
  var moves = DB.movementsFor(v.sku, 4);
  h += '<div class="card mt"><div class="card-head"><h3>' + t('sc_recent_moves') + '</h3>' +
    '<div class="card-actions muted small">' + esc(v.sku) + '</div></div>';
  if (!moves.length) {
    h += '<div class="card-body"><span class="muted small">' + t('sc_no_moves') + '</span></div>';
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('date') + '</th><th>' + t('movement') + '</th>' +
      '<th>' + t('wh_location') + '</th><th class="num">' + t('qty') + '</th>' +
      '<th class="num">' + t('balance') + '</th><th>' + t('by') + '</th>' +
    '</tr></thead><tbody>';
    moves.forEach(function (mv) {
      h += '<tr>' +
        '<td class="nowrap muted num">' + fmtDate(mv.date) + '</td>' +
        '<td><span class="badge ' + (mv.delta > 0 ? 'healthy' : (mv.type === 'damaged' ? 'critical' : 'neutral')) +
          '">' + t(mv.type) + '</span></td>' +
        '<td>' + (mv.wh ? esc(DB.whName(mv.wh, OG.lang === 'ar')) : '<span class="muted">—</span>') + '</td>' +
        '<td class="num"><span class="mv-delta ' + (mv.delta > 0 ? 'pos' : 'neg') + '">' +
          (mv.delta > 0 ? '+' : '') + mv.delta + '</span></td>' +
        '<td class="num"><b>' + mv.balance + '</b></td>' +
        '<td class="muted small">' + esc(mv.user) + '</td>' +
      '</tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  /* ---- what to do with the thing now that it is in your hand -------------
     Every scan away from the till lands here (at the till an exact product
     code goes straight into the cart — handleScan), so this row is what the
     scanner is for on every other screen: put it away, take it out, or sell
     it. Check in and check out go through DB.moveStock — the same audited
     path the warehouse uses — so a hardware scan can never become a second
     way to change stock. */
  h += '<div class="card mt sc-do"><div class="card-head"><h3>' + t('sc_what_now') + '</h3>' +
    '<div class="card-actions muted small">' + esc(v.sku) + '</div></div><div class="card-body">' +
    '<div class="sc-qty">' +
      '<span class="lbl">' + t('qty') + '</span>' +
      '<button class="btn btn-ghost sc-step" data-act="sc-qty" data-d="-1">−</button>' +
      '<input class="inp num" id="scQty" type="number" min="1" value="1">' +
      '<button class="btn btn-ghost sc-step" data-act="sc-qty" data-d="1">+</button>' +
      '<select class="inp" id="scPlace">' +
        DB.warehouses.map(function (w) {
          return '<option value="' + w.id + '"' + (w.id === DB.defaultWh ? ' selected' : '') + '>' +
            esc(DB.whName(w.id, OG.lang === 'ar')) + ' · ' + DB.stockAt(v, w.id) + '</option>';
        }).join('') +
      '</select>' +
    '</div>' +
    /* Hint above the buttons, not below: the action row is the last thing in
       a scrolling modal, so anything after it lands on the fold and reads as
       clipped. */
    '<div class="partner-note mb">' + t('sc_enter_hint') + '</div>' +
    '<div class="sc-acts">' +
      '<button class="btn btn-ghost btn-lg" data-act="sc-out" data-sku="' + esc(v.sku) + '">' +
        t('sc_check_out') + '</button>' +
      '<button class="btn btn-ghost btn-lg" data-act="sc-in" data-sku="' + esc(v.sku) + '">' +
        t('sc_check_in') + '</button>' +
      '<button class="btn btn-primary btn-lg" id="scPrimary" data-act="scan-to-pos" data-code="' +
        esc(v.barcode) + '">' + t('sc_sell') + ' <span class="keycap">↵</span></button>' +
    '</div>' +
  '</div></div>';

  openModal({
    title: t('sc_found_title'),
    size: 'wide sc-modal',
    body: h,
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
          '<button class="btn btn-ghost" data-act="labels-for" data-id="' + p.id + '">' + t('print_labels') + '</button>' +
          '<button class="btn btn-ghost" data-act="scan-open">' + t('sc_again') + '</button>',
    onOpen: function () {
      /* Focused on open so Enter sells without a mouse — scan, Enter, done,
         with the detail still there if it is wanted. (Exact scans AT the
         till skip this sheet entirely and land in the cart; this focus
         serves every other screen, and the partial-code case where the
         sheet is the confirmation step.) */
      var b = document.getElementById('scPrimary');
      if (b) b.focus();
    }
  });
}

/* Days of cover, in the unit a shop owner actually thinks in.
   ---------------------------------------------------------------------------
   The raw figure for a slow size comes out as "252 d", which is arithmetically
   right and useless: nobody plans in 252 days, and next to a "Low" badge it
   just reads as noise. Under two months it stays in days, because that is when
   the number is actionable. Past a year it stops pretending to be a forecast —
   a size selling a quarter of a pair a week is not covered for 3 years, it is
   simply not selling. */
function coverText(days) {
  if (days === Infinity) return '—';
  if (days < 60) return days + '<span class="cur">' + t('yl_d') + '</span>';
  if (days < 365) return Math.round(days / 30) + '<span class="cur">' + t('sc_months') + '</span>';
  return '<span style="font-size:15px">' + t('sc_over_a_year') + '</span>';
}

/* How many the scan sheet is acting on. */
function scanQty() {
  var el = document.getElementById('scQty');
  var n = Math.max(1, parseInt(el && el.value, 10) || 1);
  return n;
}
function scanPlace() {
  var el = document.getElementById('scPlace');
  return (el && el.value) || DB.defaultWh;
}

/* ------------------------------------------------------------ REORDER
   The old Reorder button toasted "→ Karam Trading" and created nothing.

   It now opens the order it was pretending to place, pre-filled from real
   sales speed: how many of this exact size sell per week, how many days of
   cover are left, and a quantity that covers the next four weeks. He can
   change any of it — the point is that he does not have to start from zero
   and guess, which is the thing he does on paper today. */
function openReorder(pid) {
  var p = DB.product(pid);
  if (!p) return;
  var vs = DB.variantsOf(pid);
  var sup = DB.supplierFor(p);

  var h = '<div class="field"><span class="lbl">' + t('supplier') + '</span>' +
    '<select class="inp" id="poSupplier">' +
      DB.suppliers.map(function (s) {
        return '<option value="' + s.id + '"' + (s.id === sup.id ? ' selected' : '') + '>' +
               esc(s.name) + ' · ' + esc(s.category) + '</option>';
      }).join('') + '</select></div>';

  h += '<div class="table-wrap mt"><table class="tbl po-tbl"><thead><tr>' +
    '<th>' + t('size') + '</th><th class="num">' + t('in_stock') + '</th>' +
    '<th class="num">' + t('po_rate') + '</th><th class="num">' + t('po_cover') + '</th>' +
    '<th class="num">' + t('po_order') + '</th>' +
  '</tr></thead><tbody>';

  var sug = {}, total = 0;
  DB.reorderSuggestions().forEach(function (s) { if (s.productId === pid) sug[s.size] = s; });

  vs.forEach(function (v) {
    var s = sug[v.size];
    var rate = DB.weeklyRate(pid, v.size);
    var cover = DB.daysOfCover(v);
    var qty = s ? s.qty : 0;
    total += qty * p.costPrice;

    h += '<tr' + (v.qty === 0 ? ' class="row-late"' : '') + '>' +
      '<td><b>' + v.size + '</b></td>' +
      '<td class="num">' + healthBadge(v.qty) + ' ' + v.qty + '</td>' +
      '<td class="num muted">' + (rate > 0 ? (Math.round(rate * 10) / 10) + '/' + t('po_week') : '—') + '</td>' +
      '<td class="num ' + (cover < 14 ? 'po-urgent' : 'muted') + '">' +
        (cover === Infinity ? t('po_no_sales') : cover + t('yl_d')) + '</td>' +
      '<td class="num"><input class="inp num po-qty" type="number" min="0" value="' + qty + '" ' +
        'data-po-qty="1" data-pid="' + pid + '" data-size="' + v.size + '"></td></tr>';
  });

  h += '</tbody></table></div>' +
    '<div class="partner-note mt">' + t('po_explain') + '</div>';

  openModal({
    title: t('reorder') + ' · ' + esc(p.name),
    size: 'wide',
    body: h,
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="po-create" data-id="' + pid + '">' +
            t('po_place') + '</button>'
  });
}

/* One tap at closing time: the whole day as a message he can send to himself
   or a partner. Defaults to the shop's own number so it is one tap, not two. */
function openDaySummary() {
  var d = WA.dayStats();
  WA.compose({
    title: t('wa_day_title'),
    to: CONFIG.SHOP_PHONE,
    name: CONFIG.SHOP_NAME,
    kind: 'daily',
    text: WA.dayText(),
    note: d.count
      ? (d.count + ' ' + t('invoices').toLowerCase() + ' · ' + money(d.total))
      : t('wa_day_empty')
  });
}
