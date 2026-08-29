/* ==========================================================================
   OG SYSTEM — application shell  ·  8/17: WAREHOUSE tabs + old Label Studio
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 2802-3683). Loads after
   app-products.js. Label Studio is kept in this file (not its own split)
   because labelRows() calls whBarcode() defined earlier in the same file.
   ========================================================================== */

/* ------------------------------------------------------------- 9. WAREHOUSE */

/* 12-digit body plus a real mod-10 check digit, so warehouse labels scan too. */
function whBarcode(type, size, i) {
  var typeCode = { sneakers: '11', boots: '12', tshirts: '21', jerseys: '22', shirts: '23',
                   jackets: '24', jeans: '31', crocs: '13' }[type] || '99';
  /* 3 + 2 + 3 + 4 = exactly 12 digits before the check digit */
  var body = '621' + typeCode + pad(i, 3) +
             pad((size.charCodeAt(0) * 37 + (size.charCodeAt(1) || 7) * 11) % 10000, 4);
  return body + Codes.ean13Check(body);
}

function viewWarehouse() {
  var h = '<div class="page-head"><div><h1>' + t('warehouse_title') + '</h1>' +
    '<div class="sub">' + t('warehouse_sub') + '</div></div>' +
    '<div class="head-actions">' +
      '<span class="badge neutral">' + DB.liveVariants().length + ' SKU</span>' +
      '<span class="badge accent">' + nf(DB.liveVariants().reduce(function (a, v) { return a + v.qty; }, 0)) + ' ' + t('total_pieces').toLowerCase() + '</span>' +
      exportButtons() +
    '</div></div>';

  var openPOs = DB.purchaseOrders.filter(function (p) { return p.status !== 'received'; }).length;

  var floorGaps = DB.floorOuts().length;

  /* Which tabs this person's job includes. A cashier has stock.read and
     nothing else here: she is allowed to look in the back to answer "have you
     got it in a 42", and that is all. Receiving, moving, ordering and counting
     are somebody else's work, and a tab that opens onto a form the server will
     refuse is worse than no tab. */
  var tabs = [
    { id: 'stock', label: t('wh_stock'), dot: !!floorGaps },
    { id: 'add',   label: t('tab_add'),  need: 'product.write' },
    /* The movement log is the audit trail for receiving, transferring and
       counting. You get the history of the thing you can do — for a cashier
       looking up whether a 42 is in the back, it is a wall of somebody else's
       paperwork. */
    { id: 'moves', label: t('tab_moves'), need: 'stock.move' },
    { id: 'po',    label: t('po_title'), dot: !!openPOs, need: 'stock.move' },
    { id: 'count', label: t('st_count'), dot: !!Stock.active(), need: 'stock.count' }
  ].filter(function (x) { return !x.need || allow(x.need); });

  /* A tab bar with one tab in it is furniture. */
  if (tabs.length > 1) {
    h += '<div class="tabs">';
    tabs.forEach(function (x) {
      h += '<button class="tab ' + (OG.wh.tab === x.id ? 'on' : '') + '" data-act="wh-tab" data-tab="' + x.id + '">' +
        x.label + (x.dot ? '<span class="tab-dot"></span>' : '') + '</button>';
    });
    h += '</div>';
  }

  /* Landing on a tab that is no longer there — a remembered choice, a deep
     link — falls back to the first one she does have rather than rendering
     a blank panel under no heading. */
  var tab = OG.wh.tab;
  if (!tabs.some(function (x) { return x.id === tab; })) tab = tabs[0].id;

  h += (tab === 'stock') ? whStockTab()
     : (tab === 'add')   ? whAddTab()
     : (tab === 'po')    ? whPoTab()
     : (tab === 'count') ? Stock.view()
     : whMovesTab();
  return h;
}

/* ---- stock by place --------------------------------------------------------
   The question this page could not answer before: is that pair on the wall, or
   is it in the back? Pick a place, see every product in it, expand one to see
   the per-size breakdown for that place alone. */
