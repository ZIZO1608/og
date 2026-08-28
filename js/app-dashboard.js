/* ==========================================================================
   OG SYSTEM — application shell  ·  6/17: DASHBOARD + per-role home screens
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 2165-2555). Loads after
   app-shell.js.
   ========================================================================== */

/* ------------------------------------------------------------- 7. DASHBOARD */

function sumSalesRange(from, to) {
  return DB.sales.reduce(function (s, x) { return (x.date >= from && x.date < to) ? s + x.total : s; }, 0);
}

function sumSalesOn(dayOffset) { return sumSalesRange(daysAgo(dayOffset), daysAgo(dayOffset - 1)); }

/* Month-to-date. Comparing a half-finished August against a whole July would
   read as a collapse, so both sides use the same 1st-to-today window. */
function monthToDate(monthsBack) {
  var start = new Date(TODAY.getFullYear(), TODAY.getMonth() - monthsBack, 1);
  var end = new Date(start.getFullYear(), start.getMonth(), 1);
  end.setDate(end.getDate() + TODAY.getDate());
  return sumSalesRange(start, end);
}

function buildAlerts() {
  var out = [];

  /* Size gaps — the three products with holes in the popular middle sizes. */
  var gapped = [];
  DB.products.forEach(function (p) {
    DB.sizeGaps(p.id).forEach(function (sz) { gapped.push({ p: p, size: sz }); });
  });
  gapped.slice(0, 3).forEach(function (g) {
    out.push({
      tone: 'red', icon: '!',
      text: esc(g.p.name) + ' — ' + t('size') + ' ' + g.size + ' ' + t('out_of_stock').toLowerCase(),
      sub: t('total_stock') + ': ' + DB.totalQty(g.p.id) + ' ' + t('units').toLowerCase(),
      view: 'products', pid: g.p.id
    });
  });

  DB.printJobs.filter(function (j) { return DB.isOverdue(j); }).slice(0, 2).forEach(function (j) {
    var n = DB.daysSince(j.deadline);
    out.push({
      tone: 'red', icon: 'P',
      text: t('print_job') + ' #' + j.id + ' ' + t('for_word') + ' ' + esc(j.customer.split(' ')[0]) +
            ' — ' + n + ' ' + t(n === 1 ? 'day_overdue' : 'days_overdue'),
      sub: j.qty + ' pcs · ' + t(j.priority) + ' · ' + t('deadline') + ' ' + fmtDate(j.deadline),
      view: 'print'
    });
  });

  DB.suppliers.filter(function (s) { return s.outstanding > 0 && DB.daysSince(s.dueDate) >= -7; })
    .sort(function (a, b) { return a.dueDate - b.dueDate; }).slice(0, 2).forEach(function (s) {
      var n = DB.daysSince(s.dueDate);
      var when = n > 0
        ? (t('payment_overdue') + ' ' + n + ' ' + t(n === 1 ? 'day_word' : 'days'))
        : (t('payment_due') + ' ' + relDate(s.dueDate));
      out.push({
        tone: n > 0 ? 'red' : 'amber', icon: '$',
        text: t('supplier') + ' ' + esc(s.name) + ' — ' + when,
        sub: money(s.outstanding) + ' · ' + fmtDate(s.dueDate),
        view: 'reports', tab: 'suppliers'
      });
    });

  var inactive = DB.inactiveCustomers(90).length;
  out.push({
    tone: 'amber', icon: 'C',
    text: inactive + ' ' + (OG.lang === 'ar' ? 'زبون لم يشترِ منذ ٩٠ يوماً' : "customers haven't purchased in 90 days"),
    sub: OG.lang === 'ar' ? 'أرسل لهم رسالة واتساب بضغطة' : 'One tap sends them a WhatsApp message',
    view: 'customers', filter: 'risk'
  });

  var dead = DB.products.slice().sort(function (a, b) { return b.lastSoldDaysAgo - a.lastSoldDaysAgo; })[0];
  var deadQty = DB.totalQty(dead.id);
  var deadShelf = (DB.variantsOf(dead.id)[0] || {}).shelf || '—';
  out.push({
    tone: 'grey', icon: 'Z',
    text: esc(dead.name) + ' — ' + (OG.lang === 'ar'
      ? ('لم يُبَع منذ ' + dead.lastSoldDaysAgo + ' يوماً')
      : ("hasn't sold in " + dead.lastSoldDaysAgo + ' days')) +
      ' — ' + deadQty + ' pcs · ' + deadShelf,
    sub: t('stock_value') + ': ' + money(deadQty * dead.costPrice),
    view: 'products', pid: dead.id
  });

  return out;
}

