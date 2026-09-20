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

/* ---- the four questions (night shift 02) ---------------------------------

   This screen used to open on a bar of six tabs — Stock movements, Stock by
   place, Worth reordering, Add product, Stock count, Asked for — wrapping
   onto two rows, with the landing tab being the movement log: an audit trail
   of what already happened, first thing in the morning.

   None of those words is a job. What somebody walks into this room to do is
   one of four things, and each of them is a button now:

       Goods arrived · Move stock · Where is it? · Count

   Nothing was taken away. The rarer panels — the movement log, the purchase
   orders, who is waiting for a size — are under "More", which remembers
   whether it was open, per machine, like the Settings folds. Add product is
   a fifth button because it is the other thing that starts here.

   The tab ids did not change, so every deep link, every dashboard shortcut
   (`data-act="home-wh"`) and `NAV_TAB_STATE.warehouse` still land where they
   always did. */
var WH_MORE_KEY = 'og.wh.more';

function whMoreOpen() {
  try { return localStorage.getItem(WH_MORE_KEY) === '1'; } catch (e) { return false; }
}

/* Every panel this screen can draw, with the permission it needs and whether
   it is one of the four jobs or one of the rarer ones. ONE list — the buttons,
   the More fold and the dispatch below all read it, so a panel cannot appear
   in one and not the others. That was a real bug in the launcher's job table
   and it is the same shape. */