function whStockTab() {
  var whId = OG.wh.place || 'all';
  var ar = OG.lang === 'ar';
  var tot = DB.whTotals(whId);
  var h = '';

  /* -- place picker -- */
  h += '<div class="seg-row mb">' +
    '<button class="seg' + (whId === 'all' ? ' on' : '') + '" data-act="wh-place" data-w="all">' +
      t('wh_all') + '</button>';
  DB.warehouses.forEach(function (w) {
    h += '<button class="seg' + (whId === w.id ? ' on' : '') + '" data-act="wh-place" data-w="' + w.id + '">' +
      esc(DB.whName(w.id, ar)) + '</button>';
  });
  h += '</div>';

  /* -- what is in the selected place -- */
  var emptyHere = DB.liveVariants().filter(function (v) {
    return (whId === 'all' ? v.qty : DB.stockAt(v, whId)) === 0;
  }).length;

  /* "Value at cost" is the capital sitting on the shelf. It is a money figure
     dressed as a stock figure, and it is the one thing on this page a cashier
     or a stock keeper has no business reading. */
  var whStats = [
    '<div class="stat"><span class="eyebrow">' + t('stock') + '</span>' +
      '<div class="val">' + nf(tot.pieces) + '</div>' +
      '<div class="foot">' + t('wh_pieces_here') + '</div></div>',
    '<div class="stat"><span class="eyebrow">' + t('sku') + '</span>' +
      '<div class="val">' + tot.skus + '</div>' +
      '<div class="foot">' + (whId === 'all' ? t('in_catalogue') : t('wh_skus_here')) + '</div></div>'
  ];
  if (seesCost()) {
    whStats.push('<div class="stat"><span class="eyebrow">' + t('wh_value_here') + '</span>' +
      '<div class="val" style="font-size:20px">' + money(tot.value) + '</div></div>');
  }
  whStats.push('<div class="stat"><span class="eyebrow">' + t('out') + '</span>' +
    '<div class="val' + (emptyHere ? ' warn' : '') + '">' + emptyHere + '</div>' +
    '<div class="foot">' + t('wh_empty_sizes') + '</div></div>');

  h += '<div class="grid stat-row mb" style="grid-template-columns:repeat(' +
       whStats.length + ',minmax(0,1fr))">' + whStats.join('') + '</div>';

  /* -- suggested moves, only where they exist -- */
  /* "Move these to the floor" is an instruction to do something. Without
     stock.move it is an instruction she cannot carry out. */
  if (whId !== 'store' && allow('stock.move')) h += whSuggestCard();

  /* -- grouped by product type: "Sneakers · 142 pieces" -- */
  var byType = {};
  /* Archived products keep their stock rows so old invoices resolve, but the
     warehouse is a list of what is here to sell — they do not belong on it. */
  DB.products.filter(function (p) { return !p.archived; }).forEach(function (p) {
    var n = DB.variantsOf(p.id).reduce(function (s, v) {
      return s + (whId === 'all' ? v.qty : DB.stockAt(v, whId));
    }, 0);
    if (!byType[p.type]) byType[p.type] = { pieces: 0, rows: [] };
    byType[p.type].pieces += n;
    byType[p.type].rows.push({ p: p, n: n });
  });

  var types = Object.keys(byType).sort(function (a, b) {
    return byType[b].pieces - byType[a].pieces;
  });

  types.forEach(function (ty) {
    var g = byType[ty];
    g.rows.sort(function (a, b) { return b.n - a.n; });

    h += '<div class="card mb"><div class="card-head">' +
      '<h3>' + esc(DB.typeLabels[ty] || ty) + '</h3>' +
      '<div class="card-actions"><span class="badge accent">' + nf(g.pieces) + ' ' +
        t('pieces').toLowerCase() + '</span></div></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>' + t('product') + '</th>' +
        '<th class="num">' + t('qty') + '</th>' +
        '<th>' + t('per_size') + '</th>' +
        '<th></th>' +
      '</tr></thead><tbody>';

    g.rows.forEach(function (r) {
      var vs = DB.variantsOf(r.p.id);
      h += '<tr' + (r.n === 0 ? ' class="row-dim"' : '') + '>' +
        '<td><div class="cell-prod">' + thumb(r.p) +
          '<span><b>' + esc(r.p.name) + '</b><small>' + esc(r.p.colorway) + '</small></span></div></td>' +
        '<td class="num"><b>' + r.n + '</b></td>' +
        '<td><div class="wh-sizes">';

      vs.forEach(function (v) {
        var here = whId === 'all' ? v.qty : DB.stockAt(v, whId);
        /* On "Everywhere" each cell reads floor/store, because the whole point
           of that view is the split, not the total. */
        var sub = whId === 'all'
          ? DB.stockAt(v, 'floor') + '/' + DB.stockAt(v, 'store')
          : String(here);
        var cls = here === 0
          ? (DB.stockElsewhere(v, whId) > 0 ? 'wh-cell elsewhere' : 'wh-cell zero')
          : 'wh-cell';
        h += '<span class="' + cls + '" title="' + esc(v.size + ' · ' + v.shelf) + '">' +
          '<b>' + v.size + '</b><i>' + sub + '</i></span>';
      });

      h += '</div></td>' +
        '<td>' + (allow('stock.move')
          ? '<button class="btn btn-sm btn-ghost" data-act="wh-transfer" data-id="' + r.p.id + '">' +
            t('wh_transfer') + '</button>'
          : '') + '</td></tr>';
    });

    h += '</tbody></table></div></div>';
  });

  return h;
}

/* Move stock between places. Every size is listed with what each place holds,
   so the choice is made against real numbers rather than from memory. */
/* ---- a person the shop has not met before ---------------------------------
   The customer list was read-only, which was survivable while it was forty
   seeded names and nothing was saved. It stopped being survivable the moment
   customers became real: the receipt prints a name and a points balance, and
   a list nobody can add to means the loyalty scheme only ever works for people
   who were already in the database.

   Deliberately three fields. This is filled in at a till with somebody waiting;
   a form asking for an address and a note is a form that gets skipped, and a
   skipped form is a walk-in sale with no customer on it. */
function openNewCustomer(prefill, onCreated) {
  if (!allow('customer.write')) { toast(t('customer'), t('no_access'), 'err'); return; }

  var name = '', phone = '';
  /* Whatever was typed into the search that found nobody. Digits are a phone
     number, anything else is a name — she has already typed it once. */
  var seed = String(prefill || '').trim();
  if (/^[\d+\s()-]+$/.test(seed) && seed.replace(/\D/g, '').length >= 3) phone = seed;
  else name = seed;

  openModal({
    title: t('cu_new'), size: 'narrow',
    body:
      '<label class="field"><span>' + t('name') + '</span>' +
        '<input class="inp" id="cuName" type="text" value="' + esc(name) + '" ' +
        'placeholder="' + esc(t('cu_name_ph')) + '"></label>' +
      '<label class="field mt"><span>' + t('phone') + '</span>' +
        '<input class="inp" id="cuPhone" type="tel" inputmode="tel" value="' + esc(phone) + '" ' +
        'placeholder="+963 9__ ___ ___"></label>' +
      '<label class="field mt"><span>' + t('city') + '</span>' +
        '<input class="inp" id="cuCity" type="text" value="' + esc(CONFIG.SHOP_CITY || 'Aleppo') + '"></label>' +
      '<div class="partner-note mt">' + t('cu_new_note') + '</div>',
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="cu-save">' + t('save') + '</button>'
  });

  /* Handed to the action rather than read back out of the DOM, because the
     modal is gone by the time the server answers. */
  OG.cuOnCreated = onCreated || null;
  setTimeout(function () {
    var el = document.getElementById(name ? 'cuPhone' : 'cuName');
    if (el) el.focus();
  }, 60);
}