/* -------------------------------------------------------- 7c. RECEIPT BANDS
   The manager dashboard, rebuilt around one receipt-inspired idea: a tear
   line — a full-width dashed rule, .dash-tear in css/inputs-dashboard-pos.css
   — separating three strict bands (the total, what needs a decision, the
   story) instead of a wall of equal stat cards. Built entirely from the
   app's existing tokens (--brand accent, .stat/.delta/.alert-row/.chip
   components) — no new colour palette. See the Dashboard Programme plan for
   the reasoning.

   OG.dashScope ('today' | '7d' | '30d') is the one state variable that
   drives every band, same pattern as OG.lbf/OG.prod elsewhere. */

function scopeRange(scope) {
  if (scope === '30d') return { from: daysAgo(29), to: daysAgo(-1) };
  if (scope === '7d')  return { from: daysAgo(6),  to: daysAgo(-1) };
  return { from: daysAgo(0), to: daysAgo(-1) }; // today
}

function sumSalesForScope(scope) {
  var r = scopeRange(scope);
  return sumSalesRange(r.from, r.to);
}

/* The baseline Band 1's delta compares against — mean of the last 7
   individual days' takings, via the existing sumSalesOn(). */
function avg7dTakings() {
  var total = 0;
  for (var i = 0; i < 7; i++) total += sumSalesOn(i);
  return total / 7;
}

/* USD primary + SYP secondary shown AT ONCE (unlike money()/moneyStat(),
   which show one currency toggled by OG.currency) — Band 1's whole point is
   proving the frozen rate, so both must be on screen together. Digits are
   wrapped dir="ltr" so the browser cannot reorder them inside an Arabic
   line; the currency tag sits outside that span so it still flows with the
   page's own direction. */
function heroMoney(syp) {
  var usd = (Number(syp) || 0) / CONFIG.EXCHANGE_RATE;
  return {
    primary: '$<span dir="ltr" class="num">' + nf(usd) + '</span>',
    secondary: '<span dir="ltr" class="num">' + nf(syp) + '</span>' +
      '<span class="cur">' + (OG.lang === 'ar' ? 'ل.س' : 'SYP') + '</span>'
  };
}

/* Revenue/cost re-derived per line item within the scope window — the same
   fields DB.profitByType() reads (it.qty/unitPrice/unitCost), just windowed
   by date since profitByType() covers all-time. Only ever called behind
   seesProfit(), same as the rest of the app's margin displays. */
function scopedMarginPct(scope) {
  var r = scopeRange(scope), revenue = 0, cost = 0;
  DB.sales.forEach(function (s) {
    if (s.date < r.from || s.date >= r.to) return;
    s.items.forEach(function (it) { revenue += it.qty * it.unitPrice; cost += it.qty * it.unitCost; });
  });
  return revenue ? (revenue - cost) / revenue * 100 : 0;
}

/* Without profit.read the third shelf stat becomes Returns — a real count,
   not a placeholder: js/data.js already models a customer return as a
   'returned' stock-movement type. */
function scopedReturns(scope) {
  var r = scopeRange(scope);
  return DB.stockMovements.filter(function (m) {
    return m.type === 'returned' && m.date >= r.from && m.date < r.to;
  }).length;
}

/* Sales whose discount exceeds today's cap — real signal, not always empty:
   the seed already includes 15%-discount sales against a 10% cap. */