function whPanels() {
  return [
    /* -- the four jobs, plus the one that starts a product -- */
    { id: 'arrived', label: t('rc_tab'), sub: t('rc_tab_sub'), job: true, primary: true,
      icon: 'M3 7h18v4H3zM5 11v9h14v-9M9 15h6', need: 'stock.move' },
    { id: 'move',    label: t('wh_job_move'), sub: t('wh_job_move_sub'), job: true,
      icon: 'M4 8h12M12 4l4 4-4 4M20 16H8M12 12l-4 4 4 4', need: 'stock.move' },
    { id: 'stock',   label: t('wh_job_find'), sub: t('wh_job_find_sub'), job: true,
      icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4' },
    { id: 'count',   label: t('st_count'), sub: t('wh_job_count_sub'), job: true,
      icon: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3', need: 'stock.count', dot: !!Stock.active() },
    { id: 'add',     label: t('tab_add'), sub: t('wh_job_add_sub'), job: true,
      icon: 'M12 5v14M5 12h14', need: 'product.write' },

    /* -- and the rest, under More -- */
    /* BUYING NEEDS TO SEE WHAT THINGS COST (ns03). A purchase order is a
       list of unit costs and a supplier balance; an account without
       cost.read was offered the panel and then shown a table of dashes, and
       "Worth reordering" ranks by money it may not read. The server has
       always answered scrubCost to it — this is the browser catching up.
       On this shop warehouse/cost.read is 1 in role_permissions while the
       seed says 0; the owner unticks it by hand, and then this row goes. */
    { id: 'po',    label: t('tab_reorder'), need: ['stock.move', 'cost.read'] },
    { id: 'moves', label: t('tab_moves'),   need: 'stock.move' },
    { id: 'wants', label: t('wa_wants'),    need: 'customer.read' }
  ].filter(function (x) {
    if (!x.need) return true;
    /* a list means EVERY one of them, unlike requirePerm's any-of: buying
       needs both the stock permission and the cost one */
    return Array.isArray(x.need) ? x.need.every(allow) : allow(x.need);
  });
}

function viewWarehouse() {
  var h = '<div class="page-head"><div><h1>' + t('warehouse_title') + '</h1>' +
    '<div class="sub">' + t('warehouse_sub') + '</div></div>' +
    '<div class="head-actions">' +
      '<span class="badge neutral">' + DB.liveVariants().length + ' SKU</span>' +
      '<span class="badge accent">' + nf(DB.liveVariants().reduce(function (a, v) { return a + v.qty; }, 0)) + ' ' + t('total_pieces').toLowerCase() + '</span>' +
      exportButtons() +
    '</div></div>';

  var panels = whPanels();
  var openPOs = DB.purchaseOrders.filter(function (p) { return p.status !== 'received'; }).length;
  var floorGaps = DB.floorOuts().length;

  /* Landing on a panel this account cannot open — a remembered choice, a deep
     link, a permission taken away while somebody was looking at it — falls
     back to the first job they do have. `OG.wh.tab` is rewritten, not just
     the local: leaving them to disagree drew a panel with nothing lit above
     it, which is how the old bar behaved. */
  if (!panels.some(function (x) { return x.id === OG.wh.tab; })) {
    OG.wh.tab = (panels.filter(function (x) { return x.job; })[0] || panels[0]).id;
  }
  var tab = OG.wh.tab;

  var jobs = panels.filter(function (x) { return x.job; });
  var rest = panels.filter(function (x) { return !x.job; });

  /* A cashier has stock.read and nothing else here — one job, "Where is it?",
     which is the whole reason she is allowed in: to answer "have you got it
     in a 42". One button is furniture, so she gets the panel and no chrome. */
  if (jobs.length > 1) {
    h += '<div class="wh-jobs">';
    jobs.forEach(function (x) {
      var dot = x.id === 'po' ? openPOs : (x.id === 'stock' ? floorGaps : 0);
      h += '<button class="wh-job' + (tab === x.id ? ' on' : '') +
             (x.primary ? ' wh-job-primary' : '') + '" data-act="wh-tab" data-tab="' + x.id + '">' +
        '<span class="wh-job-ico"><svg viewBox="0 0 24 24" stroke-linecap="square" stroke-linejoin="miter">' +
          '<path d="' + x.icon + '"/></svg></span>' +
        '<span class="wh-job-t"><b>' + x.label + '</b><small>' + (x.sub || '') + '</small></span>' +
        (x.dot || dot ? '<span class="tab-dot"></span>' : '') +
      '</button>';
    });
    h += '</div>';
  }

  if (rest.length) {
    var open = whMoreOpen() || rest.some(function (x) { return x.id === tab; });
    h += '<div class="wh-more' + (open ? ' open' : '') + '">' +
      '<button class="wh-more-h" data-act="wh-more">' + t('wh_more') +
        '<span class="wh-more-x">' + (open ? '−' : '+') + '</span></button>' +
      (open
        ? '<div class="wh-more-b">' + rest.map(function (x) {
            var dot = x.id === 'po' ? openPOs : 0;
            return '<button class="chip' + (tab === x.id ? ' on' : '') +
              '" data-act="wh-tab" data-tab="' + x.id + '">' + x.label +
              (dot ? '<span class="tab-dot"></span>' : '') + '</button>';
          }).join('') + '</div>'
        : '') +
    '</div>';
  }

  h += (tab === 'arrived') ? Receive.tab()
     : (tab === 'move')    ? whMoveTab()
     : (tab === 'stock')   ? whStockTab()
     : (tab === 'add')     ? whAddTab()
     : (tab === 'po')      ? whPoTab()
     : (tab === 'count')   ? Stock.view()
     : (tab === 'wants')   ? whWantsTab()
     : whMovesTab();
  return h;
}

/* "Move stock" is the existing move-by-scan panel, which lives in a modal and
   owns the scanner while it is open. Rather than rebuild it as a panel — it
   works, and the scanner ownership in js/app-boot.js is keyed on the modal
   being up — the job button opens it, and the screen behind says so. */
function whMoveTab() {
  return '<div class="wh-open-panel">' +
    '<p class="muted">' + t('wh_job_move_open') + '</p>' +
    '<button class="btn btn-primary btn-lg" data-act="ms-open">' + t('ms_title') + '</button>' +
  '</div>';
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
    var key = (w.product_id || 0) + '|' + (w.variant_sku || w.size || '');
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
        '<td>' + (i === 0 ? '<b>' + esc((back ? DB.variantLabel(back, w.size) : w.size) || '—') + '</b>' : '') + '</td>' +
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

/* Does this product answer what was typed into the find box? Every word has
   to match somewhere — the product's own words, or one of its sizes and their
   three codes, so a scanned barcode or a typed size narrows to the one row.
   An empty box matches everything, which is the page as it always was. */
/* One rule, DB.productMatch, shared with the Products screen's search box —
   and it now takes a scan mangled by an Arabic keyboard layout, which this
   box could not before. */
function whFindMatch(p) {
  return DB.productMatch(p, OG.wh.find);
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

  /* -- and a way to find one thing (ns02) --
     This tab is the only per-size × per-place breakdown in the app, and it
     had no search box at all: answering "have you got that in a 42" meant
     scrolling the whole catalogue, grouped by type, with a customer waiting.
     The box takes a name, a brand, a size, a SKU or a scanned barcode — the
     boxes on these shelves DO carry a label, so the gun works here. */
  h += '<label class="field wh-find"><span>' + t('wh_find') + '</span>' +
    '<input class="inp" id="whFind" type="search" value="' + esc(OG.wh.find || '') + '" ' +
      'placeholder="' + esc(t('wh_find_ph')) + '" data-change="wh-find"></label>';

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
  DB.products.filter(function (p) { return !p.archived && whFindMatch(p); }).forEach(function (p) {
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
        h += '<span class="' + cls + '" title="' + esc(DB.variantLabel(v) + ' · ' + v.shelf) + '">' +
          '<b>' + (DB.shownColour(v) ? DB.swatch(DB.shownColour(v)) + ' ' : '') + esc(v.size) + '</b><i>' + sub + '</i></span>';
      });

      h += '</div></td>' +
        '</tr>';
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
    body += '<option value="' + v.sku + '">' + esc(DB.variantLabel(v)) + ' — ' + esc(parts) + '</option>';
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
      '<th class="num">' + t('po_rate') + '</th><th class="num">' + t('wh_move') + '</th>' +
    '</tr></thead><tbody>';

  sug.forEach(function (s) {
    var p = DB.product(s.productId);
    if (!p) return;
    h += '<tr class="row-late">' +
      '<td><div class="cell-prod">' + thumb(p) + '<span><b>' + esc(p.name) + '</b></span></div></td>' +
      '<td><b>' + esc(DB.variantLabel(DB.variantBySku(s.sku), s.size)) + '</b></td>' +
      '<td class="num"><span class="badge critical">0</span></td>' +
      '<td class="num"><b>' + s.back + '</b></td>' +
      /* One decimal. A single size sells a fraction of a pair per week and the
         raw figure prints as 0.375, which reads like a bug rather than a rate. */
      '<td class="num muted">' + (Math.round(s.rate * 10) / 10) + '/' + t('po_week') + '</td>' +
      '<td class="num"><b>' + s.qty + '</b></td></tr>';
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
        '<td><b>' + esc(DB.variantLabel(DB.variantBySku(s.sku), s.size)) + '</b></td>' +
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
    '<th>' + t('po_due_col') + '</th>' +
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
      '<td>' + poDueCell(po) + '</td>' +
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

/* A due date as the shop's calendar day, with "late" once it has passed and
   the goods are still not in. ymdLocal reads it as local midnight. */
function poDueCell(po) {
  if (!po.dueDate) return '<span class="muted">—</span>';
  var d = ymdLocal(po.dueDate);
  if (!d) return '<span class="muted">—</span>';
  var start = new Date(); start.setHours(0, 0, 0, 0);
  var late = po.status !== 'received' && po.status !== 'cancelled' && d < start;
  return '<span dir="auto" style="white-space:nowrap">' + fmtDate(d) + '</span>' +
    (late ? ' <span class="badge critical">' + t('po_overdue_badge') + '</span>' : '');
}

/* Whether the Add-product form's "More" fold is open, per machine — the back
   room fills brand and shelf every time and the office never does. */
var WH_ADD_MORE_KEY = 'og.wh.addmore';
function whAddMoreOpen() {
  try { return localStorage.getItem(WH_ADD_MORE_KEY) === '1'; } catch (e) { return false; }
}

function whAddTab() {
  var sizes = DB.sizeSets[OG.wh.type] || [];
  var totalPieces = 0, totalCost = 0, totalRev = 0;
  /* Off OG.wh, not off the DOM. The box is blank until somebody types in it
     — it used to be born holding 1050 — so reading the element gave 0 for a
     product whose cost had simply not been entered, which is a different
     thing and the reason `blank is not zero` is a rule in this codebase. */
  var cost = Number(OG.wh.cost) || 0;

  totalPieces = ColourForm.grand();

  var h = '<div class="grid wh-add-grid">';

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

  /* WHAT THE FORM ASKS FIRST, AND WHAT IT ASKS AT ALL (night shift 02).

     Required first, in the order somebody has the information in their hand:
     the name off the box, the category, what the shop will sell it for. Then
     the sizes and their quantities, below. Everything else — brand, made in,
     the colourway, where it lands, which shelf — is under ONE "More" fold,
     shut by default and remembered per machine.

     Two things here were not friction but defects:

     - BRAND AND "MADE IN" WERE DEAD. Both were plain <input>s with no id and
       no data-change; `wh-save` never read them and the POST body carried
       neither, so anything typed was discarded in silence. They are wired to
       OG.wh now and sent, and the server has always accepted them.

     - THE PRICES WERE PRE-FILLED WITH 1050 AND 2250, as literal markup, and
       were not cleared between products. A hurried save booked a real shoe at
       2,250. They start empty, and a blank selling price is refused rather
       than being saved as 0 (which `Number(...) || 0` was doing, while the
       edit modal refused the same blank — two rules for one number). */
  h += '<div>' +
    '<label class="field"><span>' + t('product_name') + '</span>' +
      '<input class="inp" id="whName" type="text" value="' + esc(OG.wh.name) + '" placeholder="OG Heavyweight Tee" data-change="wh-name"></label>' +
    '<div class="' + (seesCost() ? 'row3' : 'row2') + '">' +
      '<label class="field"><span>' + t('type') + '</span><select class="inp" data-change="wh-type">' +
        DB.activeTypes().map(function (ty) {
          return '<option value="' + ty + '"' + (OG.wh.type === ty ? ' selected' : '') + '>' + esc(DB.typeLabels[ty] || ty) + '</option>';
        }).join('') + '</select></label>' +
      '<label class="field"><span>' + t('selling_price') + '</span>' +
        '<input class="inp num" id="whPrice" type="number" min="0" value="' + esc(OG.wh.price || '') +
          '" placeholder="0" data-change="wh-recalc"></label>' +
      /* Someone booking goods in without cost.read enters what the shop sells
         it for, not what it was bought for. The field is left out rather than
         disabled, because a disabled box invites a guess — and a guessed cost
         price is worse than a missing one: it quietly poisons every margin
         and profit figure the manager reads afterwards. */
      (seesCost()
        ? '<label class="field"><span>' + t('cost_price') + '</span>' +
            '<input class="inp num" id="whCost" type="number" min="0" value="' + esc(OG.wh.cost || '') +
              '" placeholder="' + esc(t('wh_cost_blank')) + '" data-change="wh-recalc"></label>'
        : '') +
    '</div>' +
    (seesCost() ? '' :
      '<div class="partner-note">' + t('wh_cost_later') + '</div>') +

    /* ---- everything rarer, behind one fold ---- */
    '<div class="wh-fold' + (whAddMoreOpen() ? ' open' : '') + '">' +
      '<button class="wh-more-h" data-act="wh-add-more">' + t('wh_more_fields') +
        '<span class="wh-more-x">' + (whAddMoreOpen() ? '−' : '+') + '</span></button>' +
      (whAddMoreOpen()
        ? '<div class="wh-fold-b">' +
            '<div class="row2">' +
              '<label class="field"><span>' + t('brand') + '</span>' +
                '<input class="inp" id="whBrand" type="text" value="' + esc(OG.wh.brand || '') +
                  '" placeholder="OG" data-change="wh-brand"></label>' +
              '<label class="field"><span>' + t('made_in') + '</span>' +
                '<input class="inp" id="whMade" type="text" value="' + esc(OG.wh.madeIn || '') +
                  '" placeholder="Syria" data-change="wh-made"></label>' +
            '</div>' +
            '<div class="row2">' +
              '<label class="field"><span>' + t('colour') + '</span>' +
                '<input class="inp" id="whWay" type="text" value="' + esc(OG.wh.colorway || '') +
                  '" data-change="wh-colorway"></label>' +
            /* WHERE IT LANDS AND WHERE IT GOES. Both left out entirely without
               stock.move, for the same reason the cost box is: putting a pair
               on a shelf is a stock movement, and the server refuses one from
               an account that cannot make them. A select he can work but not
               save is worse than no select — he would find out at the end,
               having already chosen. Without it the goods still arrive, at the
               intake warehouse, unshelved. */
              (allow('stock.move')
                ? '<label class="field"><span>' + t('wh_intake') + '</span>' +
                    '<select class="inp" data-change="wh-warehouse">' +
                      DB.warehouses.map(function (w) {
                        return '<option value="' + esc(w.id) + '"' + (w.id === whAddWh() ? ' selected' : '') +
                          '>' + esc(DB.whName(w.id, OG.lang === 'ar')) + '</option>';
                      }).join('') +
                    '</select></label>'
                : '') +
            '</div>' +
            (allow('stock.move')
              /* Painted empty and disabled because the rooms are live server
                 state, not part of the hydrated catalogue — bindWarehouse
                 fills it once they land. Disabled until then so nobody picks
                 out of a list that is about to be replaced. */
              ? '<label class="field"><span>' + t('shelf_box') + '</span>' +
                  '<select class="inp" id="whShelf" data-change="wh-shelf" disabled>' +
                    '<option value="">' + t('loading') + '</option>' +
                  '</select></label>'
              : '') +
          '</div>'
        : '') +
    '</div>' +
  '</div></div>';

  /* 058 — colours, each with its own sizes and quantities (js/colourform.js).
     The size run is the category's; the codes are issued on save. */
  h += '<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:14px">' +
    '<span class="lbl">' + t('size_matrix') + ' — ' + esc(DB.typeLabels[OG.wh.type] || '') + '</span>' +
    ColourForm.html() + '</div>';

  /* "Save & print labels" rather than a print button beside Save: the codes
     on the sticker are issued by the server when the product is saved, so
     there is nothing true to print before that. One press saves, and the
     preview opens on the sizes just created with the quantities just booked. */
  /* WHICH ONE IS THE PRIMARY (ns02). These were two buttons of the same size
     side by side — "Save product to warehouse" in lime, and "Save & print
     labels" beside it — with nothing to say that the first one prints
     nothing, although the second is a superset of it and the boxes cannot be
     scanned until they carry a sticker. Printing is the lime one now, and the
     plain one says what it does NOT do. */
  var canPrint = allow('label.print');
  h += '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
    (canPrint
      ? '<button class="btn btn-primary btn-lg" data-act="wh-save-print"' +
          (totalPieces ? '' : ' disabled') + '>' + t('wh_save_print') + '</button>' +
        '<button class="btn btn-lg" data-act="wh-save">' + t('wh_save_no_labels') + '</button>'
      : '<button class="btn btn-primary btn-lg" data-act="wh-save">' + t('save_product') + '</button>') +
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
  /* Read off OG.wh and NOT defaulted to the old 1050 / 2250 (ns02). Those
     numbers were invented, and the preview quoting them as "total cost" and
     "expected revenue" over a product whose prices nobody had typed made an
     invented figure look like arithmetic. Nothing typed, nothing claimed. */
  var cost = Number(OG.wh.cost) || 0;
  var price = Number(OG.wh.price) || 0;
  var totalCost = totalPieces * cost;
  var totalRev = totalPieces * price;

  /* No wrapping <div> here: #whPreview in whAddTab IS this column. */
  h += '<div class="card"><div class="card-head"><h3>' + t('wh_sizes_going_in') + '</h3></div>' +
    '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('size') + '</th><th class="num">' + t('qty') + '</th><th>' + t('barcode') + '</th></tr></thead><tbody>';
  var any = false;
  var many = ColourForm.list().length > 1;
  ColourForm.list().forEach(function (c, i) {
    sizes.forEach(function (s) {
      var q = Number(c.qty[s] || 0);
      if (!q) return;
      any = true;
      h += '<tr><td><b dir="ltr">' + esc(s) + '</b>' +
        (many ? ' <span class="line-colour">' + '<span class="cp-sw" style="background:' + (c.hex || '#3F3F46') + '"></span>' +
                esc(ColourForm.label(c, i)) + '</span>' : '') + '</td>' +
        '<td class="num">' + q + '</td>' +
        '<td class="muted small">' + t('wh_code_on_save') + '</td></tr>';
    });
  });
  if (!any) {
    h += '<tr><td colspan="3" class="muted small" style="text-align:center;padding:18px">' + t('wh_no_sizes_yet') + '</td></tr>';
  }
  h += '</tbody><tfoot><tr><td>' + t('total_pieces') + '</td><td class="num">' + totalPieces + '</td><td></td></tr></tfoot></table></div>' +
    '<div class="partner-note" style="margin:0 14px 14px">' + t('wh_codes_note') + '</div></div>';

  /* Expected revenue is selling price × pieces — no cost in it, so it stays
     for everyone. Total cost does not.

     A figure with no price behind it draws a dash, never a zero: "Expected
     revenue 0" over a product whose price has not been typed yet is a claim,
     and the wrong one. */
  var dash = '<span class="muted">—</span>';
  h += '<div class="grid mt" style="grid-template-columns:' + (seesCost() ? '1fr 1fr' : '1fr') + '">' +
    (seesCost()
      ? '<div class="stat"><span class="eyebrow">' + t('total_cost') + '</span><div class="val">' +
          (cost > 0 ? moneyShort(totalCost) : dash) + '</div></div>'
      : '') +
    '<div class="stat"><span class="eyebrow">' + t('expected_revenue') + '</span><div class="val accent">' +
      (price > 0 ? moneyShort(totalRev) : dash) + '</div></div>' +
  '</div>';


  return h;
}

/* Called on every keystroke in a size box. Touches three things and leaves
   the rest of the page — and the caret — exactly where they were. */
function repaintWhAdd() {
  var sizes = DB.sizeSets[OG.wh.type] || [];
  var total = ColourForm.grand();

  var box = document.getElementById('whPreview');
  if (box) box.innerHTML = whAddPreview(sizes, total);

  /* Nothing to print until something has a quantity. */
  var labels = document.querySelector('[data-act="wh-save-print"]');
  if (labels) labels.disabled = !total;
}

/* THE MOVEMENT LOG. Seven columns, not ten.

   It had one column each for SKU, balance, user and note beside the six that
   matter, so the table was 1,557px wide inside a 1,154px card and scrolled
   sideways — the balance and the reason, which are the two things an argument
   about stock turns on, were off the right edge. The SKU now sits under the
   product name where somebody comparing a sticker reads it, and the person is
   under the reason they gave.

   It also had `max-height: calc(100vh - 240px); overflow-y: auto` inline,
   which put a second scrollbar inside a page that already scrolls: the wheel
   did one thing over the table and another beside it, and the "cannot be
   deleted" note under it could only be reached by scrolling the OUTER bar
   past a box that was swallowing the wheel. The page scrolls. */
/* ---- MOVE BY SCAN ---------------------------------------------------------
   The job this screen was missing: somebody carries pairs out of the back
   room and onto the shop floor, and the system should learn about it by being
   shown the same barcodes he is already holding. Until now that was the
   per-product transfer dialog — find the product, pick the size, type a
   quantity, once per item.

   IT COLLECTS FIRST AND MOVES ON CONFIRM, and that is not a preference.
   `Shop.write` has a one-write-at-a-time gate (`if (busy) return`) that
   SILENTLY drops a second write while the first is in flight — right for a
   button somebody double-taps, fatal for a scanner gun, which can put three
   codes in before one round trip finishes. Scanning into a local list costs
   nothing and loses nothing; the whole list then goes as one confirmed
   action. It is also how the stock count works, and for the same reason.

   Module-scoped, one session at a time, the same shape as `quickPick` in
   js/app-print-labels.js. */
var moveScan = null;   // { from, to, lines: [{ sku, qty }] }

function moveScanOwns() { return !!moveScan; }

/* Which way this machine last carried stock. Per MACHINE, like the sidebar
   rail and the Settings folds: the back-room laptop spends its day going
   store → floor and the office one does not. It was reset to store → floor on
   every single open, so somebody doing ten trips the other way pressed the
   swap button ten times. */
var MS_WAY_KEY = 'og.wh.moveway';

function moveWay() {
  var from = DB.intakeWh, to = DB.defaultWh;
  try {
    var raw = localStorage.getItem(MS_WAY_KEY);
    if (raw) {
      var w = JSON.parse(raw);
      var ok = function (id) { return DB.warehouses.some(function (x) { return x.id === id; }); };
      /* A place that has since been renamed away, or a stored pair that has
         gone the same on both ends, falls back rather than opening a panel
         whose From and To are the same place. */
      if (w && ok(w.from) && ok(w.to) && w.from !== w.to) { from = w.from; to = w.to; }
    }
  } catch (e) { /* private window, or somebody's hand-edited JSON */ }
  return { from: from, to: to };
}

function rememberMoveWay() {
  if (!moveScan || moveScan.from === moveScan.to) return;
  try {
    localStorage.setItem(MS_WAY_KEY, JSON.stringify({ from: moveScan.from, to: moveScan.to }));
  } catch (e) {}
}

function openMoveScan() {
  if (!allow('stock.move')) { toast(t('wh_move'), t('no_access'), 'err'); return; }
  var way = moveWay();
  moveScan = { from: way.from, to: way.to, lines: [] };
  openModal({
    title: t('ms_title'),
    /* Wide: this is a working surface with a table on it, not a question.
       At the default width the product name wrapped to three lines and each
       row stood three deep, which on a list of a dozen sizes is a scroll. */
    size: 'wide',
    body: moveScanBody(),
    foot: moveScanFoot(),
    onClose: function () { moveScan = null; }
  });
  moveScanFocus();
}

/* Everything about one scanned size, recomputed rather than stored: the stock
   at the FROM place moves under this panel (a sale, another till), and a
   number captured when it was scanned would be the one thing on screen that
   was true a minute ago. */
function moveScanRows() {
  if (!moveScan) return [];
  return moveScan.lines.map(function (l) {
    var v = DB.variantBySku(l.sku);
    var p = v ? DB.product(v.productId) : null;
    return { line: l, v: v, p: p, have: v ? DB.stockAt(v, moveScan.from) : 0 };
  }).filter(function (r) { return r.v && r.p; });
}

function moveScanTotal() {
  return moveScanRows().reduce(function (n, r) { return n + Math.min(r.line.qty, r.have); }, 0);
}

function moveScanBody() {
  var ar = OG.lang === 'ar';
  var opts = function (sel) {
    return DB.warehouses.map(function (w) {
      return '<option value="' + w.id + '"' + (w.id === sel ? ' selected' : '') + '>' +
        esc(DB.whName(w.id, ar)) + '</option>';
    }).join('');
  };

  var h = '<div class="ms-route">' +
      '<label class="field"><span>' + t('wh_from') + '</span>' +
        '<select class="inp" data-change="ms-from">' + opts(moveScan.from) + '</select></label>' +
      '<button class="btn btn-ghost ms-swap" data-act="ms-swap" title="' + esc(t('ms_swap')) + '">&#8646;</button>' +
      '<label class="field"><span>' + t('wh_to') + '</span>' +
        '<select class="inp" data-change="ms-to">' + opts(moveScan.to) + '</select></label>' +
    '</div>';

  /* The box is here for a typed SKU and to hold the caret; the scanner gun
     does not need it — js/wedge.js reads the keys at the document and this
     panel is given them by the router in app-boot.js. */
  h += '<div class="ms-input">' +
      '<input class="inp" id="msCode" autocomplete="off" spellcheck="false" ' +
        'placeholder="' + esc(t('ms_scan_hint')) + '">' +
      '<button class="btn" data-act="ms-camera">' + t('ms_camera') + '</button>' +
    '</div>';

  var rows = moveScanRows();
  if (!rows.length) {
    h += '<div class="ms-empty"><b>' + t('ms_empty') + '</b><small>' + t('ms_empty_sub') + '</small></div>';
    return h;
  }

  h += '<div class="table-wrap ms-list"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('product') + '</th><th>' + t('size') + '</th>' +
      '<th class="num">' + t('ms_available') + '</th>' +
      '<th class="num">' + t('ms_moving') + '</th><th></th>' +
    '</tr></thead><tbody>';

  rows.forEach(function (r) {
    /* More scanned than the place holds is a real thing to do by accident —
       the same box counted twice. Said on the row rather than refused at the
       end, and the move clamps to what is there. */
    var over = r.line.qty > r.have;
    h += '<tr' + (over ? ' class="row-danger"' : '') + '>' +
      '<td><div class="cell-prod">' + thumb(r.p) + '<span><b>' + esc(r.p.name) + '</b>' +
        '<small dir="ltr">' + esc(r.v.sku) + '</small></span></div></td>' +
      '<td><b>' + esc(DB.variantLabel(r.v)) + '</b></td>' +
      '<td class="num' + (over ? ' mv-delta mv-down' : ' muted') + '">' + r.have + '</td>' +
      '<td class="num"><input class="inp num" type="number" min="1" max="99" value="' + r.line.qty +
        '" style="width:64px" data-change="ms-qty" data-sku="' + esc(r.v.sku) + '"></td>' +
      '<td><button class="btn btn-sm btn-ghost" data-act="ms-drop" data-sku="' + esc(r.v.sku) + '" ' +
        'title="' + esc(t('remove')) + '">&times;</button></td>' +
    '</tr>';
  });

  h += '</tbody></table></div>';

  var over = rows.filter(function (r) { return r.line.qty > r.have; }).length;
  if (over) h += '<div class="partner-note note-warn mt">' + t('ms_over').replace('{n}', over) + '</div>';
  return h;
}

function moveScanFoot() {
  var n = moveScanTotal();
  return '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
    '<button class="btn btn-primary" data-act="ms-go"' + (n ? '' : ' disabled') + '>' +
      t('ms_move_n').replace('{n}', n) + '</button>';
}

/* Patched in place, never through render(): the panel holds a list somebody
   is building and a caret in the scan box, and a repaint of the screen
   underneath would take both away mid-scan. */
function moveScanRepaint() {
  var root = document.getElementById('modal-root');
  if (!root || !moveScan) return;
  var body = root.querySelector('.modal-body');
  var foot = root.querySelector('.modal-foot');
  if (body) body.innerHTML = moveScanBody();
  if (foot) foot.innerHTML = moveScanFoot();
  moveScanFocus();
}

function moveScanFocus() {
  setTimeout(function () {
    var el = document.getElementById('msCode');
    if (!el) return;
    el.focus();
    /* Bound on the element each repaint rather than delegated: the box is
       replaced by moveScanRepaint, and Enter here means "take what I typed",
       which is not a data-act on a button anywhere. */
    if (!el.__wired) {
      el.__wired = true;
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var code = el.value.trim();
        el.value = '';
        if (code) moveScanned(code);
      });
    }
  }, 30);
}

/* One scanned code. Adds a piece, or a second piece of a size already on the
   list — a warehouse worker scans the same box twice because he is moving two
   of them, not because he made a mistake. */
function moveScanned(raw) {
  if (!moveScan) return false;
  var code = String(raw || '').trim();
  if (!code) return false;

  var list = DB.variantsByCode(code);
  if (!list.length) { toast(t('ms_title'), t('sc_unknown') + ' · ' + code.slice(0, 24), 'err', 3000); return false; }
  if (list.length > 1) {
    /* 058 — which colour is in his hand: the ones held at the FROM place. The
       sheet opens over the panel, which comes back when it closes. */
    ColourPick.choose(list, { whId: moveScan.from, needStock: true }, function (pickd) {
      if (pickd) moveScanned(pickd.sku);
    });
    return true;
  }
  var v = list[0];

  var p = DB.product(v.productId);
  var have = DB.stockAt(v, moveScan.from);
  if (have <= 0) {
    /* Named, not "out of stock": it may be sitting on the floor already, and
       "there are none in the back" is the sentence that tells him which. */
    toast(p ? p.name : t('ms_title'),
          t('ms_none_at').replace('{place}', DB.whName(moveScan.from, OG.lang === 'ar')), 'err', 4000);
    return false;
  }

  var found = null;
  for (var i = 0; i < moveScan.lines.length; i++) {
    if (moveScan.lines[i].sku === v.sku) { found = moveScan.lines[i]; break; }
  }
  if (found) found.qty += 1;
  /* Newest first: the thing just scanned is the thing to check. */
  else moveScan.lines.unshift({ sku: v.sku, qty: 1 });

  var qty = found ? found.qty : 1;
  moveScanRepaint();
  toast((p ? p.name : v.sku) + ' · ' + t('size') + ' ' + DB.variantLabel(v),
        t('ms_on_list').replace('{n}', qty), 'ok', 1400);
  return true;
}

/* The whole list, in one confirmed action.

   Sent one transfer per line INSIDE a single Shop.write, so the busy gate is
   held for the batch rather than dropping the second line on the floor. They
   are chained rather than fired together because each is its own transaction
   on the server and a queue of them against one SQLite file is how a
   `busy_timeout` becomes a failed move.

   NOT atomic, and it does not pretend to be: if line four is refused, the
   three before it have moved and the report names what did and what did not.
   The alternative — a bulk endpoint that rolls the lot back — would undo real
   shelf work somebody has already done with their hands. */
function moveScanCommit() {
  if (!moveScan) return;
  var from = moveScan.from, to = moveScan.to;
  if (from === to) { toast(t('ms_title'), t('wh_from') + ' = ' + t('wh_to'), 'err'); return; }

  var plan = moveScanRows().map(function (r) {
    return { sku: r.v.sku, name: r.p.name, size: r.v.size, qty: Math.min(r.line.qty, r.have) };
  }).filter(function (x) { return x.qty > 0; });
  if (!plan.length) { toast(t('ms_title'), t('out_of_stock'), 'err'); return; }

  /* The reason column in the movement log used to read "Carried to the floor"
     for EVERY move, whichever way the stock actually went — so a store→floor
     and a floor→store move were indistinguishable in the one place somebody
     looks when arguing about stock. It names both ends now. */
  var note = t('ms_note_way')
    .replace('{from}', DB.whName(from, OG.lang === 'ar'))
    .replace('{to}', DB.whName(to, OG.lang === 'ar'));
  var moved = [], failed = [];

  Shop.write(
    function () {
      return plan.reduce(function (chain, x) {
        return chain.then(function () {
          return Shop.transfer(x.sku, from, to, x.qty, note)
            .then(function () { moved.push(x); })
            .catch(function (err) { failed.push({ x: x, err: err }); });
        });
      }, Promise.resolve());
    },
    function () {
      plan.forEach(function (x) {
        var v = DB.variantBySku(x.sku);
        if (v) { DB.transfer(v, from, to, x.qty, t('admin')); moved.push(x); }
      });
    },
    function () {
      closeModal();
      var pieces = moved.reduce(function (n, x) { return n + x.qty; }, 0);
      if (pieces) {
        toast(t('wh_move_done'),
              pieces + ' ' + t('pieces') + ' · ' +
                DB.whName(from, OG.lang === 'ar') + ' → ' + DB.whName(to, OG.lang === 'ar'),
              'ok', 4000);
      }
      if (failed.length) {
        toast(t('ms_some_failed').replace('{n}', failed.length),
              (API.friendly ? API.friendly(failed[0].err) : String(failed[0].err.message || '')),
              'err', 9000);
      }
      render();
    }
  );
}

/* How many rows the log draws. Read by js/bulk.js's select-all too — the day
   those two disagreed on the Products screen, one tick box put five thousand
   invisible rows a click from an action. */
var MOVES_SHOWN = 90;

function whMovesTab() {
  var ar = OG.lang === 'ar';
  var cap = DB.cap('movements');
  var rows = DB.stockMovements.slice(0, MOVES_SHOWN);

  var h = '<div class="card table-wrap"><table class="tbl tbl-moves"><thead><tr>' +
      '<th class="bk-col">' + Bulk.headBox('movements') + '</th>' +
      '<th>' + t('date') + '</th>' +
      '<th>' + t('movement') + '</th>' +
      '<th>' + t('product') + '</th>' +
      '<th>' + t('wh_location') + '</th>' +
      '<th class="num">' + t('qty') + '</th>' +
      '<th class="num">' + t('balance') + '</th>' +
      '<th>' + t('notes') + '</th>' +
    '</tr></thead><tbody>';

  if (!rows.length) {
    h += '<tr><td colspan="8" class="muted" style="text-align:center;padding:28px">' + t('none') + '</td></tr>';
  }

  rows.forEach(function (mv, mi) {
    var p = DB.product(mv.productId);
    /* A transfer writes two rows — one leaving, one arriving — so the sign is
       what says which end of it this is. An arrow beside the place reads at a
       glance where a wall of them is mostly going. */
    var arrow = mv.type === 'transfer' ? (mv.delta > 0 ? '→ ' : '← ') : '';

    h += '<tr' + (Bulk.has('movements', mv.id) ? ' class="bk-on"' : '') + '>' +
      '<td class="bk-col">' + Bulk.box('movements', mv.id, mi) + '</td>' +

      '<td class="nowrap"><div class="mv-when"><b>' + fmtDate(mv.date) + '</b>' +
        '<small dir="ltr">' + fmtTimeOnly(mv.date) + '</small></div></td>' +

      '<td><span class="badge ' +
        (mv.type === 'damaged' ? 'critical' : mv.delta > 0 ? 'healthy' : 'neutral') +
        '">' + t(mv.type) + '</span></td>' +

      /* Name, then size and SKU on one quiet line: the sticker on the box
         carries the SKU and somebody holding it needs to match the two. */
      '<td><div class="cell-prod">' + (p ? thumb(p) : '') +
        '<span><b>' + esc(p ? p.name : '—') + '</b>' +
        '<small class="nowrap">' + t('size') + ' ' + esc(DB.variantLabel(DB.variantBySku(mv.sku), mv.size)) +
          ' · <span dir="ltr">' + esc(mv.sku) + '</span></small></span></div></td>' +

      /* Rows written before places existed carry no wh; a dash, never a
         location they were not recorded in. */
      '<td class="nowrap">' + (mv.wh
        ? '<span class="badge neutral">' + esc(arrow + DB.whName(mv.wh, ar)) + '</span>'
        : '<span class="muted">—</span>') + '</td>' +

      '<td class="num"><span class="mv-delta ' + (mv.delta > 0 ? 'mv-up' : 'mv-down') + '" dir="ltr">' +
        (mv.delta > 0 ? '+' : '') + mv.delta + '</span></td>' +

      '<td class="num"><b>' + mv.balance + '</b></td>' +

      '<td class="mv-why"><span>' + esc(mv.note || '—') + '</span>' +
        '<small>' + esc(mv.user || '') + '</small></td>' +
    '</tr>';
  });

  h += '</tbody></table></div>';

  /* THE WINDOW, said out loud. This drew the most recent rows and claimed
     nothing, which is the mistake this codebase has made most often. Two caps
     stack here: the server sends a window of the log, and this table draws a
     window of that. */
  var shown = rows.length;
  var total = cap && cap.total ? cap.total : DB.stockMovements.length;
  if (shown < total || (cap && cap.capped)) {
    h += cappedNote({ shown: shown, total: total, capped: true }, t('tab_moves').toLowerCase());
  }

  h += '<div class="partner-note mt">' + t('wh_moves_note') + '</div>';
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
