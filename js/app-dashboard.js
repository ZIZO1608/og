/* ==========================================================================
   OG SYSTEM — application shell  ·  6/17: DASHBOARD + per-role home screens
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 2165-2555). Loads after
   app-shell.js.

   EVERY FIGURE HERE COMES FROM THE SERVER, computed in SQL over every sale.
   `DB.dash` is the snapshot GET /api/dashboard returned for the window the
   scope chips name — nothing on this screen is summed from `DB.sales`, which
   is the last two hundred invoices and was, for a long time, the only source
   the dashboard had. It read as the shop; it was a window with no note on it.

   Two rules follow from that and are visible in every function below:

     - Money arrives as a pair `{ syp, usd }` and is drawn as a pair. Nothing
       here converts one into the other, and nothing adds them.
     - A block the account may not see is simply absent from `DB.dash`, so
       every reader is null-safe and draws nothing rather than a zero that
       would read as "the shop took nothing".
   ========================================================================== */

/* ------------------------------------------------------------- 7. DASHBOARD */

/* The window the chips name, in THIS machine's local day.

   Built from a fresh midnight every call, never from the boot-time TODAY: a
   till left open overnight would otherwise keep sending yesterday's bounds
   and the morning's takings would sit at zero until somebody reloaded. The
   server is on UTC and knows nothing about where the shop is; these two
   instants are the only definition of "today" it ever gets. */
function scopeRange(scope, customFrom, customTo) {
  var start = new Date(); start.setHours(0, 0, 0, 0);
  var end = new Date(start); end.setDate(end.getDate() + 1);
  var from = new Date(start);

  /* 'custom' is the Reports screen's two date boxes. Both are plain
     'YYYY-MM-DD' as the input element gives them, read as LOCAL midnight —
     new Date('2026-03-01') is UTC midnight, which in Aleppo is three in the
     morning on the first and would drop the whole of the last day of a range
     that ends on the 31st. `to` is pushed to the following midnight because
     every window here is half-open and the server compares `at < to`; without
     it a range ending today would silently exclude today. */
  if (scope === 'custom') {
    var a = ymdLocal(customFrom), b = ymdLocal(customTo);
    if (a && b) {
      if (b < a) { var swap = a; a = b; b = swap; }
      var bTo = new Date(b); bTo.setDate(bTo.getDate() + 1);
      return { from: a, to: bTo };
    }
    scope = '30d';                       /* half-filled boxes: fall back, never NaN */
  }

  if (scope === '30d') from.setDate(from.getDate() - 29);
  else if (scope === '7d') from.setDate(from.getDate() - 6);
  else if (scope === 'month') from = new Date(start.getFullYear(), start.getMonth(), 1);
  else if (scope === 'year') {
    from = new Date(start.getFullYear(), 0, 1);
    /* The server refuses a span over 366 days, and 1 January to tomorrow on a
       leap year is exactly 366 — but a clock that has drifted, or a machine
       whose year has just turned, can push it past. Clamped here rather than
       met with a 400 the shopkeeper cannot act on. */
    var maxBack = new Date(end); maxBack.setDate(maxBack.getDate() - 366);
    if (from < maxBack) from = maxBack;
  }
  return { from: from, to: end };
}

/* 'YYYY-MM-DD' at LOCAL midnight, or null. Anything else — an empty box, a
   half-typed year, a browser that hands back its own format — is null rather
   than an Invalid Date that becomes NaN in the query string. */
function ymdLocal(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) return null;
  return d;
}