function discountRequests(scope) {
  var r = scopeRange(scope);
  return DB.sales.filter(function (s) {
    return s.date >= r.from && s.date < r.to && s.discount > 0 &&
      (s.discount / s.subtotal * 100) > CONFIG.MAX_DISCOUNT_PCT;
  });
}

/* Band 2 — a derived action queue, NOT the dashboard's older buildAlerts()
   mix (that stays, used elsewhere — see js/app-export.js's day summary and
   the alert-fix action). Only 3 of the design programme's 5 signals have a
   real demo-data source: deliveries (COD outstanding, failed runs) require
   a real server by design (js/deliveries.js) and are never faked in demo
   mode, so those two rows simply never appear here. */
function bandTwoRows(scope) {
  var rows = [];
  var crit = DB.criticalVariants().length;
  if (crit > 0) {
    rows.push({
      tone: 'red', icon: '!',
      text: crit + ' ' + t('dash_low_stock_row'),
      view: 'warehouse'
    });
  }
  var pendingPrint = DB.printJobs.filter(function (j) { return j.stage !== 'done'; }).length;
  if (pendingPrint > 0) {
    rows.push({
      tone: 'amber', icon: 'P',
      text: pendingPrint + ' ' + t('dash_print_waiting_row'),
      view: 'print'
    });
  }
  var discReq = discountRequests(scope);
  if (discReq.length > 0) {
    rows.push({
      tone: 'amber', icon: '%',
      text: discReq.length + ' ' + t('dash_discount_row'),
      view: 'reports'
    });
  }
  return rows;
}