function openTransfer(pid) {
  var p = DB.product(pid);
  if (!p) return;
  var ar = OG.lang === 'ar';
  var vs = DB.variantsOf(pid);

  var body = '<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">' +
    thumb(p, 'lg') + '<div><span class="eyebrow">' + esc(p.brand) + '</span>' +
    '<h3 style="font-size:16px;margin:2px 0">' + esc(p.name) + '</h3></div></div>';

  body += '<div class="lbl">' + t('size') + '</div>' +
    '<select class="inp" id="trSku">';
  vs.forEach(function (v) {
    var parts = DB.warehouses.map(function (w) {
      return DB.whName(w.id, ar) + ' ' + DB.stockAt(v, w.id);
    }).join(' · ');
    body += '<option value="' + v.sku + '">' + v.size + ' — ' + esc(parts) + '</option>';
  });
  body += '</select>';

  body += '<div class="grid mt" style="grid-template-columns:1fr 1fr;gap:10px">' +
    '<div><div class="lbl">' + t('wh_from') + '</div><select class="inp" id="trFrom">' +
      DB.warehouses.map(function (w) {
        return '<option value="' + w.id + '"' + (w.id === DB.intakeWh ? ' selected' : '') + '>' +
          esc(DB.whName(w.id, ar)) + '</option>';
      }).join('') +
    '</select></div>' +
    '<div><div class="lbl">' + t('wh_to') + '</div><select class="inp" id="trTo">' +
      DB.warehouses.map(function (w) {
        return '<option value="' + w.id + '"' + (w.id === DB.defaultWh ? ' selected' : '') + '>' +
          esc(DB.whName(w.id, ar)) + '</option>';
      }).join('') +
    '</select></div>' +
  '</div>';

  body += '<div class="mt"><div class="lbl">' + t('wh_qty_to_move') + '</div>' +
    '<input class="inp" id="trQty" type="number" min="1" value="1"></div>' +
    '<div class="partner-note mt">' + t('wh_split_hint') + '</div>';

  openModal({
    title: t('wh_transfer'),
    size: 'narrow',
    body: body,
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="wh-transfer-go">' + t('wh_move') + '</button>'
  });
}

/* The list that turns "the wall is empty" into a job someone can do. */
function whSuggestCard() {
  var all = DB.replenishSuggestions();
  /* Five, not the full list. This card sits above the stock breakdown, and a
     dozen rows pushed the thing the page is actually for off the screen. Five
     is a trip to the back room; the rest are still counted in the header. */
  var sug = all.slice(0, 5);
  if (!sug.length) {
    return '<div class="partner-note note-ok mb">' + t('wh_nothing_to_move') + '</div>';
  }

  var h = '<div class="card mb"><div class="card-head"><h3>' + t('wh_suggest') +
    '<span class="badge critical" style="margin-inline-start:8px">' + all.length + '</span></h3>' +
    '<div class="card-actions muted small">' + t('wh_suggest_sub') + '</div></div>' +
    '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('product') + '</th><th>' + t('size') + '</th>' +
      '<th class="num">' + t('wh_here') + '</th><th class="num">' + t('wh_in_the_back') + '</th>' +
      '<th class="num">' + t('po_rate') + '</th><th class="num">' + t('wh_move') + '</th><th></th>' +
    '</tr></thead><tbody>';

  sug.forEach(function (s) {
    var p = DB.product(s.productId);
    if (!p) return;
    h += '<tr class="row-late">' +
      '<td><div class="cell-prod">' + thumb(p) + '<span><b>' + esc(p.name) + '</b></span></div></td>' +
      '<td><b>' + s.size + '</b></td>' +
      '<td class="num"><span class="badge critical">0</span></td>' +
      '<td class="num"><b>' + s.back + '</b></td>' +
      /* One decimal. A single size sells a fraction of a pair per week and the
         raw figure prints as 0.375, which reads like a bug rather than a rate. */
      '<td class="num muted">' + (Math.round(s.rate * 10) / 10) + '/' + t('po_week') + '</td>' +
      '<td class="num"><b>' + s.qty + '</b></td>' +
      '<td><button class="btn btn-sm btn-primary" data-act="wh-move-now" ' +
        'data-sku="' + s.sku + '" data-n="' + s.qty + '">' + t('wh_move') + '</button></td></tr>';
  });

  return h + '</tbody></table></div></div>';
}

/* Purchase orders, plus the list of what is worth ordering next. The
   suggestion table is the useful half — it turns "something is low" into a
   ranked list of exactly what to buy and how many. */
function whPoTab() {
  var h = '';

  var sug = DB.reorderSuggestions().slice(0, 10);
  if (sug.length) {
    h += '<div class="card mb"><div class="card-head"><h3>' + t('po_suggest') + '</h3>' +
      '<div class="card-actions muted small">' + t('po_suggest_sub') + '</div></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>' + t('product') + '</th><th>' + t('size') + '</th>' +
        '<th class="num">' + t('in_stock') + '</th><th class="num">' + t('po_rate') + '</th>' +
        '<th class="num">' + t('po_cover') + '</th><th class="num">' + t('po_order') + '</th><th></th>' +
      '</tr></thead><tbody>';
    sug.forEach(function (s) {
      var p = DB.product(s.productId);
      h += '<tr class="clickable' + (s.have === 0 ? ' row-late' : '') + '" data-act="reorder" data-id="' + p.id + '">' +
        '<td><div class="cell-prod">' + thumb(p) + '<span><b>' + esc(p.name) + '</b></span></div></td>' +
        '<td><b>' + s.size + '</b></td>' +
        '<td class="num">' + healthBadge(s.have) + ' ' + s.have + '</td>' +
        '<td class="num muted">' + s.rate + '/' + t('po_week') + '</td>' +
        '<td class="num ' + (s.cover < 14 ? 'po-urgent' : 'muted') + '">' +
          (s.cover === Infinity ? '—' : s.cover + t('yl_d')) + '</td>' +
        '<td class="num"><b>' + s.qty + '</b></td>' +
        '<td onclick="event.stopPropagation()"><button class="btn btn-sm btn-primary" ' +
          'data-act="reorder" data-id="' + p.id + '">' + t('reorder') + '</button></td></tr>';
    });
    h += '</tbody></table></div></div>';
  }

  if (!DB.purchaseOrders.length) {
    return h + '<div class="card"><div class="cart-empty"><b>' + t('po_none') + '</b>' +
           t('po_none_sub') + '</div></div>';
  }

  /* A purchase order is two things at once: a list of goods to check off the
     van, and a bill. The stock keeper needs the first and not the second, so
     the tab stays and the money column goes. Hiding the whole tab instead
     would take his receiving workflow away to protect a number. */
  var poMoney = seesCost();

  h += '<div class="card table-wrap"><table class="tbl"><thead><tr>' +
    '<th>' + t('yi_invoice') + '</th><th>' + t('supplier') + '</th><th>' + t('date') + '</th>' +
    '<th class="num">' + t('pieces') + '</th>' +
    (poMoney ? '<th class="num">' + t('total') + '</th>' : '') +
    '<th>' + t('status') + '</th><th></th>' +
  '</tr></thead><tbody>';

  DB.purchaseOrders.forEach(function (po) {
    var sup = DB.supplier(po.supplierId);
    var cls = po.status === 'received' ? 'healthy' : po.status === 'sent' ? 'accent' : 'neutral';
    h += '<tr>' +
      '<td><b>' + po.id + '</b><small class="muted" style="display:block">' + esc(po.note) + '</small></td>' +
      '<td>' + esc(sup ? sup.name : '—') + '</td>' +
      '<td class="num muted">' + fmtDate(po.created) + '</td>' +
      '<td class="num">' + DB.poPieces(po) + '</td>' +
      (poMoney ? '<td class="num"><b>' + money(DB.poTotal(po)) + '</b></td>' : '') +
      '<td><span class="badge ' + cls + '">' + t('po_' + po.status) + '</span></td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm btn-ghost" data-act="po-whatsapp" data-id="' + po.id + '">' +
          t('po_whatsapp') + '</button> ' +
        (po.status !== 'received'
          ? '<button class="btn btn-sm btn-primary" data-act="po-receive" data-id="' + po.id + '">' +
              t('po_receive') + '</button>'
          : '') +
      '</td></tr>';
  });

  return h + '</tbody></table></div>';
}

