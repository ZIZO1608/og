/* ==========================================================================
   OG SYSTEM — application shell  ·  4/17: EXPORT SPECS + DEEP LINKS
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 1213-1722). Loads after
   app-util.js.
   ========================================================================== */

function reportExportSpec() {
  var tab = OG.rep.tab, s = { name: 'report-' + tab, chartId: 'repChart',
                              docUrl: deepLink('report', tab),
                              subtitle: fmtDate(daysAgo(179)) + ' — ' + fmtDate(TODAY) };

  if (tab === 'sales') {
    var m = DB.monthlySales(6);
    var tot = m.reduce(function (a, x) { return a + x.total; }, 0);
    var inv = m.reduce(function (a, x) { return a + x.count; }, 0);
    s.title = t('tab_sales'); s.sheet = 'Sales';
    s.columns = [{ label: 'Month' }, { label: t('invoices'), num: true },
                 { label: exCol(t('revenue')), num: true }, { label: exCol(t('avg_basket')), num: true }];
    s.rows = m.map(function (x) {
      return [x.label + ' ' + x.date.getFullYear(), x.count, exMoney(x.total),
              exMoney(x.count ? x.total / x.count : 0)];
    });
    s.totals = [t('total'), inv, exMoney(tot), exMoney(inv ? tot / inv : 0)];
    s.kpis = [{ label: t('revenue'), value: money(tot) }, { label: t('invoices'), value: nf(inv) },
              { label: t('avg_basket'), value: money(inv ? tot / inv : 0) }];

  } else if (tab === 'profit') {
    var rows = DB.profitByType();
    var tr = rows.reduce(function (a, x) { return a + x.revenue; }, 0);
    var tc = rows.reduce(function (a, x) { return a + x.cost; }, 0);
    s.title = t('tab_profit'); s.sheet = 'Profit';
    s.columns = [{ label: t('type') }, { label: t('units'), num: true },
                 { label: exCol(t('revenue')), num: true }, { label: exCol(t('cost')), num: true },
                 { label: exCol(t('profit')), num: true }, { label: t('margin') }];
    s.rows = rows.map(function (x) {
      return [x.label, x.units, exMoney(x.revenue), exMoney(x.cost), exMoney(x.profit), pct(x.margin, 1)];
    });
    s.totals = [t('total'), null, exMoney(tr), exMoney(tc), exMoney(tr - tc), pct((tr - tc) / tr * 100, 1)];
    s.kpis = [{ label: t('revenue'), value: money(tr) }, { label: t('profit'), value: money(tr - tc) },
              { label: t('margin'), value: pct((tr - tc) / tr * 100, 1) }];

  } else if (tab === 'inventory') {
    var inv2 = DB.inventoryValue();
    var tCost = inv2.reduce(function (a, x) { return a + x.cost; }, 0);
    var tRet = inv2.reduce(function (a, x) { return a + x.retail; }, 0);
    var tU = inv2.reduce(function (a, x) { return a + x.units; }, 0);
    s.title = t('tab_inventory'); s.sheet = 'Inventory';
    s.columns = [{ label: t('type') }, { label: t('units'), num: true },
                 { label: exCol(t('capital_in_stock')), num: true },
                 { label: exCol(t('retail_value')), num: true }, { label: exCol(t('profit')), num: true }];
    s.rows = inv2.map(function (x) {
      return [x.label, x.units, exMoney(x.cost), exMoney(x.retail), exMoney(x.retail - x.cost)];
    });
    s.totals = [t('total'), tU, exMoney(tCost), exMoney(tRet), exMoney(tRet - tCost)];
    s.kpis = [{ label: t('capital_in_stock'), value: money(tCost) },
              { label: t('retail_value'), value: money(tRet) },
              { label: t('total_pieces'), value: nf(tU) }];

  } else if (tab === 'employees') {
    s.title = t('tab_employees'); s.sheet = 'Employees';
    s.columns = [{ label: t('name') }, { label: t('role') }, { label: exCol(t('salary')), num: true },
                 { label: exCol(t('sales_made')), num: true }, { label: t('next_payment') }];
    s.rows = DB.employees.map(function (e) {
      return [e.name, e.role, exMoney(e.salary), exMoney(e.sales), fmtDate(e.nextPayment)];
    });
    s.totals = [t('total'), null, exMoney(DB.employees.reduce(function (a, e) { return a + e.salary; }, 0)),
                exMoney(DB.employees.reduce(function (a, e) { return a + e.sales; }, 0)), null];

  } else {
    s.title = t('tab_suppliers'); s.sheet = 'Suppliers';
    s.columns = [{ label: t('supplier') }, { label: t('category') },
                 { label: exCol('Total purchased'), num: true },
                 { label: exCol(t('outstanding')), num: true }, { label: t('due') }];
    s.rows = DB.suppliers.map(function (x) {
      return [x.name, x.category, exMoney(x.totalPurchased), exMoney(x.outstanding), fmtDate(x.dueDate)];
    });
    s.totals = [t('total'), null, exMoney(DB.suppliers.reduce(function (a, x) { return a + x.totalPurchased; }, 0)),
                exMoney(DB.suppliers.reduce(function (a, x) { return a + x.outstanding; }, 0)), null];
  }
  return s;
}

