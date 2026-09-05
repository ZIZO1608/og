/* ==========================================================================
   OG SYSTEM — application shell  ·  8/17: WAREHOUSE tabs
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 2802-3683). Loads after
   app-products.js. The browser Label Studio that used to share this file is
   gone — see the note at the bottom.
   ========================================================================== */

/* ------------------------------------------------------------- 9. WAREHOUSE */

/* There is deliberately no barcode generator here any more. The Add form
   used to show a 13-digit EAN beside every size before the product existed,
   computed in the browser from the type and the size — and the server, which
   is the only thing that issues codes, issues a different one at save time
   (Cat.nextBarcode is random, and label_code is a counter it alone holds).
   A number that looks exactly like a barcode and scans to nothing is worse
   than a blank, so the form now says the codes arrive on save, and the
   labels are printed from the codes the server actually minted. */

function viewWarehouse() {
  var h = '<div class="page-head"><div><h1>' + t('warehouse_title') + '</h1>' +
    '<div class="sub">' + t('warehouse_sub') + '</div></div>' +
    '<div class="head-actions">' +
      '<span class="badge neutral">' + DB.liveVariants().length + ' SKU</span>' +
      '<span class="badge accent">' + nf(DB.liveVariants().reduce(function (a, v) { return a + v.qty; }, 0)) + ' ' + t('total_pieces').toLowerCase() + '</span>' +
      /* The map is its own screen — it takes over the scanner and keeps the
         focus in a scan box, which is not something to do inside a tab of a
         screen that has four other jobs. */
      ifNav('shelfmap', '<button class="btn" data-act="nav" data-view="shelfmap">' +
        t('nav_shelfmap') + '</button>') +
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
    { id: 'count', label: t('st_count'), dot: !!Stock.active(), need: 'stock.count' },
    /* Who is waiting for something the shop did not have. This is the tab a
       manager opens when a shipment lands — the wants were recorded by the
       act of looking a size up at the till, so the list is already written.
       customer.read, because every row names a person. */
    { id: 'wants', label: t('wa_wants'), need: 'customer.read' }
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
     : (tab === 'wants') ? whWantsTab()
     : whMovesTab();
  return h;
}

/* ---- who is waiting -------------------------------------------------------
   "What is everybody waiting for" — the view a manager opens when a shipment
   lands. Until now this only existed per customer, which is the wrong way
   round: you find out a 44 arrived and want the list of people, not to walk
   forty profiles looking for one.

   Nobody typed any of it. Every row was recorded by the act of looking a size
   up at the till while it was out of stock and a customer was attached
   (server/lib/wants.js). Fetched rather than hydrated: it is a working list
   that changes while somebody is standing at the back door with a box, and a
   copy taken at sign-in would be the wrong one by the time it was read. */
var wantRows = null;
var wantsLoading = false;
/* { shown, total, capped } — the wants reader has a LIMIT on it, and this tab
   badges the length. At 200 open wants the badge would have said 200 and
   meant "at least 200". See js/app-util.js cappedNote. */
var wantCap = { shown: 0, total: 0, capped: false };