function viewDashboard() {
  OG.dashScope = OG.dashScope || 'today';
  var scope = OG.dashScope;
  var scopeTotal = sumSalesForScope(scope);
  var r = scopeRange(scope);
  var salesInScope = DB.sales.filter(function (s) { return s.date >= r.from && s.date < r.to; });
  var avgBasket = salesInScope.length ? scopeTotal / salesInScope.length : 0;
  var hero = heroMoney(scopeTotal);

  var h =
    '<div class="page-head"><div><h1>' + t('dash_title') + '</h1>' +
    '<div class="sub">' + t('dash_sub') + ' · ' + fmtDate(TODAY) + '</div></div>' +
    '<div class="head-actions">' +
      exportButtons() +
      '<button class="btn btn-ghost" data-act="day-summary">' + t('wa_send_day') + '</button>' +
      ifNav('pos', '<button class="btn btn-primary" data-act="nav" data-view="pos">' + t('nav_pos') + '</button>') +
    '</div></div>';

  /* -- scope selector + frozen-rate line, above Band 1 -- */
  h += '<div class="chip-row"><span class="lbl-lbl">' + t('dash_scope_label') + '</span>';
  [['today', 'dash_scope_today'], ['7d', 'dash_scope_7d'], ['30d', 'dash_scope_30d']].forEach(function (o) {
    h += '<button class="chip ' + (scope === o[0] ? 'on' : '') + '" data-act="dash-scope" data-k="' + o[0] + '">' +
      t(o[1]) + '</button>';
  });
  h += '</div>';
  h += '<div class="muted small mt">' + t('dash_rate_frozen').replace('{rate}', nf(CONFIG.EXCHANGE_RATE)) + '</div>';

  /* ============================================================ BAND 1 -- */
  h += '<hr class="dash-tear">';
  h += '<div class="dash-hero"><span class="eyebrow">' + t('dash_takings') + '</span>' +
    '<div class="dash-hero-val">' + hero.primary + '</div>' +
    '<div class="dash-hero-sub">' + hero.secondary + '</div>' +
    deltaTag(scopeTotal, avg7dTakings(), t('vs_7d_avg')) +
  '</div>';

  h += '<div class="grid stat-row mt">';
  h += '<div class="stat"><span class="eyebrow">' + t('invoices') + '</span>' +
    '<div class="val">' + nf(salesInScope.length) + '</div></div>';
  h += '<div class="stat"><span class="eyebrow">' + t('avg_basket') + '</span>' +
    '<div class="val">' + moneyStat(avgBasket) + '</div></div>';
  if (seesProfit()) {
    h += '<div class="stat"><span class="eyebrow">' + t('margin') + '</span>' +
      '<div class="val">' + pct(scopedMarginPct(scope)) + '</div></div>';
  } else {
    h += '<div class="stat"><span class="eyebrow">' + t('returns') + '</span>' +
      '<div class="val">' + nf(scopedReturns(scope)) + '</div></div>';
  }
  h += '</div>';

  /* ============================================================ BAND 2 -- */
  h += '<hr class="dash-tear">';
  var rows = bandTwoRows(scope);
  h += '<div class="card" id="attentionPanel"><div class="card-head">' +
       '<h3>' + t('needs_attention') + '</h3>' +
       '<div class="card-actions"><span class="badge ' + (rows.length ? 'critical' : 'healthy') + '">' +
         rows.length + '</span></div></div>';
  if (!rows.length) {
    h += '<div class="cart-empty"><b>' + t('dash_nothing_waiting') + '</b>' + t('dash_shop_clean') + '</div>';
  } else {
    rows.forEach(function (a) {
      h += ifNav(a.view,
        '<div class="alert-row clickable" data-act="nav" data-view="' + a.view + '">' +
          '<span class="alert-ico ' + a.tone + '">' + a.icon + '</span>' +
          '<span class="alert-txt">' + a.text + '</span>' +
          '<span class="alert-chevron">›</span>' +
        '</div>') ||
        ('<div class="alert-row">' +
          '<span class="alert-ico ' + a.tone + '">' + a.icon + '</span>' +
          '<span class="alert-txt">' + a.text + '</span>' +
        '</div>');
    });
  }
  h += '</div>';

  /* ============================================================ BAND 3 -- */
  h += '<hr class="dash-tear">';
  h += '<div class="dash-grid mt">' +
    '<div>' +
      '<div class="card"><div class="card-head"><h3>' + t('sales_6m') + '</h3>' +
        '<div class="card-actions"><span class="badge neutral">' + DB.sales.length + ' ' + t('invoices') + '</span></div></div>' +
        '<div class="card-body"><div class="chart-box"><canvas id="dashLine"></canvas></div></div></div>' +

      '<div class="grid mt" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">' +
        '<div class="card"><div class="card-head"><h3>' + t('sales_by_type') + '</h3></div>' +
          '<div class="card-body"><div class="chart-box"><canvas id="dashDonut"></canvas></div></div></div>' +
        '<div class="card"><div class="card-head"><h3>' + t('best_sellers') + '</h3></div>' +
          '<div class="card-body"><div class="chart-box"><canvas id="dashBars"></canvas></div></div></div>' +
      '</div>' +

      '<div class="card mt"><div class="card-head"><h3>' + t('recent_sales') + '</h3>' +
        '<div class="card-actions">' + ifNav('reports',
          '<button class="btn btn-ghost btn-sm" data-act="nav" data-view="reports">' + t('view_all') + '</button>') +
        '</div></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr>' +
          '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th><th>' + t('items') + '</th>' +
          '<th>' + t('payment') + '</th><th>' + t('date') + '</th><th class="num">' + t('total') + '</th>' +
        '</tr></thead><tbody>';

  DB.sales.slice(0, 5).forEach(function (s) {
    h += '<tr class="clickable" data-act="open-invoice" data-id="' + s.id + '">' +
      '<td><b>' + s.id + '</b></td>' +
      '<td>' + esc(s.customerName) + '</td>' +
      '<td class="muted">' + s.items.length + ' × ' + esc(s.items[0].name.slice(0, 22)) + (s.items.length > 1 ? '…' : '') + '</td>' +
      '<td><span class="badge neutral">' + DB.payLabel(s.payment) + '</span></td>' +
      '<td class="num muted">' + fmtDate(s.date) + '</td>' +
      '<td class="num"><b>' + money(s.total) + '</b></td></tr>';
  });

  h += '</tbody></table></div></div></div>';

  /* Right column — staff on shift (a stable, always-populated card so the
     two-column band never collapses to a single lopsided column). */
  var staffToday = {};
  DB.sales.forEach(function (s) {
    if (isToday(s.date) && s.cashier) staffToday[s.cashier] = (staffToday[s.cashier] || 0) + 1;
  });
  h += '<div class="card"><div class="card-head"><h3>' + t('staff_on_shift') + '</h3></div>';
  var staffNames = Object.keys(staffToday);
  if (!staffNames.length) {
    h += '<div class="cart-empty"><b>' + t('dash_nothing_waiting') + '</b></div>';
  } else {
    staffNames.sort(function (a, b) { return staffToday[b] - staffToday[a]; }).forEach(function (name) {
      h += '<div class="alert-row"><span class="alert-txt"><b>' + esc(name) + '</b></span>' +
        '<span class="num">' + nf(staffToday[name]) + '</span></div>';
    });
  }
  h += '</div></div>';

  return h;
}