/* An export is the same data with a different lid on it. A column hidden on
   screen and present in the spreadsheet is not protected — it is protected
   from being glanced at, which is not a thing anyone needs. Both cost and
   margin are gated here on exactly the permissions the table uses. */
function productsExportSpec() {
  var rows = productRows();
  var cost = seesCost(), profit = seesProfit();

  var columns = [{ label: t('product'), width: 32 }, { label: t('brand') }, { label: t('type') },
                 { label: t('stock'), num: true }];
  if (cost) columns.push({ label: exCol(t('cost')), num: true });
  columns.push({ label: exCol(t('price')), num: true });
  if (profit) columns.push({ label: t('margin') });
  columns.push({ label: t('health') }, { label: t('visible') });

  var pieces = rows.reduce(function (a, r) { return a + r.qty; }, 0);

  return {
    name: 'products', sheet: 'Products', title: t('products_title'),
    docUrl: deepLink('report', 'inventory'),
    subtitle: rows.length + ' / ' + DB.products.length + ' · ' + fmtDate(TODAY),
    columns: columns,
    rows: rows.map(function (r) {
      var out = [r.p.name, r.p.brand, DB.typeLabels[r.type], r.qty];
      if (cost) out.push(exMoney(r.cost));
      out.push(exMoney(r.price));
      if (profit) out.push(pct(r.margin, 0));
      out.push(t(r.health) + (DB.sizeGaps(r.p.id).length ? ' · ' + t('size_gap') : ''),
               r.p.hidden ? t('no') : t('yes'));
      return out;
    }),
    /* One entry per column, or the totals row slides out of alignment with
       its own header the moment a column is dropped. */
    totals: columns.map(function (c, i) {
      return i === 0 ? t('total') : (i === 3 ? pieces : null);
    }),
    kpis: [{ label: t('st_products'), value: nf(DB.products.length) },
           { label: t('total_pieces'), value: nf(pieces) },
           { label: t('st_critical'), value: nf(DB.criticalVariants().length) }]
  };
}

function customersExportSpec() {
  /* Ordered on spentUsdEquiv — the sort-only figure, each sale at its own
     frozen rate. The sheet itself carries the two REAL columns: what was
     paid in lira and what was paid in dollars, never added together. */
  var list = DB.customers.slice().sort(function (a, b) { return b.spentUsdEquiv - a.spentUsdEquiv; });
  return {
    name: 'customers', sheet: 'Customers', title: t('customers_title'),
    docUrl: deepLink('report', 'sales'),
    subtitle: list.length + ' · ' + DB.quietCustomers().length + ' ' + t('cu_quiet'),
    columns: [{ label: t('name'), width: 24 }, { label: t('phone') }, { label: t('city') },
              { label: t('tier') }, { label: t('loyalty'), num: true },
              { label: t('total_spent') + ' (SYP)', num: true },
              { label: t('total_spent') + ' (USD)', num: true },
              { label: t('cu_visits'), num: true },
              { label: t('last_purchase') },
              /* Their own rhythm, in days — blank where there is not enough
                 history to have one. The column that explains why two people
                 the same distance from their last purchase are judged
                 differently. */
              { label: t('cu_rhythm'), num: true }],
    rows: list.map(function (c) {
      return [c.name, c.phone, c.city, t(DB.tier(c.loyaltyPoints)), c.loyaltyPoints,
              c.spentSyp, Math.round(c.spentUsd) / 100, c.visits, fmtDate(c.lastPurchaseDate),
              c.medianGapDays == null ? null : c.medianGapDays];
    }),
    totals: [t('total'), null, null, null, null,
             list.reduce(function (a, c) { return a + c.spentSyp; }, 0),
             Math.round(list.reduce(function (a, c) { return a + c.spentUsd; }, 0)) / 100,
             list.reduce(function (a, c) { return a + c.visits; }, 0), null, null],
    kpis: [{ label: t('customers_title'), value: nf(list.length) },
           { label: t('cu_quiet'), value: nf(DB.quietCustomers().length) }]
  };
}