function whAddTab() {
  var sizes = DB.sizeSets[OG.wh.type] || [];
  var totalPieces = 0, totalCost = 0, totalRev = 0;
  var cost = Number(document.getElementById('whCost') && document.getElementById('whCost').value) || 0;

  sizes.forEach(function (s) { totalPieces += Number(OG.wh.sizes[s] || 0); });

  var h = '<div class="grid" style="grid-template-columns:minmax(0,1fr) 330px;align-items:start">';

  /* -- form -- */
  h += '<div class="card"><div class="card-head"><h3>' + t('tab_add') + '</h3>' +
    '<div class="card-actions muted small">' + t('matrix_hint') + '</div></div><div class="card-body">';

  h += '<div class="grid" style="grid-template-columns:150px minmax(0,1fr);gap:16px;align-items:start">';

  /* Three ways in, because people reach for different ones: click to browse,
     drag a file onto the square, or just paste a screenshot. The hidden file
     input is the real control — the box is its label. */
  h += '<div><span class="lbl">' + t('image') + '</span>' +
    '<div class="upload-box' + (OG.wh.imgSrc ? ' has-img' : '') + '" id="whDrop" data-act="wh-image">' +
      (OG.wh.imgSrc
        ? '<img class="up-img" src="' + OG.wh.imgSrc + '" alt="">' +
          '<span class="up-swap">' + t('up_swap') + '</span>' +
          '<button class="up-x" data-act="wh-image-clear" title="' + esc(t('remove')) + '">✕</button>'
        : '<span class="up-empty">' +
            '<svg viewBox="0 0 24 24" stroke-linecap="square">' +
              '<path d="M3 16l5-5 4 4 3-3 6 6M3 5h18v14H3zM8.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2"/></svg>' +
            '<b>' + t('up_pick') + '</b><small>' + t('up_hint') + '</small></span>') +
    '</div>' +
    '<input type="file" id="whFile" accept="image/*" hidden>' +
  '</div>';

  h += '<div>' +
    '<label class="field"><span>' + t('product_name') + '</span>' +
      '<input class="inp" id="whName" type="text" value="' + esc(OG.wh.name) + '" placeholder="OG Heavyweight Tee" data-change="wh-name"></label>' +
    '<div class="row2">' +
      '<label class="field"><span>' + t('type') + '</span><select class="inp" data-change="wh-type">' +
        Object.keys(DB.typeLabels).map(function (ty) {
          return '<option value="' + ty + '"' + (OG.wh.type === ty ? ' selected' : '') + '>' + DB.typeLabels[ty] + '</option>';
        }).join('') + '</select></label>' +
      '<label class="field"><span>' + t('brand') + '</span><input class="inp" type="text" value="OG" placeholder="OG"></label>' +
    '</div>' +
    '<div class="' + (seesCost() ? 'row3' : 'row2') + '">' +
      '<label class="field"><span>' + t('made_in') + '</span><input class="inp" type="text" value="Syria"></label>' +
      /* Someone booking goods in without cost.read enters what the shop sells
         it for, not what it was bought for. The field is left out rather than
         disabled, because a disabled box invites a guess — and a guessed cost
         price is worse than a missing one: it quietly poisons every margin
         and profit figure the manager reads afterwards. */
      (seesCost()
        ? '<label class="field"><span>' + t('cost_price') + '</span><input class="inp num" id="whCost" type="number" value="1050" data-change="wh-recalc"></label>'
        : '') +
      '<label class="field"><span>' + t('selling_price') + '</span><input class="inp num" id="whPrice" type="number" value="2250" data-change="wh-recalc"></label>' +
    '</div>' +
    (seesCost() ? '' :
      '<div class="partner-note">' + t('wh_cost_later') + '</div>') +
    '<label class="field"><span>' + t('shelf_box') + '</span><input class="inp" type="text" value="D-09"></label>' +
  '</div></div>';

  h += '<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:14px">' +
    '<span class="lbl">' + t('size_matrix') + ' — ' + DB.typeLabels[OG.wh.type] + '</span>' +
    '<div class="size-matrix">';
  sizes.forEach(function (s, i) {
    var q = OG.wh.sizes[s] || '';
    h += '<div class="size-cell' + (q ? ' filled' : '') + '"><b>' + s + '</b>' +
      '<input type="number" min="0" placeholder="0" value="' + q + '" data-change="wh-size" data-size="' + s + '">' +
      '<small>' + (q ? whBarcode(OG.wh.type, s, i + 1) : '—') + '</small></div>';
  });
  h += '</div></div>';

  h += '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
    '<button class="btn btn-primary btn-lg" data-act="wh-save">' + t('save_product') + '</button>' +
    '<button class="btn btn-lg" data-act="wh-labels"' + (totalPieces ? '' : ' disabled') + '>' + t('print_labels') + '</button>' +
  '</div>';

  h += '</div></div>';

  /* The whole right-hand column is a function of OG.wh.sizes, so it is
     wrapped in an id and rebuilt on its own when a quantity changes. What it
     must NOT do is take the size grid with it: the box being typed into
     lives there, and replacing it mid-keystroke is what used to throw the
     page back to the top. */
  h += '<div id="whPreview">' + whAddPreview(sizes, totalPieces) + '</div>';

  return h + '</div>';
}