function whWantsTab() {
  if (wantRows === null) {
    if (!wantsLoading) loadWants();
    return '<div class="card"><div class="card-body">' +
      '<span class="muted small">' + t('loading') + '</span></div></div>';
  }

  if (!wantRows.length) {
    return '<div class="card"><div class="cart-empty"><b>' + t('wa_none') + '</b>' +
      t('wa_none_sub') + '</div></div>';
  }

  /* Grouped by what was asked for, because that is the unit a shipment
     arrives in — one box of 44s answers every row under one heading. */
  var groups = {};
  var order = [];
  wantRows.forEach(function (w) {
    var key = (w.product_id || 0) + '|' + (w.size || '');
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(w);
  });

  var h = '<div class="card"><div class="card-head"><h3>' + t('wa_wants') + '</h3>' +
    '<div class="card-actions"><span class="badge critical">' + cappedCount(wantCap) + '</span></div></div>' +
    '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('product') + '</th><th>' + t('size') + '</th>' +
      '<th>' + t('customer') + '</th><th>' + t('phone') + '</th>' +
      '<th>' + t('date') + '</th><th class="num">' + t('in_stock') + '</th><th></th>' +
    '</tr></thead><tbody>';

  order.forEach(function (key) {
    var rows = groups[key];
    var first = rows[0];
    /* Has it landed? The whole point of the screen is the row that says yes. */
    var back = first.variant_sku ? DB.variantBySku(first.variant_sku) : null;
    var here = back ? back.qty : 0;

    rows.forEach(function (w, i) {
      h += '<tr' + (here > 0 ? ' class="st-ok"' : '') + '>' +
        '<td>' + (i === 0 ? nm(w.product_name || t('product')) : '') + '</td>' +
        '<td>' + (i === 0 ? '<b>' + esc(w.size || '—') + '</b>' : '') + '</td>' +
        '<td><span class="clickable" data-act="cu-open" data-id="' + w.customer_id + '">' +
          nm(w.customer_name) + ' ›</span></td>' +
        '<td class="num">' + tel(w.customer_phone || '') + '</td>' +
        '<td class="muted num nowrap">' + fmtDate(w.at) + '</td>' +
        '<td class="num">' + (i === 0
          ? (here > 0 ? '<b class="st-pos">' + nf(here) + '</b>' : '<span class="muted">0</span>')
          : '') + '</td>' +
        '<td><button class="btn btn-sm" data-act="wa-close" data-id="' + w.id + '">' +
          t('wa_tell') + '</button></td>' +
      '</tr>';
    });
  });

  h += '</tbody></table></div></div>' +
    cappedNote(wantCap, t('wa_wants').toLowerCase()) +
    '<div class="partner-note mt">' + t('wa_note') + '</div>';
  return h;
}