/* The other direction, for putting today's date into a date box. */
function ymdOf(d) {
  d = new Date(d);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

/* One block of the snapshot, or null. Reads never throw on an account that
   was not sent the block. */
function dashBlock(name) {
  return (DB.dash && DB.dash[name] !== undefined) ? DB.dash[name] : null;
}

/* The shop's own currency out of a pair, and the other one. */
function dashBase() { return (DB.dash && DB.dash.base) || 'SYP'; }
function baseOf(p) { return dashBase() === 'USD' ? (p ? p.usd : 0) : (p ? p.syp : 0); }
function otherOf(p) { return dashBase() === 'USD' ? (p ? p.syp : 0) : (p ? p.usd : 0); }
function moneyIn(currency, v) {
  return '<bdi dir="ltr">' + (currency === 'USD' ? moneyUsdRaw(v) : moneySypRaw(v)) + '</bdi>';
}
function moneyBase(v) { return moneyIn(dashBase(), v); }
function moneyOther(v) { return moneyIn(dashBase() === 'USD' ? 'SYP' : 'USD', v); }

/* Month label for a 'YYYY-MM' bucket, in the page's language. */
function monthLabel(ym) {
  var mi = Number(ym.slice(5, 7)) - 1;
  return (OG.lang === 'ar' ? MONTHS_AR : MONTHS_EN)[mi] || ym;
}

function hhmm(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return '—';
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

/* One to-do row. The sentence is written by DB.alertText from the row's kind
   and values, so it reads correctly in either language. A row about a PERSON
   opens that person; everything else goes through alert-fix, which marks it
   read and navigates. `seen` dims a row somebody has already read — it stays
   on the list because the fact is still true. */
function todoRow(a) {
  var text = DB.alertText(a);
  var cls = 'alert-row clickable' + (a.read ? ' seen' : '');
  var body = '<span class="alert-ico ' + a.tone + '">' + a.icon + '</span>' +
             '<span class="alert-txt">' + text + '</span>' +
             '<span class="alert-chevron">›</span>';
  var who = a.kind === 'stamps' && a.args ? Number(a.args.customerId) : 0;
  if (who && DB.customer(who)) {
    return ifNav('customers',
      '<div class="' + cls + '" data-act="cu-open" data-id="' + who + '">' + body + '</div>') || '';
  }
  return ifNav(a.view,
    '<div class="' + cls + '" data-act="alert-fix" data-key="' + esc(a.key) + '">' + body + '</div>') ||
    ('<div class="alert-row' + (a.read ? ' seen' : '') + '">' +
       '<span class="alert-ico ' + a.tone + '">' + a.icon + '</span>' +
       '<span class="alert-txt">' + text + '</span></div>');
}

/* A chart card that says "nothing here" in words rather than drawing an
   empty axis. The canvas exists only when there is something to draw, so
   afterDashboard() can test for it. */
function chartCard(id, title, hasData, badge) {
  return '<div class="card"><div class="card-head"><h3>' + title + '</h3>' +
    (badge ? '<div class="card-actions">' + badge + '</div>' : '') + '</div>' +
    '<div class="card-body"><div class="chart-box">' +
      (hasData ? '<canvas id="' + id + '"></canvas>'
               : '<div class="chart-empty">' + t('dash_chart_empty') + '</div>') +
    '</div></div></div>';
}

function statBox(label, val, foot, extraCls, act) {
  return '<div class="stat' + (act ? ' clickable' : '') + (extraCls ? ' ' + extraCls : '') + '"' +
    (act || '') + '><span class="eyebrow">' + label + '</span>' +
    '<div class="val">' + val + '</div>' +
    (foot ? '<div class="foot">' + foot + '</div>' : '') + '</div>';
}

function viewDashboard() {
  OG.dashScope = OG.dashScope || 'today';
  var scope = OG.dashScope;
  var dash = DB.dash;

  var h = '<div class="' + (OG.dashLoading ? 'dash-loading' : '') + '">';
  h += '<div class="page-head"><div><h1>' + t('dash_title') + '</h1>' +
    '<div class="sub">' + t('dash_sub') + ' · ' + fmtDate(new Date()) + '</div></div>' +
    '<div class="head-actions">' +
      exportButtons() +
      '<button class="btn btn-ghost" data-act="day-summary">' + t('wa_send_day') + '</button>' +
      ifNav('pos', '<button class="btn btn-primary" data-act="nav" data-view="pos">' + t('nav_pos') + '</button>') +
    '</div></div>';

  /* -- scope selector -- */
  h += '<div class="chip-row"><span class="lbl-lbl">' + t('dash_scope_label') + '</span>';
  [['today', 'dash_scope_today'], ['7d', 'dash_scope_7d'], ['30d', 'dash_scope_30d']].forEach(function (o) {
    h += '<button class="chip ' + (scope === o[0] ? 'on' : '') + '" data-act="dash-scope" data-k="' + o[0] + '">' +
      t(o[1]) + '</button>';
  });
  if (OG.dashLoading) h += '<span class="muted small">' + t('dash_loading') + '</span>';
  h += '</div>';

  /* The request was skipped or refused. One card, no invented zeros: an
     empty hero would read as "the shop took nothing today". */
  if (!dash) {
    h += '<div class="card mt"><div class="cart-empty"><b>' + t('dash_unavailable') + '</b>' +
         t('dash_unavailable_sub') + '</div></div></div>';
    return h;
  }

  var sales = dashBlock('sales');
  var margin = dashBlock('margin');
  var drawer = dashBlock('drawer');
  var debts = dashBlock('debts');
  var sup = dashBlock('suppliers');
  var cust = dashBlock('customers');
  var todo = dashBlock('todo');
  var charts = dashBlock('charts');
  var latest = dashBlock('latest');
  var staff = dashBlock('staff');

  /* ============================================================ BAND 1 --
     The takings, in the shop's own currency, big. Dollars taken as dollars
     are a second line and never folded in. The approximate line converts at
     TODAY'S rate and says so — the same rule the credit limit follows. */
  h += '<hr class="dash-tear">';
  if (sales) {
    var tk = sales.takings, other = otherOf(tk);
    h += '<div class="dash-hero"><span class="eyebrow">' + t('dash_takings') + '</span>' +
      '<div class="dash-hero-val">' + moneyBase(baseOf(tk)) + '</div>';
    if (other > 0) {
      h += '<div class="dash-hero-sub">' + t('dash_also_usd') + ': ' + moneyOther(other) + '</div>';
    }
    if (dashBase() === 'SYP' && baseOf(tk) > 0 && CONFIG.EXCHANGE_RATE > 0) {
      h += '<div class="dash-hero-sub">' +
        t('dash_approx_usd').replace('{usd}', '<bdi dir="ltr">$' + nf(baseOf(tk) / CONFIG.EXCHANGE_RATE) + '</bdi>') +
        '</div>';
    }
    h += deltaTag(baseOf(tk), baseOf(sales.previous), t('dash_vs_prev')) + '</div>';

    h += '<div class="grid stat-row mt">';
    h += statBox(t('invoices'), '<bdi dir="ltr">' + nf(sales.count) + '</bdi>');
    h += statBox(t('avg_basket'), moneyPair(sales.avgBasket.syp, sales.avgBasket.usd, true));
    if (margin && seesProfit()) {
      var mp = margin.pct[dashBase().toLowerCase()];
      var mo = margin.pct[dashBase() === 'USD' ? 'syp' : 'usd'];
      h += statBox(t('margin'), mp === null ? '—' : '<bdi dir="ltr">' + pct(mp) + '</bdi>',
        (mo !== null && otherOf(sales.takings) > 0) ? '<bdi dir="ltr">' + pct(mo) + '</bdi> USD' : '');
    }
    h += statBox(t('dash_discounts'), '<bdi dir="ltr">' + nf(sales.discounts.count) + '</bdi>',
      sales.discounts.overCap
        ? '<span class="warn">' + t('dash_over_cap').replace('{n}', '<bdi dir="ltr">' + nf(sales.discounts.overCap) + '</bdi>') + '</span>'
        : '');
    h += '</div>';
  }

  /* ============================================================ MONEY --
     Only for money.read. The drawer as it stands, what is owed in, what is
     owed out, and how people paid. */
  if (drawer) {
    h += '<hr class="dash-tear">';
    h += '<div class="grid mt dash-money">';

    /* -- the drawer -- */
    h += '<div class="card"><div class="card-head"><h3>' + t('dash_drawer') + '</h3>' +
      (drawer.open ? '<div class="card-actions"><span class="badge healthy">' + esc(drawer.id) + '</span></div>' : '') +
      '</div>';
    if (!drawer.open) {
      h += '<div class="cart-empty"><b>' + t('dash_drawer_none') + '</b>' + t('dash_drawer_none_sub') +
        ifNav('money', '<div class="mt"><button class="btn btn-sm" data-act="nav" data-view="money">' +
          t('dash_open_shift') + '</button></div>') + '</div>';
    } else {
      var lines = [
        [t('dash_float'), drawer.float], [t('dash_cash_sales'), drawer.sales],
        [t('dash_collected'), drawer.collected], [t('dash_paid_out'), -drawer.paidOut]
      ];
      h += '<div class="card-body">' +
        '<div class="dash-hero-val dash-drawer-val">' + moneyIn(drawer.currency, drawer.expected) + '</div>' +
        '<div class="muted small">' + t('dash_expected') + ' · ' +
          t('dash_drawer_since').replace('{time}', '<bdi dir="ltr">' + hhmm(drawer.openedAt) + '</bdi>') +
          (drawer.by ? ' · ' + t('dash_drawer_by').replace('{name}', nm(drawer.by)) : '') + '</div>';
      h += '<div class="mt">';
      lines.forEach(function (l) {
        h += '<div class="alert-row"><span class="alert-txt">' + l[0] + '</span>' +
          '<span class="num' + (l[1] < 0 ? ' warn' : '') + '">' + moneyIn(drawer.currency, l[1]) + '</span></div>';
      });
      h += '</div></div>';
    }
    h += '</div>';

    /* -- owed in / owed out -- */
    h += '<div class="card"><div class="card-body">';
    h += '<div class="stat clickable" data-act="dash-cust" data-f="debt"><span class="eyebrow">' + t('dash_customers_owe') + '</span>' +
      '<div class="val">' + moneyPair(debts.syp, debts.usd, true) + '</div>' +
      '<div class="foot">' + t('dash_open_invoices')
        .replace('{n}', '<bdi dir="ltr">' + nf(debts.invoices) + '</bdi>')
        .replace('{c}', '<bdi dir="ltr">' + nf(debts.customers) + '</bdi>') + '</div></div>';
    h += '<div class="stat mt' + (navAllowed('reports') ? ' clickable" data-act="nav" data-view="reports" data-tab="suppliers"' : '"') + '>' +
      '<span class="eyebrow">' + t('dash_owe_suppliers') + '</span>' +
      '<div class="val">' + moneyPair(sup.syp, sup.usd, true) + '</div>' +
      '<div class="foot">' + t('dash_n_suppliers').replace('{n}', '<bdi dir="ltr">' + nf(sup.count) + '</bdi>') + '</div></div>';
    h += '</div></div>';

    /* -- how they paid -- */
    h += '<div class="card"><div class="card-head"><h3>' + t('dash_payment_split') + '</h3></div>';
    if (!sales || !sales.byPayment.length) {
      h += '<div class="cart-empty"><b>' + t('dash_no_sales') + '</b></div>';
    } else {
      sales.byPayment.forEach(function (p) {
        h += '<div class="alert-row"><span class="alert-txt"><b>' + DB.payLabel(p.payment) + '</b>' +
          '<small><bdi dir="ltr">' + nf(p.count) + '</bdi> ' + t('invoices').toLowerCase() + '</small></span>' +
          '<span class="num">' + moneyPair(p.syp, p.usd, true) + '</span></div>';
      });
    }
    h += '</div>';
    h += '</div>';
  }

  /* ============================================================ TO-DO --
     The same list as the bell, from the same server call, fifty deep
     instead of eight. The badge is the server's total; when even fifty is
     not all of it, the note says so. */
  h += '<hr class="dash-tear">';
  var rows = todo ? todo.rows : [];
  var total = todo ? todo.total : 0;
  h += '<div class="card" id="attentionPanel"><div class="card-head">' +
       '<h3>' + t('needs_attention') + '</h3>' +
       '<div class="card-actions"><span class="badge ' + (total ? 'critical' : 'healthy') + '">' +
         '<bdi dir="ltr">' + nf(total) + '</bdi></span></div></div>';
  if (!rows.length) {
    h += '<div class="cart-empty"><b>' + t('dash_nothing_waiting') + '</b>' + t('dash_shop_clean') + '</div>';
  } else {
    rows.forEach(function (a) { h += todoRow(a); });
    if (todo.capped) h += cappedNote(todo, t('needs_attention').toLowerCase());
  }
  h += '</div>';

  /* ============================================================ PEOPLE --
     Four counts, each the door to the list it counts. New is the server's;
     the other three are derived from lists that are not windowed, by the
     same rule the Customers screen's own chips use. */
  if (cust && allow('customer.read')) {
    var quiet = DB.quietCustomers().length;
    var full = Object.keys(DB.fullCardIds()).length;
    h += '<div class="grid stat-row mt">';
    h += statBox(t('dash_cust_new'), '<bdi dir="ltr">' + nf(cust.newInScope) + '</bdi>', '', '',
      ' data-act="dash-cust" data-f="all"');
    h += statBox(t('dash_cust_quiet'), '<bdi dir="ltr">' + nf(quiet) + '</bdi>', '', quiet ? 'warn' : '',
      ' data-act="dash-cust" data-f="risk"');
    if (DB.stampsOn()) {
      h += statBox(t('dash_cust_full'), '<bdi dir="ltr">' + nf(full) + '</bdi>', '', '',
        ' data-act="dash-cust" data-f="cardfull"');
    }
    h += statBox(t('dash_cust_wants'), '<bdi dir="ltr">' + nf(cust.wantsBack.skus) + '</bdi>',
      cust.wantsBack.customers
        ? t('dash_cust_waiting').replace('{n}', '<bdi dir="ltr">' + nf(cust.wantsBack.customers) + '</bdi>')
        : '',
      '', ' data-act="dash-cust" data-f="wants"');
    h += '</div>';
  }

  /* ============================================================ BAND 3 -- */
  h += '<hr class="dash-tear">';
  var hasMonthly = !!(charts && charts.monthly.some(function (m) { return m.count > 0; }));
  var hasTypes = !!(charts && charts.byType.length);
  var hasTop = !!(charts && charts.topProducts.length);
  var usdOff = charts ? charts.monthly.reduce(function (a, m) { return a + (m.usd > 0 ? 1 : 0); }, 0) : 0;
  var sixMonthCount = charts ? charts.monthly.reduce(function (a, m) { return a + m.count; }, 0) : 0;

  h += '<div class="dash-grid mt"><div>';
  h += chartCard('dashLine', t('sales_6m'), hasMonthly,
    '<span class="badge neutral"><bdi dir="ltr">' + nf(sixMonthCount) + '</bdi> ' + t('invoices') + '</span>');
  if (usdOff && dashBase() === 'SYP') {
    h += '<div class="muted small mt">' + t('dash_usd_not_drawn').replace('{n}', '<bdi dir="ltr">' + nf(usdOff) + '</bdi>') + '</div>';
  }
  h += '<div class="grid mt" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">' +
    chartCard('dashDonut', t('sales_by_type'), hasTypes) +
    chartCard('dashBars', t('best_sellers'), hasTop) +
  '</div>';

  /* -- latest sales -- */
  h += '<div class="card mt"><div class="card-head"><h3>' + t('recent_sales') + '</h3>' +
    '<div class="card-actions">' + ifNav('reports',
      '<button class="btn btn-ghost btn-sm" data-act="nav" data-view="reports" data-tab="sales">' + t('view_all') + '</button>') +
    '</div></div>';
  if (!latest || !latest.length) {
    h += '<div class="cart-empty"><b>' + t('dash_no_sales') + '</b>' + t('dash_no_sales_sub') + '</div>';
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th><th>' + t('items') + '</th>' +
      '<th>' + t('payment') + '</th><th>' + t('date') + '</th><th class="num">' + t('total') + '</th>' +
    '</tr></thead><tbody>';
    latest.forEach(function (s) {
      var first = s.items && s.items[0] ? s.items[0].name : '';
      h += '<tr class="clickable" data-act="open-invoice" data-id="' + esc(s.id) + '">' +
        '<td><b>' + esc(s.id) + '</b></td>' +
        '<td>' + (s.customer_name ? nm(s.customer_name) : '<span class="muted">' + t('walk_in') + '</span>') + '</td>' +
        '<td class="muted"><bdi dir="ltr">' + (s.items ? s.items.length : 0) + '</bdi> × ' + esc(first.slice(0, 22)) +
          (s.items && s.items.length > 1 ? '…' : '') + '</td>' +
        '<td><span class="badge neutral">' + DB.payLabel(s.payment) + '</span></td>' +
        '<td class="num muted">' + fmtDate(s.at) + '</td>' +
        '<td class="num"><b>' + moneyIn(s.currency, s.total) + '</b></td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div></div>';

  /* -- right column: who sold, in the window -- */
  h += '<div class="card"><div class="card-head"><h3>' + t('dash_by_staff') + '</h3></div>';
  if (!staff) {
    h += '<div class="cart-empty"><b>' + t('dash_no_staff') + '</b></div>';
  } else if (!staff.length) {
    h += '<div class="cart-empty"><b>' + t('dash_no_staff') + '</b></div>';
  } else {
    staff.forEach(function (p) {
      h += '<div class="alert-row"><span class="alert-txt"><b>' + (p.name ? nm(p.name) : '—') + '</b>' +
        '<small>' + moneyPair(p.syp, p.usd, true) + '</small></span>' +
        '<span class="num"><bdi dir="ltr">' + nf(p.count) + '</bdi></span></div>';
    });
  }
  h += '</div></div>';

  h += '</div>';
  return h;
}

/* The three charts, in the shop's own currency. Each canvas exists only when
   viewDashboard() found something to draw, so a missing one is not an
   error — it is the "no sales" card standing where the chart would be. */
function afterDashboard() {
  var charts = dashBlock('charts');
  if (!charts) return;
  var base = dashBase().toLowerCase();
  var sym = dashBase() === 'USD' ? '$' : '';
  var fmtMoney = function (v) { return sym + Charts.compact(v); };

  var line = document.getElementById('dashLine');
  if (line) {
    Charts.line(line,
      charts.monthly.map(function (m) { return monthLabel(m.month); }),
      charts.monthly.map(function (m) { return dashBase() === 'USD' ? m.usd / 100 : m.syp; }),
      { fmt: fmtMoney });
  }

  var donut = document.getElementById('dashDonut');
  if (donut) {
    Charts.donut(donut,
      charts.byType.map(function (x) { return DB.typeLabels[x.type] || x.type || '—'; }),
      charts.byType.map(function (x) { return dashBase() === 'USD' ? x.usd / 100 : x[base]; }),
      { fmt: fmtMoney });
  }

  var bars = document.getElementById('dashBars');
  if (bars) {
    Charts.bars(bars,
      charts.topProducts.map(function (x) { return x.name.length > 16 ? x.name.slice(0, 15) + '…' : x.name; }),
      charts.topProducts.map(function (x) { return x.units; }),
      { horizontal: true, highlight: 0, fmt: function (v) { return nf(v); } });
  }
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
    '<div class="sub">' + sub + ' · ' + fmtDate(new Date()) + '</div></div></div>';
}

/* ---- cashier ---------------------------------------------------------------
   Her shift, not the shop. No revenue total, no month, no charts, no profit —
   the till, what she has done today, and what is running out where she can
   see it. Her sales are hers BY ACCOUNT: the server matches cashier_id, not
   her first name, so a second Lubna does not inherit the first one's day. */
function viewShiftHome() {
  var me = dashBlock('me');
  var shift = dashBlock('shift');

  var h = roleHomeHead(t('nav_pos'), t('my_sales_today'));

  h += '<div class="grid stat-row">' +
    '<div class="stat"><span class="eyebrow">' + t('my_sales_today') + '</span>' +
      '<div class="val accent">' + (me ? moneyPair(me.takings.syp, me.takings.usd, true) : '—') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('my_invoices') + '</span>' +
      '<div class="val"><bdi dir="ltr">' + (me ? nf(me.count) : '—') + '</bdi></div>' +
      '<div class="foot">' + fmtDate(new Date()) + '</div></div>';
  if (shift) {
    h += '<div class="stat"><span class="eyebrow">' + t('my_shift') + '</span>' +
      (shift.open
        ? '<div class="val"><bdi dir="ltr">' + hhmm(shift.openedAt) + '</bdi></div>' +
          '<div class="foot">' + t('shift_open_since').replace('{time}', '') +
            (shift.by ? ' · ' + t('shift_open_by').replace('{name}', nm(shift.by)) : '') + '</div>'
        : '<div class="val warn">—</div><div class="foot">' + t('shift_none') + '</div>') +
      '</div>';
  }
  if (allow('customer.read') && DB.stampsOn()) {
    var full = Object.keys(DB.fullCardIds()).length;
    h += '<div class="stat' + (full ? ' clickable" data-act="dash-cust" data-f="cardfull"' : '"') + '>' +
      '<span class="eyebrow">' + t('my_full_cards') + '</span>' +
      '<div class="val"><bdi dir="ltr">' + nf(full) + '</bdi></div>' +
      '<div class="foot">' + t('my_full_cards_sub') + '</div></div>';
  }
  h += '</div>';

  if (shift && !shift.open) {
    h += '<div class="card mt"><div class="cart-empty"><b>' + t('shift_none') + '</b>' + t('shift_none_sub') + '</div></div>';
  }

  h += ifNav('pos', '<div class="home-cta mt">' +
    '<button class="btn btn-primary btn-lg" data-act="nav" data-view="pos">' +
      t('open_till') + ' →</button></div>');

  /* -- what she has rung up -- */
  var mine = me ? me.latest : [];
  h += '<div class="card mt"><div class="card-head"><h3>' + t('my_last_sales') + '</h3></div>';
  if (!mine.length) {
    h += '<div class="cart-empty"><b>' + t('nothing_sold_yet') + '</b>' + t('first_sale_hint') + '</div>';
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + t('invoice') + '</th><th>' + t('customer') + '</th>' +
      '<th>' + t('items') + '</th><th class="num">' + t('total') + '</th>' +
    '</tr></thead><tbody>';
    mine.forEach(function (s) {
      var first = s.items && s.items[0] ? s.items[0].name : '';
      h += '<tr class="clickable" data-act="open-invoice" data-id="' + esc(s.id) + '">' +
        '<td><b>' + esc(s.id) + '</b></td>' +
        '<td>' + (s.customer_name ? nm(s.customer_name) : '<span class="muted">' + t('walk_in') + '</span>') + '</td>' +
        '<td class="muted"><bdi dir="ltr">' + (s.items ? s.items.length : 0) + '</bdi> × ' + esc(first.slice(0, 20)) +
          (s.items && s.items.length > 1 ? '…' : '') + '</td>' +
        '<td class="num"><b>' + moneyIn(s.currency, s.total) + '</b></td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  /* -- what she will be asked for and cannot find --
     Only what is short ON THE FLOOR. A cashier does not care that the back is
     low; she cares that the customer in front of her wants a 42 and the wall
     is empty. Stock is not windowed, so this stays derived here. */
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
  var arrivals = dashBlock('arrivals');
  var todo = dashBlock('todo');
  var toMove = DB.floorOuts();
  var openPOs = DB.purchaseOrders.filter(function (p) { return p.status !== 'received'; });
  var empties = DB.liveVariants().filter(function (v) { return DB.stockAt(v, 'floor') === 0; }).length;
  var landed = todo ? todo.rows.filter(function (a) { return a.kind === 'wants_back'; }) : [];

  var h = roleHomeHead(t('back_title'), t('back_sub'));

  h += '<div class="grid stat-row">' +
    '<div class="stat"><span class="eyebrow">' + t('arrived_today') + '</span>' +
      '<div class="val accent"><bdi dir="ltr">' + (arrivals ? nf(arrivals.pieces) : '—') + '</bdi></div>' +
      '<div class="foot">' + t('pieces') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('to_move_out') + '</span>' +
      '<div class="val' + (toMove.length ? ' warn' : '') + '"><bdi dir="ltr">' + nf(toMove.length) + '</bdi></div>' +
      '<div class="foot">' + t('sku') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('empty_on_floor') + '</span>' +
      '<div class="val"><bdi dir="ltr">' + nf(empties) + '</bdi></div>' +
      '<div class="foot">' + t('wh_empty_sizes') + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('open_orders') + '</span>' +
      '<div class="val"><bdi dir="ltr">' + nf(openPOs.length) + '</bdi></div>' +
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

  /* -- a box landed that somebody is waiting for --
     It is the back room that knows a shipment came in, and the floor that
     has to ring the customer. Same rows as the bell, filtered to this kind. */
  h += '<div class="card mt"><div class="card-head"><h3>' + t('back_wants_landed') + '</h3>' +
    '<div class="card-actions"><span class="badge ' + (landed.length ? 'critical' : 'healthy') + '">' +
      landed.length + '</span></div></div>';
  if (!landed.length) {
    h += '<div class="cart-empty"><b>' + t('back_wants_none') + '</b></div>';
  } else {
    landed.forEach(function (a) { h += todoRow(a); });
  }
  h += '</div>';

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