function warehouseExportSpec() {
  /* Tab-aware: exporting from "Add product" must not hand back the movement log. */
  if (OG.wh.tab !== 'moves') {
    var sizes = DB.sizeSets[OG.wh.type] || [];
    var rows = [];
    sizes.forEach(function (s, i) {
      var q = Number(OG.wh.sizes[s] || 0);
      rows.push([s, q, whBarcode(OG.wh.type, s, i + 1)]);
    });
    return {
      name: 'new-product', sheet: 'New product', title: t('tab_add'),
      subtitle: (OG.wh.name || t('product_name')) + ' · ' + DB.typeLabels[OG.wh.type],
      columns: [{ label: t('size') }, { label: t('qty'), num: true }, { label: t('barcode') }],
      rows: rows,
      totals: [t('total_pieces'), rows.reduce(function (a, r) { return a + r[1]; }, 0), null],
      kpis: [{ label: t('type'), value: DB.typeLabels[OG.wh.type] },
             { label: t('size_matrix'), value: sizes.length + ' ' + t('size').toLowerCase() }]
    };
  }

  var mv = DB.stockMovements.slice(0, 200);
  return {
    name: 'stock-movements', sheet: 'Movements', title: t('tab_moves'),
    subtitle: mv.length + ' ' + t('movement').toLowerCase(),
    columns: [{ label: t('date') }, { label: t('movement') }, { label: t('product'), width: 30 },
              { label: t('size') }, { label: t('sku') }, { label: t('qty'), num: true },
              { label: t('balance'), num: true }, { label: t('user') }, { label: t('notes'), width: 34 }],
    rows: mv.map(function (m) {
      var p = DB.product(m.productId);
      return [fmtDate(m.date), t(m.type), p ? p.name : '—', m.size, m.sku, m.delta, m.balance, m.user, m.note];
    })
  };
}

function printJobsExportSpec() {
  var jobs = DB.printJobs.slice().sort(function (a, b) { return a.deadline - b.deadline; });
  var rev = jobs.reduce(function (a, j) { return a + j.price; }, 0);
  var cost = jobs.reduce(function (a, j) { return a + j.cost; }, 0);
  return {
    name: 'print-jobs', sheet: 'Print jobs', title: t('print_title'),
    docUrl: deepLink('report', 'profit'),
    subtitle: jobs.length + ' · ' + jobs.filter(function (j) { return DB.isOverdue(j); }).length + ' ' + t('overdue').toLowerCase(),
    columns: [{ label: t('yl_job') }, { label: t('customer'), width: 22 }, { label: t('design_note'), width: 36 },
              { label: t('qty'), num: true }, { label: t('priority') }, { label: t('deadline') },
              { label: t('status') }, { label: exCol(t('yl_charged')), num: true },
              { label: exCol(t('paid_partner')), num: true }, { label: exCol(t('profit')), num: true }],
    rows: jobs.map(function (j) {
      return [j.id, j.customer, j.design, j.qty, t(j.priority), fmtDate(j.deadline),
              t('print_' + j.stage), exMoney(j.price), exMoney(j.cost), exMoney(j.price - j.cost)];
    }),
    totals: [t('total'), null, null, jobs.reduce(function (a, j) { return a + j.qty; }, 0),
             null, null, null, exMoney(rev), exMoney(cost), exMoney(rev - cost)],
    kpis: [{ label: t('print_revenue'), value: money(rev) },
           { label: t('paid_partner'), value: money(cost) },
           { label: t('profit'), value: money(rev - cost) }]
  };
}