/* Everything that depends on the quantities, and nothing that holds focus. */
function whAddPreview(sizes, totalPieces) {
  var h = '';
  var cost = Number(document.getElementById('whCost') && document.getElementById('whCost').value) || 1050;
  var totalCost, totalRev;
  var priceEl = document.getElementById('whPrice');
  var price = Number(priceEl && priceEl.value) || 2250;
  cost = cost || 1050;
  totalCost = totalPieces * cost;
  totalRev = totalPieces * price;

  /* No wrapping <div> here: #whPreview in whAddTab IS this column. */
  h += '<div class="card"><div class="card-head"><h3>' + t('barcode_preview') + '</h3></div>' +
    '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('size') + '</th><th class="num">' + t('qty') + '</th><th>' + t('barcode') + '</th></tr></thead><tbody>';
  var any = false;
  sizes.forEach(function (s, i) {
    var q = Number(OG.wh.sizes[s] || 0);
    if (!q) return;
    any = true;
    h += '<tr><td><b>' + s + '</b></td><td class="num">' + q + '</td>' +
         '<td class="num muted" style="letter-spacing:.04em">' + whBarcode(OG.wh.type, s, i + 1) + '</td></tr>';
  });
  if (!any) {
    sizes.slice(0, 3).forEach(function (s, i) {
      h += '<tr class="muted"><td><b>' + s + '</b></td><td class="num">0</td>' +
           '<td class="num" style="letter-spacing:.04em">' + whBarcode(OG.wh.type, s, i + 1) + '</td></tr>';
    });
  }
  h += '</tbody><tfoot><tr><td>' + t('total_pieces') + '</td><td class="num">' + totalPieces + '</td><td></td></tr></tfoot></table></div></div>';

  /* Expected revenue is selling price × pieces — no cost in it, so it stays
     for everyone. Total cost does not. */
  h += '<div class="grid mt" style="grid-template-columns:' + (seesCost() ? '1fr 1fr' : '1fr') + '">' +
    (seesCost()
      ? '<div class="stat"><span class="eyebrow">' + t('total_cost') + '</span><div class="val">' + moneyShort(totalCost) + '</div></div>'
      : '') +
    '<div class="stat"><span class="eyebrow">' + t('expected_revenue') + '</span><div class="val accent">' + moneyShort(totalRev) + '</div></div>' +
  '</div>';

  h += '<div class="card mt"><div class="card-head"><h3>' + t('tab_moves') + '</h3></div>';
  DB.stockMovements.slice(0, 5).forEach(function (mv) {
    var p = DB.product(mv.productId);
    h += '<div class="alert-row"><span class="alert-ico ' + (mv.delta > 0 ? 'green' : 'grey') + '">' + (mv.delta > 0 ? '+' : '−') + '</span>' +
      '<span class="alert-txt">' + esc(p ? p.name : mv.sku) + ' · ' + mv.size +
      '<small>' + esc(mv.note) + ' · ' + relDate(mv.date) + '</small></span>' +
      '<b class="mv-delta ' + (mv.delta > 0 ? 'pos' : 'neg') + '">' + (mv.delta > 0 ? '+' : '') + mv.delta + '</b></div>';
  });
  h += '</div>';

  return h;
}

/* Called on every keystroke in a size box. Touches three things and leaves
   the rest of the page — and the caret — exactly where they were. */
function repaintWhAdd() {
  var sizes = DB.sizeSets[OG.wh.type] || [];
  var total = 0;
  sizes.forEach(function (s) { total += Number(OG.wh.sizes[s] || 0); });

  /* the cell's own highlight and barcode, without rebuilding its input */
  sizes.forEach(function (s, i) {
    var input = document.querySelector('[data-change="wh-size"][data-size="' + s + '"]');
    if (!input) return;
    var cell = input.parentNode;
    var q = Number(OG.wh.sizes[s] || 0);
    if (cell) {
      cell.classList.toggle('filled', !!q);
      var code = cell.querySelector('small');
      if (code) code.textContent = q ? whBarcode(OG.wh.type, s, i + 1) : '—';
    }
  });

  var box = document.getElementById('whPreview');
  if (box) box.innerHTML = whAddPreview(sizes, total);

  /* Nothing to print until something has a quantity. */
  var labels = document.querySelector('[data-act="wh-labels"]');
  if (labels) labels.disabled = !total;
}