function loadWants() {
  if (typeof Shop === 'undefined' || !Shop.live()) { wantRows = []; return; }
  wantsLoading = true;
  Shop.wantsFor().then(function (r) {
    wantRows = (r && r.wants) || [];
    wantCap = { shown: wantRows.length, total: (r && r.wantsTotal) || wantRows.length,
                capped: !!(r && r.wantsCapped) };
    wantsLoading = false;
    /* Only repaint if this tab is still the one on show — a slow response
       arriving after somebody has moved on must not draw over what they
       opened instead. */
    if (OG.view === 'warehouse' && OG.wh.tab === 'wants') render();
  }).catch(function () {
    wantRows = [];
    wantsLoading = false;
    if (OG.view === 'warehouse' && OG.wh.tab === 'wants') render();
  });
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

/* ---- changing one -------------------------------------------------------
   Until Stage C there was NO way to change a customer's name, phone or
   address anywhere in the system. The row was written once at the till and
   then frozen: a mistyped number stayed mistyped, a person who moved kept the
   old address, and PATCH /api/customers/:id sat there accepting fields nobody
   ever sent it.

   The same modal as the create form, plus the two fields that were being
   stored and never shown. It is a deliberate five now rather than three: this
   one is not filled in with somebody waiting at the counter. */
function openEditCustomer(cid) {
  if (!allow('customer.write')) { toast(t('customer'), t('no_access'), 'err'); return; }
  var c = DB.customer(cid);
  if (!c) return;

  openModal({
    title: t('cu_edit'), size: 'narrow',
    body:
      '<label class="field"><span>' + t('name') + '</span>' +
        '<input class="inp" id="cuName" type="text" value="' + esc(c.name) + '" ' +
        'placeholder="' + esc(t('cu_name_ph')) + '"></label>' +
      '<label class="field mt"><span>' + t('phone') + '</span>' +
        '<input class="inp" id="cuPhone" type="tel" inputmode="tel" value="' + esc(c.phone) + '" ' +
        'placeholder="+963 9__ ___ ___"></label>' +
      '<label class="field mt"><span>' + t('city') + '</span>' +
        '<input class="inp" id="cuCity" type="text" value="' + esc(c.city) + '"></label>' +
      '<label class="field mt"><span>' + t('address') + '</span>' +
        '<input class="inp" id="cuAddr" type="text" value="' + esc(c.address) + '" ' +
        'placeholder="' + esc(t('cu_addr_ph')) + '"></label>' +
      '<label class="field mt"><span>' + t('note') + '</span>' +
        '<input class="inp" id="cuNote" type="text" value="' + esc(c.note) + '" ' +
        'placeholder="' + esc(t('cu_note_ph')) + '"></label>' +

      /* ---- credit -------------------------------------------------------
         The limit is IN DOLLARS on screen and in USD CENTS in the database
         (033). Dollars because a limit written in lira decays as the currency
         moves — a ceiling set last year quietly stops being one — and cents
         underneath because money is integer minor units everywhere here.

         BLANK is not zero. Blank means no limit set; 0 means no credit at
         all. The placeholder says so, because the two look identical in an
         empty box and mean opposite things. */
      '<div class="row2 mt">' +
        '<label class="field"><span>' + t('cu_credit_limit') + '</span>' +
          '<input class="inp num" id="cuLimit" type="number" min="0" step="1" ' +
            'value="' + (c.creditLimit == null ? '' : (c.creditLimit / 100)) + '" ' +
            'placeholder="' + esc(t('cu_no_limit')) + '"></label>' +
        '<label class="field"><span>' + t('cu_no_credit') + '</span>' +
          '<select class="inp" id="cuNoCredit">' +
            '<option value="0"' + (c.noCredit ? '' : ' selected') + '>' + t('cu_credit_ok') + '</option>' +
            '<option value="1"' + (c.noCredit ? ' selected' : '') + '>' + t('cu_credit_none') + '</option>' +
          '</select></label>' +
      '</div>' +
      '<div class="partner-note">' + t('cu_credit_note') + '</div>' +

      '<div class="partner-note mt">' + t('cu_note_seen') + '</div>',
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="cu-update" data-id="' + c.id + '">' + t('save') + '</button>'
  });

  setTimeout(function () {
    var el = document.getElementById('cuName');
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
        /* No stopPropagation — it killed the click before the delegated
           [data-act] dispatcher on `document` ever saw it, so Reorder did
           nothing. closest('[data-act]') finds this button, not the row. */
        '<td><button class="btn btn-sm btn-primary" ' +
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
    /* WHERE IT LANDS AND WHERE IT GOES. Both left out entirely without
       stock.move, for the same reason the cost box is: putting a pair on a
       shelf is a stock movement, and the server refuses one from an account
       that cannot make them. A select he can work but not save is worse than
       no select — he would find out at the end, having already chosen.
       Without it the goods still arrive, at the intake warehouse, unshelved. */
    (allow('stock.move')
      ? '<div class="row2">' +
          '<label class="field"><span>' + t('wh_intake') + '</span>' +
            '<select class="inp" data-change="wh-warehouse">' +
              DB.warehouses.map(function (w) {
                return '<option value="' + esc(w.id) + '"' + (w.id === whAddWh() ? ' selected' : '') +
                  '>' + esc(DB.whName(w.id, OG.lang === 'ar')) + '</option>';
              }).join('') +
            '</select></label>' +
          /* Painted empty and disabled because the rooms are live server
             state, not part of the hydrated catalogue — bindWarehouse fills
             it once they land. Disabled until then so nobody picks out of a
             list that is about to be replaced. */
          '<label class="field"><span>' + t('shelf_box') + '</span>' +
            '<select class="inp" id="whShelf" data-change="wh-shelf" disabled>' +
              '<option value="">' + t('loading') + '</option>' +
            '</select></label>' +
        '</div>'
      : '') +
  '</div></div>';

  h += '<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:14px">' +
    '<span class="lbl">' + t('size_matrix') + ' — ' + DB.typeLabels[OG.wh.type] + '</span>' +
    '<div class="size-matrix">';
  /* The small line under each size used to carry an invented EAN-13 (see the
     note at the top of this file). It now carries the SKU the server will
     mint — the one thing about a size that is known before saving. */
  sizes.forEach(function (s) {
    var q = OG.wh.sizes[s] || '';
    h += '<div class="size-cell' + (q ? ' filled' : '') + '"><b>' + s + '</b>' +
      '<input type="number" min="0" placeholder="0" value="' + q + '" data-change="wh-size" data-size="' + s + '">' +
      '<small>' + (q ? t('wh_code_on_save') : '—') + '</small></div>';
  });
  h += '</div></div>';

  /* "Save & print labels" rather than a print button beside Save: the codes
     on the sticker are issued by the server when the product is saved, so
     there is nothing true to print before that. One press saves, and the
     preview opens on the sizes just created with the quantities just booked. */
  h += '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
    '<button class="btn btn-primary btn-lg" data-act="wh-save">' + t('save_product') + '</button>' +
    (allow('label.print')
      ? '<button class="btn btn-lg" data-act="wh-save-print"' + (totalPieces ? '' : ' disabled') + '>' + t('wh_save_print') + '</button>'
      : '') +
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

/* The warehouse the Add form books opening stock into, and so the only
   warehouse whose shelves it may offer. Resolved on every read rather than
   frozen into OG.wh at page load: DB.intakeWh is replaced from server config
   during hydrate(), so a value captured earlier would be the factory one. */
function whAddWh() {
  /* The DB.warehouse() half covers a warehouse that has been removed since it
     was picked, which would otherwise leave the select showing one place
     while the state held another and the stock landing at the second. */
  if (OG.wh.whId && DB.warehouse(OG.wh.whId)) return OG.wh.whId;
  return DB.intakeWh;
}

/* The shelf's printed name, read off the select while it is still on the
   screen. The toast that names it fires after render() has already rebuilt
   the form, so this has to be taken before the save, not looked up after. */
function whShelfCode() {
  var el = document.getElementById('whShelf');
  if (!el || !el.value) return '';
  var o = el.options[el.selectedIndex];
  return o ? o.textContent : '';
}

/* Put every size of a product that has just been created onto one shelf.

   AFTER the product exists and outside its write, never inside it: the goods
   are already booked in against a movement row, and a shelf refusing must not
   unwind a real receipt — the same rule Deliveries.assign follows for a sale.

   ONE AT A TIME, not Promise.all. The first request is what makes an empty
   shelf adopt this product and CLEARS its size range (server/lib/shelves.js:997);
   every request after it passes because of what the first one did. Six racing
   would each be judged against a shelf that had not adopted yet — which
   happens to work only because BEGIN IMMEDIATE serialises them anyway, and
   depending on that is not the same as meaning it.

   A refusal does not stop the run. Five sizes on the shelf and one not is
   better than one on and five not, and the toast can then name which. */
function whAssignAll(made, whId, shelfId, done) {
  var failed = [], firstErr = '', i = 0;

  function step() {
    if (i >= made.length) { done(failed, firstErr); return; }
    var v = made[i++];
    Shop.assignShelf(v.sku, whId, shelfId).then(step, function (err) {
      failed.push(v.size);
      if (!firstErr) firstErr = API.friendly(err);
      step();
    });
  }
  step();
}

/* Fills the Add form's shelf picker from the real rooms.

   Run from bindWarehouse after every render of the screen, and again when the
   warehouse select moves — a shelf reaches its warehouse through its room, and
   assign-shelf refuses a pair held in the other building, so the two selects
   are one control.

   EVERY OPTION IS NAMED WITH ITS ROOM — 'M-A3', never 'A3'. Shelf codes are
   unique per room only, so a bare code names two different shelves the day a
   second room opens. This is a list somebody reads while holding a box.

   Rooms are separated by disabled options rather than <optgroup>: js/selectbox.js
   skins every select.inp by walking sel.options, which flattens groups away, so
   an optgroup label would be visible in no browser the shop actually uses. */
function fillWhShelves() {
  if (!document.getElementById('whShelf') || typeof ShelfMap === 'undefined') return;

  ShelfMap.cachedSections().then(function (secs) {
    /* The screen may have moved on while the request was out. */
    var el = document.getElementById('whShelf');
    if (!el) return;

    var whId = whAddWh();
    var mine = secs.filter(function (s) { return s.wh_id === whId && s.shelves.length; });

    if (!mine.length) {
      el.innerHTML = '<option value="">' + t('shelf_no_rooms') + '</option>';
      el.disabled = true;
      OG.wh.shelfId = '';
      return;
    }

    var h = '<option value="">' + t('shelf_none') + '</option>';
    var stillThere = false;

    mine.forEach(function (s) {
      h += '<option disabled>' + esc(s.key + ' · ' + s.name) + '</option>';
      s.shelves.forEach(function (sh) {
        /* A shelf already holding a DIFFERENT model would come back as
           wrong_shelf. Shown rather than hidden, and named with what is on
           it: a shelf that quietly vanishes from the list reads as a shelf
           that does not exist, and the map exists so people can see where
           things actually are.

           AN ARCHIVED PRODUCT STILL HOLDS ITS SHELF. Everywhere else in this
           app an archived line is not stock and is filtered out, so the
           tempting thing is to treat its shelf as free — but assignStock
           compares shelf.product_id alone (server/lib/shelves.js:1000) and
           never looks at products.hidden. Offering it would be a shelf that
           is guaranteed to refuse, AFTER the product has already been
           created. It is named as archived instead, which is the useful half
           of the fact: it tells the manager why a rack is blocked by a line
           the shop stopped selling. */
        var taken = sh.product_id != null;
        var mineNow = !taken && String(sh.id) === String(OG.wh.shelfId);
        if (mineNow) stillThere = true;
        h += '<option value="' + sh.id + '"' + (taken ? ' disabled' : '') +
          (mineNow ? ' selected' : '') + '>' + esc(sh.full_code) +
          (taken ? ' — ' + esc(sh.product_name || '?') +
                   (sh.product_hidden ? ' (' + t('bk_archived') + ')' : '') : '') +
          '</option>';
      });
    });

    /* A shelf chosen for the other warehouse, or taken since, is not a
       choice any more. Dropped rather than carried, so the value that gets
       saved is always one that is still on the screen. */
    if (!stillThere) OG.wh.shelfId = '';

    el.innerHTML = h;
    el.disabled = false;
  }, function (err) {
    var el = document.getElementById('whShelf');
    if (!el) return;
    /* Says why, rather than sitting on "Loading…" for good. The product can
       still be saved — it simply arrives unshelved, which is a real state. */
    el.innerHTML = '<option value="">' + esc(API.friendly(err)) + '</option>';
    el.disabled = true;
    OG.wh.shelfId = '';
  });
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
  h += '<div class="card"><div class="card-head"><h3>' + t('wh_sizes_going_in') + '</h3></div>' +
    '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('size') + '</th><th class="num">' + t('qty') + '</th><th>' + t('barcode') + '</th></tr></thead><tbody>';
  var any = false;
  sizes.forEach(function (s) {
    var q = Number(OG.wh.sizes[s] || 0);
    if (!q) return;
    any = true;
    h += '<tr><td><b>' + s + '</b></td><td class="num">' + q + '</td>' +
         '<td class="muted small">' + t('wh_code_on_save') + '</td></tr>';
  });
  if (!any) {
    h += '<tr><td colspan="3" class="muted small" style="text-align:center;padding:18px">' + t('wh_no_sizes_yet') + '</td></tr>';
  }
  h += '</tbody><tfoot><tr><td>' + t('total_pieces') + '</td><td class="num">' + totalPieces + '</td><td></td></tr></tfoot></table></div>' +
    '<div class="partner-note" style="margin:0 14px 14px">' + t('wh_codes_note') + '</div></div>';

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

  /* the cell's own highlight and note, without rebuilding its input */
  sizes.forEach(function (s) {
    var input = document.querySelector('[data-change="wh-size"][data-size="' + s + '"]');
    if (!input) return;
    var cell = input.parentNode;
    var q = Number(OG.wh.sizes[s] || 0);
    if (cell) {
      cell.classList.toggle('filled', !!q);
      var code = cell.querySelector('small');
      if (code) code.textContent = q ? t('wh_code_on_save') : '—';
    }
  });

  var box = document.getElementById('whPreview');
  if (box) box.innerHTML = whAddPreview(sizes, total);

  /* Nothing to print until something has a quantity. */
  var labels = document.querySelector('[data-act="wh-save-print"]');
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
   Gone. It laid product labels out in the browser with its own templates,
   sizes and symbology, and put the SKU TEXT in the Code 128 — while the
   Print-labels screen, the Products row and every bulk selection printed
   the same shoe from a `label_templates` row with the numeric label_code in
   the bars. Same product, two different stickers. For a product not yet
   saved it went further and printed an EAN-13 the browser had invented
   (whBarcode above, now only a memory in this comment) that the server would
   never issue, so the sticker could not scan to anything.

   Every "Print labels" button now opens the one template preview in
   js/labels.js — the server's layout, the server's code — and that preview
   can print through this computer's dialog as well as the label printer's
   queue, which is the part of the studio worth keeping. */