function salesExportSpec() {
  var sales = DB.sales.slice(0, 200);
  /* This sheet TOTALS the rows at the bottom, and DB.sales is the last 200
     the server sent — so on a shop with more than that, the total is of the
     window and not of the shop. The subtitle says which, because a sheet
     somebody hands a bank must not imply it is the whole year. */
  var cap = DB.cap('sales');
  return {
    name: 'sales', sheet: 'Sales', title: t('recent_sales'), chartId: 'dashLine',
    subtitle: sales.length + ' ' + t('invoices').toLowerCase() +
      (cap.capped ? ' · ' + t('cap_of').replace('{b}', nf(cap.total)) : ''),
    columns: [{ label: t('invoice') }, { label: t('date') }, { label: t('customer'), width: 22 },
              { label: t('items'), num: true }, { label: t('payment') },
              { label: exCol(t('total')), num: true }],
    rows: sales.map(function (s) {
      return [s.id, fmtDate(s.date), s.customerName,
              s.items.reduce(function (a, i) { return a + i.qty; }, 0),
              DB.payLabel(s.payment), exMoney(s.total)];
    }),
    totals: [t('total'), null, null, null, null,
             exMoney(sales.reduce(function (a, s) { return a + s.total; }, 0))]
  };
}

/* ------------------------------------------------------- DEEP LINKS
   #open/<type>/<id> — the destination a scanned QR lands on. Works when
   pasted from file://, and works from a phone camera once the folder is
   served on the LAN. Same route the printed receipt will use. */

function deepLink(type, id) {
  /* CONFIG.PUBLIC_URL wins when it is set: a QR printed today has to keep
     working from a phone that has never seen this laptop. Without it the link
     would carry file:/// or a LAN IP and die the moment it leaves the room. */
  var base = CONFIG.PUBLIC_URL || location.href.split('#')[0];
  return base + '#open/' + type + '/' + encodeURIComponent(id);
}

function handleDeepLink(hash) {
  var m = /^#?open\/([a-z]+)\/(.+)$/.exec(hash || '');
  if (!m) return false;
  var type = m[1], id = decodeURIComponent(m[2]);

  switch (type) {
    case 'product':
      go('products', function () { openProductDrawer(+id); });
      return true;
    /* A QR or a link that names a person opens their PAGE rather than a
       drawer over the list: a drawer is not a place, so it did not survive a
       refresh and Back reopened it instead of leaving it.

       EXCEPT at the till with a basket on the go. Navigating away from the
       POS mid-sale takes the cashier off the screen with a queue in front of
       her — so there the old behaviour is the right one, and the drawer opens
       over the sale without touching the hash. The drawer's Open profile
       button is still there for anyone who actually wants to leave.

       Stage G makes a scanned loyalty card attach the customer to the basket
       instead of showing a drawer; this guard is what that will hang on. */
    case 'customer':
      if (OG.view === 'pos' && typeof POS !== 'undefined' && POS.saleOpen()) {
        openCustomerDrawer(+id);
        /* Only go() rewrites the hash, and we deliberately did not call it —
           so a link pasted into the address bar would leave it reading
           #open/customer/81 while the till is on screen. Put it back to where
           we actually are. (Setting it fires one more hashchange, which
           resolves to the view already showing and does nothing.) */
        if (window.location.hash !== '#pos') window.location.hash = 'pos';
        return true;
      }
      go('customers', null, id);
      return true;
    case 'invoice':
      var s = DB.sale(id);
      go('reports', function () { if (s) openInvoice(s); else toast(t('invoice'), id, 'err'); });
      return true;
    case 'job':
      go('print', function () { openJobDrawer(id); });
      return true;
    /* A partner invoice only exists inside the Yalla Wear portal, so the link
       has to switch portals before it can open anything. Scanning a printed
       bill therefore lands the reader in the right app, not just the right
       screen. */
    case 'ywinvoice':
      if (!DB.invoice(id)) { toast(t('yi_invoice'), id, 'err'); return true; }
      if (!OG.print.partner) {
        OG.print.partner = true;
        YALLA.reset();
        renderSidebar(); renderTopbar();
      }
      YALLA.go('invoices', id);
      return true;
    case 'report':
      if (['sales', 'profit', 'inventory', 'employees', 'suppliers'].indexOf(id) > -1) OG.rep.tab = id;
      go('reports');
      return true;
    default:
      return false;
  }
}