function whMovesTab() {
  var h = '<div class="card table-wrap" id="mvTable" style="max-height:calc(100vh - 240px);overflow-y:auto">' +
    '<table class="tbl"><thead><tr>' +
      '<th class="bk-col">' + Bulk.headBox('movements') + '</th>' +
      '<th>' + t('date') + '</th><th>' + t('movement') + '</th><th>' + t('product') + '</th>' +
      '<th>' + t('sku') + '</th><th>' + t('wh_location') + '</th><th class="num">' + t('qty') + '</th>' +
      '<th class="num">' + t('balance') + '</th><th>' + t('user') + '</th><th>' + t('notes') + '</th>' +
    '</tr></thead><tbody>';

  DB.stockMovements.slice(0, 90).forEach(function (mv, mi) {
    var p = DB.product(mv.productId);
    h += '<tr' + (Bulk.has('movements', mv.id) ? ' class="bk-on"' : '') + '>' +
      '<td class="bk-col">' + Bulk.box('movements', mv.id, mi) + '</td>' +
      '<td class="nowrap muted num">' + fmtDate(mv.date) + '</td>' +
      '<td><span class="badge ' + (mv.delta > 0 ? 'healthy' : (mv.type === 'damaged' ? 'critical' : 'neutral')) + '">' + t(mv.type) + '</span></td>' +
      '<td><div class="cell-prod">' + (p ? thumb(p) : '') + '<span><b>' + esc(p ? p.name : '—') + '</b>' +
        '<small>' + t('size') + ' ' + mv.size + '</small></span></div></td>' +
      '<td class="muted num">' + mv.sku + '</td>' +
      /* Historical rows written before places existed have no wh; show a dash
         rather than inventing a location they were never recorded in. */
      '<td>' + (mv.wh
        ? '<span class="badge neutral">' + esc(DB.whName(mv.wh, OG.lang === 'ar')) + '</span>'
        : '<span class="muted">—</span>') + '</td>' +
      '<td class="num"><span class="mv-delta ' + (mv.delta > 0 ? 'pos' : 'neg') + '">' + (mv.delta > 0 ? '+' : '') + mv.delta + '</span></td>' +
      '<td class="num"><b>' + mv.balance + '</b></td>' +
      '<td class="muted">' + esc(mv.user) + '</td>' +
      '<td class="muted small">' + esc(mv.note) + '</td>' +
    '</tr>';
  });

  h += '</tbody></table></div>' +
    '<div class="partner-note" style="margin-top:12px">' +
    (OG.lang === 'ar'
      ? 'كل حركة مسجّلة باسم المستخدم والتاريخ والرصيد بعدها. لا يمكن حذف سطر — فقط إضافة حركة تصحيح.'
      : 'Every movement is stamped with a user, a date and the balance after it. Rows cannot be deleted — only corrected with a new movement.') +
    '</div>';
  return h;
}

/* --------------------------------------------------------- LABEL STUDIO
   Four templates, three physical sizes, real EAN-13 and real QR. The sheet
   prints at true millimetre dimensions with crop marks; the controls carry
   .no-print so only the labels reach paper. */

var LABEL_TEMPLATES = {
  /* The default, and deliberately price-free: what goes on the shoe is its
     IDENTITY. Prices move; a price printed on a sticker turns every price
     change into a reprint of the whole shelf. */
  product: { key: 'lb_product', barcode: 1, qr: 0, price: 0, size: 1, shelf: 0, logo: 1 },
  price: { key: 'lb_price', barcode: 1, qr: 0, price: 1, size: 1, shelf: 0, logo: 1 },
  shelf: { key: 'lb_shelf', barcode: 1, qr: 0, price: 0, size: 1, shelf: 1, logo: 0 },
  hang:  { key: 'lb_hang',  barcode: 0, qr: 1, price: 1, size: 1, shelf: 0, logo: 1 },
  mini:  { key: 'lb_mini',  barcode: 1, qr: 0, price: 0, size: 0, shelf: 0, logo: 0 }
};

var LABEL_SIZES = {
  '30x30': { w: 30, h: 30 },
  '50x30': { w: 50, h: 30 },
  '40x30': { w: 40, h: 30 },
  '70x40': { w: 70, h: 40 }
};

/* ---- fitting the barcode to the label ------------------------------------
   The label is whatever roll the printer is loaded with, so the barcode has to
   be generated TO that size rather than at a fixed pixel width and hoped for.

   The old code used a constant `module: 1.1`. Code 128 of OG-001-42 is 134
   modules, plus 20 for the quiet zones — 154 × 1.1px ≈ 169px, while a 40mm
   label is only 151px wide at 96dpi. It overflowed, and because the SVG
   carries max-width:100% the browser quietly scaled it DOWN to fit. Which is
   worse than overflowing: the label looked perfect and the bars came out
   narrower than the print head can resolve, so it simply would not scan.  */

var MM_PX = 96 / 25.4;          /* CSS pixels per millimetre */
var LABEL_PAD_MM = 5;           /* 2.5mm padding each side, from .blabel */

/* The narrowest bar a thermal head can render cleanly. A 203dpi printer puts
   down 8 dots/mm, so 0.25mm is two dots — the practical floor for Code 128.
   Thinner than this and the bars blur into each other on the sticker. */
var MIN_MODULE_MM = 0.25;

/* The label the studio is currently set to, custom included. */
function labelDim() {
  if (OG.lb.size === 'custom') {
    return {
      w: Math.max(15, Math.min(200, +OG.lb.cw || 50)),
      h: Math.max(10, Math.min(200, +OG.lb.ch || 30))
    };
  }
  return LABEL_SIZES[OG.lb.size] || LABEL_SIZES['30x30'];
}

/* Work out the module width that makes this exact symbol span the usable
   width of this exact label — and say plainly when it cannot. */
function fitBarcode(text, dim, sym) {
  var mods;
  if (sym === 'ean13') {
    mods = 11 + 95 + 7;                       /* quiet zones are asymmetric */
  } else {
    var m = Codes.code128(text);
    if (!m) return null;
    mods = m.length + 20;                     /* 10-module quiet zone each side */
  }
  var usableMm = Math.max(4, dim.w - LABEL_PAD_MM);
  var moduleMm = usableMm / mods;
  return {
    mods: mods,
    moduleMm: moduleMm,
    modulePx: moduleMm * MM_PX,
    /* Bar height, budgeted against everything else on the sticker rather than
       picked to look good. A 30mm label has 26mm usable after padding, and the
       logo, two lines of name, the size chip and the gaps already claim ~16mm.
       code128SVG then adds its own human-readable line UNDER the bars (~2.4mm),
       so at 0.30 the block came to 11.4mm and pushed the product name out of
       the top of the label — clipped, on every sticker. 0.22 leaves it room. */
    heightPx: Math.max(6, dim.h * 0.22) * MM_PX,
    tooSmall: moduleMm < MIN_MODULE_MM
  };
}

/* Any code on any current label that will not print readably. Drives the
   warning in the label studio — better to be told before a roll is spent. */
function labelFitWarnings() {
  var dim = labelDim();
  var bad = [];
  labelRows().forEach(function (r) {
    var f = fitBarcode(OG.lb.sym === 'ean13' ? r.code : r.sku, dim, OG.lb.sym);
    if (f && f.tooSmall) bad.push({ sku: r.sku, mm: f.moduleMm });
  });
  return bad;
}