function afterDashboard() {
  var scope = OG.dashScope || 'today';
  var r = scopeRange(scope);
  var salesInScope = DB.sales.filter(function (s) { return s.date >= r.from && s.date < r.to; });

  var m = DB.monthlySales(6);
  Charts.line(document.getElementById('dashLine'),
    m.map(function (x) { return x.label; }),
    m.map(function (x) { return OG.currency === 'USD' ? x.total / CONFIG.EXCHANGE_RATE : x.total; }),
    { fmt: function (v) { return (OG.currency === 'USD' ? '$' : '') + Charts.compact(v); } });

  var byType = {};
  salesInScope.forEach(function (s) {
    s.items.forEach(function (it) { byType[it.type] = (byType[it.type] || 0) + it.qty * it.unitPrice; });
  });
  var byTypeArr = Object.keys(byType).map(function (k) {
    return { label: DB.typeLabels[k] || k, total: byType[k] };
  }).sort(function (a, b) { return b.total - a.total; });
  Charts.donut(document.getElementById('dashDonut'),
    byTypeArr.map(function (x) { return x.label; }),
    byTypeArr.map(function (x) { return OG.currency === 'USD' ? x.total / CONFIG.EXCHANGE_RATE : x.total; }),
    { fmt: function (v) { return (OG.currency === 'USD' ? '$' : '') + Charts.compact(v); } });

  var unitsByProduct = {};
  salesInScope.forEach(function (s) {
    s.items.forEach(function (it) { unitsByProduct[it.productId] = (unitsByProduct[it.productId] || 0) + it.qty; });
  });
  var top = Object.keys(unitsByProduct).map(function (k) {
    return { name: DB.product(+k).name, units: unitsByProduct[k] };
  }).sort(function (a, b) { return b.units - a.units; }).slice(0, 6);

  Charts.bars(document.getElementById('dashBars'),
    top.map(function (x) { return x.name.length > 16 ? x.name.slice(0, 15) + '…' : x.name; }),
    top.map(function (x) { return x.units; }),
    { horizontal: true, highlight: 0, fmt: function (v) { return nf(v); } });
}

/* ------------------------------------------------------- 7b. HOME, PER ROLE

   The dashboard above is a manager's dashboard: today's takings, six months of
   revenue, best sellers, margin. It was the landing screen for all five roles,
   which meant a cashier signed in to the shop's money and a driver signed in
   to a bar chart he cannot act on.

   Each of these is the first thing one person sees in the morning, and each is
   built around the first thing that person actually does. They are deliberately
   short: a home screen you have to read is a home screen you stop reading.

   All three use the markup the rest of the app already uses — `stat`, `card`,
   `alert-row`, `tbl` — so they inherit spacing, dark mode, RTL and the
   entrance animation without a single new rule. */

function greeting() {
  var hr = new Date().getHours();
  return hr < 12 ? t('hi_morning') : hr < 17 ? t('hi_afternoon') : t('hi_evening');
}

/* The same day boundary the dashboard's "Sales today" uses, via the same
   daysAgo() the seeded data is built around. Rolling our own midnight here
   would give two screens two different answers for the same word. */