/* Same pair of buttons on every screen that has something worth exporting. */
function exportButtons() {
  return '<button class="btn btn-ghost" data-act="export" data-kind="excel">' + t('export_excel') + '</button>' +
         '<button class="btn btn-ghost" data-act="export" data-kind="pdf">' + t('export_pdf') + '</button>';
}

/* The whole shop on one sheet — the page he hands a partner or a bank. */
function dashboardExportSpec() {
  var m = DB.monthlySales(6);
  var today = sumSalesOn(0);
  var mtd = monthToDate(0);
  var crit = DB.criticalVariants().length;
  /* Bought within the at-risk window. null is never-bought, which is not
     "active" — and would count as one here, because null < 90 is true in
     JavaScript. */
  var active = DB.customers.filter(function (c) {
    var n = DB.daysSince(c.lastPurchaseDate);
    return n !== null && n < DB.atRiskDays();
  }).length;
  var pend = DB.printJobs.filter(function (j) { return j.stage !== 'done'; }).length;
  var byType = DB.salesByType();

  var rows = m.map(function (x) {
    return [t('sales_6m'), x.label + ' ' + x.date.getFullYear(), x.count, exMoney(x.total)];
  });
  byType.forEach(function (x) { rows.push([t('sales_by_type'), x.label, null, exMoney(x.total)]); });
  buildAlerts().forEach(function (a) {
    rows.push([t('needs_attention'), String(a.text).replace(/<[^>]+>/g, ''), null, null]);
  });

  return {
    name: 'dashboard', sheet: 'Dashboard', title: t('dash_title'),
    subtitle: CONFIG.SHOP_NAME + ' · ' + fmtDate(TODAY), chartId: 'dashLine',
    docUrl: deepLink('report', 'sales'),
    columns: [{ label: t('status'), width: 22 }, { label: t('name'), width: 44 },
              { label: t('invoices'), num: true }, { label: exCol(t('total')), num: true }],
    rows: rows,
    kpis: [{ label: t('st_today'), value: money(today) },
           { label: t('st_month'), value: money(mtd) },
           { label: t('st_critical'), value: nf(crit) },
           { label: t('st_customers'), value: nf(active) },
           { label: t('st_print'), value: nf(pend) }]
  };
}

/* Today's till — effectively a shift report until the Money phase lands. */
function posExportSpec() {
  var from = daysAgo(0), to = daysAgo(-1);
  var today = DB.sales.filter(function (s) { return s.date >= from && s.date < to; });
  var byPay = {};
  today.forEach(function (s) { byPay[s.payment] = (byPay[s.payment] || 0) + s.total; });

  var rows = today.map(function (s) {
    return [s.id, fmtDateTime(s.date), s.customerName, DB.payLabel(s.payment),
            s.items.reduce(function (a, i) { return a + i.qty; }, 0), exMoney(s.total)];
  });
  Object.keys(byPay).forEach(function (k) {
    rows.push(['— ' + t('payment'), DB.payLabel(k), '', '', null, exMoney(byPay[k])]);
  });

  var total = today.reduce(function (a, s) { return a + s.total; }, 0);
  return {
    name: 'till-today', sheet: 'Till', title: t('pos_title'),
    subtitle: t('st_today') + ' · ' + fmtDate(TODAY),
    columns: [{ label: t('invoice') }, { label: t('date'), width: 22 }, { label: t('customer'), width: 22 },
              { label: t('payment') }, { label: t('items'), num: true },
              { label: exCol(t('total')), num: true }],
    rows: rows,
    totals: [t('total'), null, null, null,
             today.reduce(function (a, s) { return a + s.items.reduce(function (b, i) { return b + i.qty; }, 0); }, 0),
             exMoney(total)],
    kpis: [{ label: t('st_today'), value: money(total) },
           { label: t('invoices'), value: nf(today.length) },
           { label: t('avg_basket'), value: money(today.length ? total / today.length : 0) }]
  };
}