function labelRows() {
  var rows = [];
  /* pids is the bulk path — labels for every selected product in one sheet */
  var pids = (OG.lb.pids && OG.lb.pids.length) ? OG.lb.pids : (OG.lb.pid ? [OG.lb.pid] : null);
  if (pids) {
    pids.forEach(function (pid) {
      var p = DB.product(pid);
      if (!p) return;
      DB.variantsOf(pid).forEach(function (v) {
        rows.push({ name: p.name, size: v.size, price: p.sellingPrice, code: v.barcode,
                    shelf: v.shelf, sku: v.sku, variant: v, n: Math.max(1, Math.min(v.qty || 1, OG.lb.max)) });
      });
    });
  } else {
    var sizes = DB.sizeSets[OG.wh.type] || [];
    var nameEl = document.getElementById('whName');
    var priceEl = document.getElementById('whPrice');
    var nm = (nameEl && nameEl.value) || OG.wh.name || 'OG Heavyweight Tee';
    var pr = Number(priceEl && priceEl.value) || 2250;
    sizes.forEach(function (s, i) {
      var q = Number(OG.wh.sizes[s] || 0);
      if (!q) return;
      var code = whBarcode(OG.wh.type, s, i + 1);
      rows.push({ name: nm, size: s, price: pr, code: code, shelf: 'D-09',
                  sku: 'NEW-' + s, variant: null, n: Math.min(q, OG.lb.max) });
    });
  }
  return rows;
}

/* A label QR must stay short. A 70-character payload becomes a 49-module
   symbol, which at 17mm is 0.35mm per module — below what a phone camera
   reliably resolves. The SKU alone is a 25-module symbol at 0.68mm. The
   rich, human-readable payload stays on the invoice, where there is room.

   url mode takes the same label from 25 modules to 41 — measured, not
   guessed. That is fine on the 50mm sticker and marginal on the smallest
   one, so leave QR_MODE on 'text' if he prints the small size. */
function labelQrPayload(r) {
  if (CONFIG.QR_MODE !== 'url') return r.sku;
  return r.variant ? deepLink('product', r.variant.productId) : r.sku;
}

function labelHTML(r) {
  var tpl = LABEL_TEMPLATES[OG.lb.template];
  var dim = labelDim();
  var big = dim.w >= 70;
  var useQr = tpl.qr && OG.lb.qr && r.variant;

  var txt = '';
  if (tpl.logo && OG.lb.logo) txt += '<img class="bl-logo" src="assets/logo.svg" alt="OG">';
  txt += '<b class="bl-name">' + esc(r.name) + '</b>';

  var meta = [];
  if (tpl.size && OG.lb.size2) meta.push('<span class="bl-size">' + r.size + '</span>');
  if (tpl.shelf && OG.lb.shelf) meta.push('<span class="bl-shelf">' + r.shelf + '</span>');
  if (meta.length) txt += '<div class="bl-meta">' + meta.join('') + '</div>';

  if (tpl.barcode && OG.lb.barcode) {
    /* Code 128 of the SKU on our own labels, not the EAN-13.
       ------------------------------------------------------------------
       The generated EAN-13s begin 621, which is GS1's real country prefix
       for Syria — an OG code could collide with a genuine Syrian product.
       Code 128 encodes text, so the label carries OG-001-42 itself: unique
       by construction, readable by a human, and no registry involved.

       Scanning it needs no new lookup either: resolveScan already falls back
       to DB.variantBySku, so a Code 128 label resolves through a path that
       has been there all along. EAN-13 stays readable for supplier goods. */
    /* Generated to the label, not to a guess. fitBarcode divides the usable
       width by this symbol's own module count, so the bars end exactly at the
       edge of the sticker whatever roll is loaded and however long the SKU. */
    var payload = OG.lb.sym === 'ean13' ? r.code : r.sku;
    var fit = fitBarcode(payload, dim, OG.lb.sym);
    if (fit) {
      txt += '<div class="bl-bc' + (fit.tooSmall ? ' bl-bc-tight' : '') + '">' +
        (OG.lb.sym === 'ean13'
          ? Codes.ean13SVG(payload, { module: fit.modulePx, height: fit.heightPx })
          : Codes.code128SVG(payload, { module: fit.modulePx, height: fit.heightPx })) +
      '</div>';
    }
  }
  /* Price is OFF by default and this is why: a price on a barcode sticker
     means every price change is a reprint of every sticker. The barcode
     identifies the shoe; the price lives at the till and on the shelf edge,
     where changing it costs nothing. */
  if (tpl.price && OG.lb.price) txt += '<div class="bl-price">' + money(r.price) + '</div>';

  /* has-qr rather than a :has() selector — plain class, no CSS-support risk */
  var h = '<div class="blabel tpl-' + OG.lb.template + (useQr ? ' has-qr' : '') +
          '" style="width:' + dim.w + 'mm;height:' + dim.h + 'mm">';
  if (useQr) {
    /* QR beside the text, not stacked — stacking overflows a 30mm label. */
    h += '<div class="bl-col">' + txt + '</div>' +
         '<div class="bl-qr">' + qrSafe(labelQrPayload(r), r.sku,
           { size: big ? 96 : 74, quiet: 2, style: 'square', dark: '#000000' }) + '</div>';
  } else {
    h += txt;
  }
  return h + '</div>';
}

function labelSheetHTML() {
  var rows = labelRows(), total = 0, sheet = '';
  rows.forEach(function (r) {
    for (var k = 0; k < r.n; k++) { sheet += labelHTML(r); total++; }
  });
  return { html: '<div class="label-sheet">' + sheet + '</div>', count: total, rows: rows.length };
}