function isToday(d) {
  var x = new Date(d);
  return x >= daysAgo(0) && x < daysAgo(-1);
}

/* First name only. "Good morning, Hussam" reads like a person talking;
   "Good morning, Hussam Fattal" reads like a bank letter. */
function firstName() {
  var u = (typeof Auth !== 'undefined') ? Auth.user() : null;
  return u && u.name ? String(u.name).trim().split(/\s+/)[0] : '';
}

function roleHomeHead(title, sub) {
  var who = firstName();
  return '<div class="page-head"><div><h1>' +
    (who ? greeting() + ', ' + esc(who) : title) + '</h1>' +
    '<div class="sub">' + sub + ' · ' + fmtDate(TODAY) + '</div></div></div>';
}

/* ---- cashier ---------------------------------------------------------------
   Her shift, not the shop. No revenue total, no month, no charts, no profit —
   the till, what she has done today, and what is running out where she can
   see it. */
function viewShiftHome() {
  var me = firstName();
  var mine = DB.sales.filter(function (s) {
    /* Matched on the first name so it still works when the account name and
       the staff record disagree on a middle name or a spelling. */
    return isToday(s.date) &&
           String(s.cashier || '').indexOf(me) === 0;
  });
  var taken = mine.reduce(function (a, s) { return a + s.total; }, 0);

  var h = roleHomeHead(t('nav_pos'), t('my_sales_today'));

  h += '<div class="grid stat-row">' +
    '<div class="stat"><span class="eyebrow">' + t('my_sales_today') + '</span>' +
      '<div class="val accent">' + moneyStat(taken) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('my_invoices') + '</span>' +
      '<div class="val">' + nf(mine.length) + '</div>' +
      '<div class="foot">' + fmtDate(TODAY) + '</div></div>' +
  '</div>';

  h += ifNav('pos', '<div class="home-cta mt">' +
    '<button class="btn btn-primary btn-lg" data-act="nav" data-view="pos">' +
      t('open_till') + ' →</button></div>');

  /* -- what she has rung up -- */
  h += '<div class="card mt"><div class="card-head"><h3>' + t('my_last_sales') + '</h3></div>';
  if (!mine.length) {
    h += '<div class="cart-empty"><b>' + t('nothing_sold_yet') + '</b>' + t('first_sale_hint') + '</div>';
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th>' +
      '<th>' + t('items') + '</th><th class="num">' + t('total') + '</th>' +
    '</tr></thead><tbody>';
    mine.slice(0, 6).forEach(function (s) {
      h += '<tr class="clickable" data-act="open-invoice" data-id="' + s.id + '">' +
        '<td><b>' + s.id + '</b></td>' +
        '<td>' + esc(s.customerName) + '</td>' +
        '<td class="muted">' + s.items.length + ' × ' + esc(s.items[0].name.slice(0, 20)) +
          (s.items.length > 1 ? '…' : '') + '</td>' +
        '<td class="num"><b>' + money(s.total) + '</b></td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  /* -- what she will be asked for and cannot find --
     Only what is short ON THE FLOOR. A cashier does not care that the back is
     low; she cares that the customer in front of her wants a 42 and the wall
     is empty. */
  var gaps = DB.floorOuts().slice(0, 6);
  h += '<div class="card mt"><div class="card-head"><h3>' + t('low_on_shelf') + '</h3>' +
    '<div class="card-actions"><span class="badge ' + (gaps.length ? 'critical' : 'healthy') + '">' +
      gaps.length + '</span></div></div>';
  if (!gaps.length) {
    h += '<div class="cart-empty"><b>' + t('shelf_all_good') + '</b></div>';
  } else {
    gaps.forEach(function (g) {
      var p = DB.product(g.productId);
      h += '<div class="alert-row">' +
        '<span class="alert-ico amber">!</span>' +
        '<span class="alert-txt"><b>' + esc(p ? p.name : g.sku) + '</b>' +
          '<small>' + t('size') + ' ' + esc(g.size) + ' · ' + t('low_on_shelf_sub') + '</small></span>' +
      '</div>';
    });
  }
  h += '</div>';

  return h;
}

/* ---- warehouse -------------------------------------------------------------
   The back room. Four counts, two buttons, and the list of things that need
   carrying to the front. Not one money figure: he has neither money.read nor
   cost.read, and a stock keeper does not need either to do his job well. */
function viewBackHome() {
  var arrived = DB.stockMovements.filter(function (m) {
    return m.delta > 0 && isToday(m.date);
  });
  var arrivedPieces = arrived.reduce(function (a, m) { return a + m.delta; }, 0);
  var toMove = DB.floorOuts();
  var openPOs = DB.purchaseOrders.filter(function (p) { return p.status !== 'received'; });
  var empties = DB.variants.filter(function (v) { return DB.stockAt(v, 'floor') === 0; }).length;

  var h = roleHomeHead(t('back_title'), t('back_sub'));

  h += '<div class="grid stat-row">' +
    '<div class="stat"><span class="eyebrow">' + t('arrived_today') + '</span>' +
      '<div class="val accent">' + nf(arrivedPieces) + '</div>' +
      '<div class="foot">' + t('pieces') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('to_move_out') + '</span>' +
      '<div class="val' + (toMove.length ? ' warn' : '') + '">' + nf(toMove.length) + '</div>' +
      '<div class="foot">' + t('sku') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('empty_on_floor') + '</span>' +
      '<div class="val">' + nf(empties) + '</div>' +
      '<div class="foot">' + t('wh_empty_sizes') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('open_orders') + '</span>' +
      '<div class="val">' + nf(openPOs.length) + '</div>' +
      '<div class="foot">' + t('po_title').toLowerCase() + '</div></div>' +
  '</div>';

  h += '<div class="home-cta mt">' +
    (allow('product.write')
      ? '<button class="btn btn-primary btn-lg" data-act="home-wh" data-tab="add">' + t('back_receive') + '</button>'
      : '') +
    (allow('stock.count')
      ? '<button class="btn btn-lg" data-act="home-wh" data-tab="count">' + t('back_count') + '</button>'
      : '') +
  '</div>';

  /* -- the actual to-do list: sold out on the wall, still in the back -- */
  h += '<div class="card mt"><div class="card-head"><h3>' + t('to_move_out') + '</h3>' +
    '<div class="card-actions"><span class="badge ' + (toMove.length ? 'critical' : 'healthy') + '">' +
      toMove.length + '</span></div></div>';

  if (!toMove.length) {
    h += '<div class="cart-empty"><b>' + t('back_nothing') + '</b>' + t('back_nothing_sub') + '</div>';
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('product') + '</th><th>' + t('size') + '</th>' +
      '<th class="num">' + t('wh_in_the_back') + '</th><th></th>' +
    '</tr></thead><tbody>';
    toMove.slice(0, 10).forEach(function (g) {
      var p = DB.product(g.productId);
      h += '<tr>' +
        '<td><div class="cell-prod">' + (p ? thumb(p) : '') + '<span><b>' +
          esc(p ? p.name : g.sku) + '</b></span></div></td>' +
        '<td><b>' + esc(g.size) + '</b></td>' +
        '<td class="num' + (g.back ? '' : ' muted') + '">' + nf(g.back) + '</td>' +
        '<td>' + (allow('stock.move') && p
          ? '<button class="btn btn-sm btn-primary" data-act="wh-transfer" data-id="' + p.id + '">' +
            t('wh_move') + '</button>'
          : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  return h;
}

/* ---- delivery --------------------------------------------------------------
   Rendered by js/deliveries.js, which owns the whole screen — it is the only
   role whose home is live server data rather than a view over what is already
   in memory, so it loads asynchronously and paints itself. */
function viewRunsHome() {
  return (typeof Deliveries !== 'undefined')
    ? Deliveries.view()
    : '<div class="card"><div class="cart-empty"><b>' + t('dl_none') + '</b></div></div>';
}