/* Who is allowed to do what — printable, for pinning on the wall. */
/* OG's side of the partner ledger: what it owes Yalla Wear, per invoice. */
function partnerInvoicesExportSpec() {
  var live = DB.partnerInvoices.filter(function (i) { return DB.invoiceStatus(i) !== 'draft'; });
  var total = 0, paid = 0;
  var rows = live.slice().sort(function (a, b) { return (b.issued || 0) - (a.issued || 0); })
    .map(function (inv) {
      total += DB.invoiceTotal(inv);
      paid += DB.invoicePaid(inv);
      return [inv.id, fmtDate(inv.issued), fmtDate(inv.due), DB.invoicePieces(inv),
              exMoney(DB.invoiceTotal(inv)), exMoney(DB.invoicePaid(inv)),
              exMoney(DB.invoiceBalance(inv)),
              t('yi_st_' + DB.invoiceStatus(inv)) + (DB.invoiceOverdue(inv) ? ' · ' + t('overdue') : '')];
    });

  return {
    name: 'partner-invoices', sheet: 'Partner invoices',
    title: t('og_partner_inv'),
    subtitle: CONFIG.PRINT_PARTNER + ' · ' + fmtDate(TODAY),
    columns: [{ label: t('yi_invoice') }, { label: t('yi_issued') }, { label: t('yi_due') },
              { label: t('pieces'), num: true }, { label: exCol(t('total')), num: true },
              { label: exCol(t('yi_paid')), num: true }, { label: exCol(t('yi_balance')), num: true },
              { label: t('status') }],
    rows: rows,
    totals: [t('total'), null, null,
             live.reduce(function (a, i) { return a + DB.invoicePieces(i); }, 0),
             exMoney(total), exMoney(paid), exMoney(DB.outstandingTotal()), null],
    kpis: [{ label: t('og_owed_to'), value: money(DB.outstandingTotal()) },
           { label: t('yi_paid'), value: money(paid) },
           { label: t('invoices'), value: String(live.length) }]
  };
}