function labelControls() {
  var h = '<div class="lb-controls no-print">';

  h += '<div class="lb-group"><span class="lbl">' + t('lb_template') + '</span><div class="chip-row">';
  Object.keys(LABEL_TEMPLATES).forEach(function (k) {
    h += '<button class="chip ' + (OG.lb.template === k ? 'on' : '') + '" data-act="lb-tpl" data-k="' + k + '">' +
      t(LABEL_TEMPLATES[k].key) + '</button>';
  });
  h += '</div></div>';

  h += '<div class="lb-group"><span class="lbl">' + t('lb_size') + '</span><div class="chip-row">';
  Object.keys(LABEL_SIZES).forEach(function (k) {
    h += '<button class="chip ' + (OG.lb.size === k ? 'on' : '') + '" data-act="lb-size" data-k="' + k + '">' +
      k.replace('x', ' × ') + ' mm</button>';
  });
  /* Whatever roll the printer is actually loaded with. Three fixed sizes were
     a guess made before the hardware was chosen. */
  h += '<button class="chip ' + (OG.lb.size === 'custom' ? 'on' : '') + '" data-act="lb-size" data-k="custom">' +
    t('lb_custom') + '</button>';
  h += '</div>';
  if (OG.lb.size === 'custom') {
    h += '<div class="lb-custom">' +
      '<input class="inp num" id="lbCW" type="number" min="15" max="200" step="1" data-change="lb-cw" value="' + (OG.lb.cw || 50) + '">' +
      '<span class="lb-x">×</span>' +
      '<input class="inp num" id="lbCH" type="number" min="10" max="200" step="1" data-change="lb-ch" value="' + (OG.lb.ch || 30) + '">' +
      '<span class="muted small">mm</span>' +
    '</div>';
  }
  h += '</div>';

  /* Paper. A thermal roll and an A4 sticker sheet need genuinely different
     page rules, and printing one as the other wastes a whole roll. */
  h += '<div class="lb-group"><span class="lbl">' + t('hw_mode') + '</span><div class="chip-row">' +
    '<button class="chip ' + (OG.lb.mode === 'roll' ? 'on' : '') + '" data-act="lb-mode" data-k="roll">' +
      t('hw_roll') + '</button>' +
    '<button class="chip ' + (OG.lb.mode === 'sheet' ? 'on' : '') + '" data-act="lb-mode" data-k="sheet">' +
      t('hw_sheet') + '</button>' +
  '</div></div>';

  /* Which symbology goes on our own stock. */
  h += '<div class="lb-group"><span class="lbl">' + t('hw_symbology') + '</span><div class="chip-row">' +
    '<button class="chip ' + (OG.lb.sym === 'c128' ? 'on' : '') + '" data-act="lb-sym" data-k="c128">' +
      'Code 128 · SKU</button>' +
    '<button class="chip ' + (OG.lb.sym === 'ean13' ? 'on' : '') + '" data-act="lb-sym" data-k="ean13">' +
      'EAN-13</button>' +
  '</div></div>';

  var tpl = LABEL_TEMPLATES[OG.lb.template];
  h += '<div class="lb-group"><span class="lbl">' + t('lb_show') + '</span><div class="chip-row">';
  [['barcode', 'barcode'], ['qr', 'lb_qr'], ['price', 'price'], ['size2', 'size'], ['shelf', 'shelf'], ['logo', 'lb_logo']]
    .forEach(function (pair) {
      var field = pair[0];
      var allowed = field === 'size2' ? tpl.size : (field === 'qr' ? tpl.qr : tpl[field]);
      if (!allowed) return;
      h += '<button class="chip ' + (OG.lb[field] ? 'on' : '') + '" data-act="lb-toggle" data-k="' + field + '">' +
        t(pair[1]) + '</button>';
    });
  h += '</div></div>';

  h += '<div class="lb-group"><span class="lbl">' + t('lb_copies') + '</span>' +
    '<input class="inp num" type="number" min="1" max="24" value="' + OG.lb.max + '" data-change="lb-max" style="width:96px">' +
    '<span class="muted small" style="margin-inline-start:10px">' + t('lb_copies_hint') + '</span></div>';

  /* Whether the barcode actually fits this roll, said before the roll is
     spent rather than after a scanner refuses the stickers. */
  if (OG.lb.barcode && LABEL_TEMPLATES[OG.lb.template].barcode) {
    var dim = labelDim();
    var probe = labelRows()[0];
    var bad = labelFitWarnings();
    if (bad.length) {
      h += '<div class="partner-note note-danger lb-fit">' +
        t('lb_fit_warn').replace('{n}', bad.length)
                        .replace('{mm}', (Math.round(bad[0].mm * 100) / 100)) + '</div>';
    } else if (probe) {
      var f = fitBarcode(OG.lb.sym === 'ean13' ? probe.code : probe.sku, dim, OG.lb.sym);
      if (f) {
        h += '<div class="partner-note note-ok lb-fit">' +
          t('lb_fit_ok').replace('{mm}', (Math.round(f.moduleMm * 100) / 100)) + '</div>';
      }
    }
  }

  if (!LABEL_TEMPLATES[OG.lb.template].price) {
    h += '<div class="partner-note lb-fit">' + t('lb_no_price_note') + '</div>';
  }

  return h + '</div>';
}

function openLabelSheet(pid) {
  OG.lb.pid = pid || null;
  if (pid) OG.lb.pids = null;              // a single product overrides a bulk selection
  var s = labelSheetHTML();
  if (!s.count) { toast(t('label_sheet'), t('lb_nothing'), 'warn'); return; }

  openModal({
    title: t('lb_studio'),
    size: 'wide',
    body: labelControls() +
      '<div class="lb-preview-head no-print"><span class="eyebrow">' + t('lb_sheet') + '</span>' +
        '<span class="badge accent">' + s.count + ' ' + t('lb_labels') + '</span>' +
        '<span class="badge neutral">' + t('lb_scannable') + '</span></div>' +
      '<div id="lbSheet">' + s.html + '</div>',
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
          '<button class="btn btn-primary" data-act="print-now">' + t('print') + '</button>'
  });
}

/* Re-render the sheet in place so the controls keep their scroll position. */
function repaintLabels() {
  var host = document.getElementById('lbSheet');
  if (!host) return;
  var s = labelSheetHTML();
  host.innerHTML = s.html;
  var ctrl = document.querySelector('.lb-controls');
  if (ctrl) ctrl.outerHTML = labelControls();
  var badge = document.querySelector('.lb-preview-head .badge.accent');
  if (badge) badge.textContent = s.count + ' ' + t('lb_labels');
}