function settingsExportSpec() {
  var roles = [t('role_admin'), t('role_manager'), t('role_cashier'), t('role_warehouse')];
  var rows = PERMISSIONS.map(function (p) {
    return [p[0], p[1] ? '✓' : '—', p[2] ? '✓' : '—', p[3] ? '✓' : '—', p[4] ? '✓' : '—'];
  });
  rows.push(['', '', '', '', '']);
  rows.push([t('exchange_rate'), '1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' SYP', '', '', '']);
  rows.push([t('points_per'), String(CONFIG.LOYALTY_POINTS_PER_1000), '', '', '']);
  rows.push([t('point_value'), nf(CONFIG.LOYALTY_POINT_VALUE) + ' SYP', '', '', '']);
  rows.push([t('tier'), t('silver') + ' ' + nf(CONFIG.TIER_SILVER) + ' · ' + t('gold') + ' ' + nf(CONFIG.TIER_GOLD), '', '', '']);

  return {
    name: 'settings', sheet: 'Roles', title: t('roles_perms'),
    subtitle: CONFIG.SHOP_NAME + ' · ' + fmtDate(TODAY),
    columns: [{ label: t('permission'), width: 34 }, { label: roles[0] }, { label: roles[1] },
              { label: roles[2] }, { label: roles[3] }],
    rows: rows,
    kpis: [{ label: t('roles_perms'), value: PERMISSIONS.length + ' × 4' },
           { label: t('exchange_rate'), value: nf(CONFIG.EXCHANGE_RATE) }]
  };
}

/* ------------------------------------------------- RECORD DOCUMENTS
   One record, one sheet. Each carries a QR back to itself in the system. */

function customerStatementSpec(cid) {
  var c = DB.customer(cid);
  if (!c) return null;
  var invoices = c.history.map(function (id) { return DB.sale(id); }).filter(Boolean)
                  .sort(function (a, b) { return a.date - b.date; });
  return {
    name: 'statement-' + c.id, sheet: 'Statement',
    title: t('rec_statement'),
    subtitle: c.name + ' · ' + c.phone + ' · ' + c.city,
    docUrl: deepLink('customer', c.id),
    columns: [{ label: t('invoice') }, { label: t('date') }, { label: t('items'), num: true },
              { label: t('payment') }, { label: exCol(t('total')), num: true },
              { label: t('points'), num: true }],
    rows: invoices.map(function (s) {
      return [s.id, fmtDate(s.date), s.items.reduce(function (a, i) { return a + i.qty; }, 0),
              DB.payLabel(s.payment), exMoney(s.total),
              s.pointsEarned];
    }),
    /* The totals row sums the rows above it — the invoices actually on the
       statement — rather than lifetime spend, which the KPI now carries in
       the currencies it actually happened in. */
    totals: [t('total'), null, null, null,
             invoices.reduce(function (a, s) { return a + exMoney(s.total); }, 0),
             c.loyaltyPoints],
    kpis: [{ label: t('total_spent'), value: moneyPairText(c.spentSyp, c.spentUsd) },
           { label: t('loyalty'), value: nf(c.loyaltyPoints) + ' ' + t('points') },
           { label: t('tier'), value: t(DB.tier(c.loyaltyPoints)) },
           { label: t('last_purchase'), value: relDate(c.lastPurchaseDate) }]
  };
}

function productSheetSpec(pid) {
  var p = DB.product(pid);
  if (!p) return null;
  var vs = DB.variantsOf(pid), total = DB.totalQty(pid), gaps = DB.sizeGaps(pid);
  return {
    name: 'stock-' + p.id, sheet: 'Stock sheet',
    title: t('rec_stock_sheet'),
    subtitle: p.name + ' · ' + p.brand + ' · ' + DB.typeLabels[p.type] +
              (gaps.length ? ' · ' + t('size_gap') + ': ' + gaps.join(', ') : ''),
    docUrl: deepLink('product', p.id),
    columns: [{ label: t('size') }, { label: t('sku') }, { label: t('barcode') },
              { label: t('qty'), num: true }, { label: t('shelf') }, { label: t('health') }],
    rows: vs.map(function (v) {
      return [v.size, v.sku, v.barcode, v.qty, v.shelf, t(DB.health(v.qty))];
    }),
    totals: [t('total'), null, null, total, null, t(DB.health(total))],
    kpis: [{ label: t('total_stock'), value: nf(total) + ' ' + t('pieces') },
           { label: t('stock_value'), value: money(total * p.costPrice) },
           { label: t('price'), value: money(p.sellingPrice) },
           { label: t('margin'), value: pct((p.sellingPrice - p.costPrice) / p.sellingPrice * 100, 0) }]
  };
}

function jobSheetSpec(jid) {
  var j = DB.printJobs.filter(function (x) { return x.id === jid; })[0];
  if (!j) return null;
  return {
    name: 'job-' + j.id, sheet: 'Work order',
    title: t('yl_work_order') + ' · ' + j.id,
    subtitle: j.customer + ' · ' + t('deadline') + ' ' + fmtDate(j.deadline) + ' · ' + t(j.priority),
    docUrl: deepLink('job', j.id),
    columns: [{ label: t('size') }, { label: t('qty'), num: true }],
    rows: Object.keys(j.sizes || {}).map(function (k) { return [k, j.sizes[k]]; }),
    totals: [t('total'), j.qty],
    kpis: [{ label: t('qty'), value: nf(j.qty) + ' ' + t('pieces') },
           { label: t('status'), value: t('print_' + j.stage) },
           { label: exCol(t('yl_charged')), value: money(j.price) },
           { label: t('design_note'), value: j.design }]
  };
}

function currentExportSpec() {
  if (OG.print.partner) return YALLA.exportSpec();
  switch (OG.view) {
    /* The dashboard export is the whole shop on one sheet — six months of
       revenue, best sellers, the lot. On a role home it would be a back door
       to figures that screen deliberately does not show, so it is tied to the
       same permission as the Reports screen it summarises. */
    case 'dashboard':  return allow('report.read') ? dashboardExportSpec() : null;
    case 'money':      return Money.exportSpec();
    case 'pos':        return posExportSpec();
    case 'settings':   return settingsExportSpec();
    case 'reports':    return reportExportSpec();
    case 'products':   return productsExportSpec();
    case 'customers':  return customersExportSpec();
    /* The count sheet is its own document — the one he signs off. Two `case
       'warehouse'` labels would be legal JavaScript and the first would
       silently win, so this stays a single branch. */
    case 'warehouse':  return (OG.wh.tab === 'count' && Stock.active())
                              ? Stock.exportSpec() : warehouseExportSpec();
    /* The Print screen has two tabs now, and each has to export itself — the
       same tab-blindness that once made every Warehouse tab export the same
       movement log. */
    case 'print':      return (OG.pr && OG.pr.tab === 'invoices')
                              ? partnerInvoicesExportSpec() : printJobsExportSpec();
    default:           return salesExportSpec();
  }
}
