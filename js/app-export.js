/* ==========================================================================
   OG SYSTEM — application shell  ·  4/17: EXPORT SPECS + DEEP LINKS
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 1213-1722). Loads after
   app-util.js.
   ========================================================================== */

/* ------------------------------------------------- THE REPORTS EXPORT
   The same snapshot the screen was drawn from — DB.rep, computed on the
   server over every sale — laid out for a spreadsheet rather than for a
   table.

   TWO THINGS THIS DOES DIFFERENTLY FROM THE SCREEN, both because a
   spreadsheet is a different object from a page.

   1. MONEY BECOMES COLUMNS, NOT A PAIR. On screen "12,150 SYP + $40" is one
      honest cell. In Excel it is a string, and a string cannot be summed,
      sorted or charted — so each currency gets its own numeric column with
      its own currency format, and the USD column only appears when dollars
      were actually taken. What must never happen is the two being added,
      which is what the old spec did by writing one `exMoney()` column.

   2. FIGURES ARE NUMBERS, DATES ARE DATES. `money`, `pct`, `date` and `int`
      columns arrive in Excel as their real types, so the shop can sort by
      due date and filter by margin. They used to arrive as text.           */

/* USD is stored in cents and SYP in whole lira (minor_exp 2 and 0). A
   spreadsheet wants the amount a person would write down. */
function exSyp(v) { return Math.round(Number(v) || 0); }
function exUsd(v) { return Math.round(Number(v) || 0) / 100; }

/* One money column per currency the shop actually used. `pairs` is every
   pair that will appear in the column, so a lira-only shop never gets an
   empty dollar column and a shop that took $40 once always does. */
function exMoneyCols(label, pairs) {
  var cols = [{ label: label + ' (SYP)', money: 'SYP' }];
  if ((pairs || []).some(function (p) { return p && p.usd; })) {
    cols.push({ label: label + ' (USD)', money: 'USD' });
  }
  return cols;
}
function exMoneyVals(pair, cols) {
  var out = [exSyp(pair ? pair.syp : 0)];
  if (cols > 1) out.push(exUsd(pair ? pair.usd : 0));
  return out;
}

/* A single-currency figure — a supplier's balance, an employee's salary —
   into the two columns. The other one is left BLANK rather than zeroed: a
   supplier billed in dollars has no lira balance, and a 0 in that column
   would be summed by anybody who selects it. */
function exOneCur(currency, v, cols) {
  var out = [currency === 'USD' ? null : exSyp(v)];
  if (cols > 1) out.push(currency === 'USD' ? exUsd(v) : null);
  return out;
}

function reportExportSpec() {
  var tab = typeof repTab === 'function' ? repTab() : (OG.rep && OG.rep.tab) || 'sales';
  var r = DB.rep;

  var s = {
    name: 'report-' + tab,
    chartId: 'repChart',
    docUrl: deepLink('report', tab),
    /* The range that was actually asked for, not a fixed 180 days printed
       over whatever happened to be on screen. Stock and payroll are present
       tense and say so. */
    subtitle: (tab === 'inventory' || tab === 'employees' || tab === 'suppliers')
      ? t('rp_as_of') + ' ' + fmtDate(new Date())
      : (typeof repRangeLabel === 'function' ? repRangeLabel() : fmtDate(new Date()))
  };

  /* No snapshot means no report. An export of an empty grid, handed to
     somebody as "the month", is worse than no file at all. */
  if (!r) {
    return {
      name: 'report', sheet: 'Report', title: t('reports_title'),
      subtitle: t('rp_unavailable'),
      columns: [{ label: t('reports_title'), width: 60 }],
      rows: [[t('rp_unavailable')]]
    };
  }

  if (tab === 'profit')         profitExportSpec(s, r);
  else if (tab === 'inventory') inventoryExportSpec(s, r);
  else if (tab === 'payments')  paymentsExportSpec(s, r);
  else if (tab === 'employees') employeesExportSpec(s, r);
  else if (tab === 'suppliers') suppliersExportSpec(s, r);
  else                          salesReportExportSpec(s, r);

  return s;
}

function salesReportExportSpec(s, r) {
  var d = r.sales, series = d.series;
  var pairs = series.concat([d.takings, d.avgBasket]);
  var revCols = exMoneyCols(t('revenue'), pairs);
  var avgCols = exMoneyCols(t('avg_basket'), pairs);

  s.title = t('tab_sales'); s.sheet = 'Sales';
  s.columns = [{ label: t(d.grain === 'day' ? 'rp_day' : 'rp_month'), width: 16 },
               { label: t('invoices'), int: true }]
              .concat(revCols, avgCols);

  /* A day with no invoices has no average basket, and that is not the same
     thing as an average basket of zero — there were no baskets. Revenue on
     such a day IS zero and stays a zero, because the column is summed and a
     gap in a sum is a different lie. */
  var blankAvg = avgCols.map(function () { return null; });

  s.rows = series.map(function (b) {
    var avg = b.count ? {
      syp: b.syp ? Math.round(b.syp / b.count) : 0,
      usd: b.usd ? Math.round(b.usd / b.count) : 0
    } : null;
    return [DB.repBucketLabel(b.bucket, d.grain), b.count]
      .concat(exMoneyVals(b, revCols.length), avg ? exMoneyVals(avg, avgCols.length) : blankAvg);
  });

  s.totals = [t('total'), d.count]
    .concat(exMoneyVals(d.takings, revCols.length), exMoneyVals(d.avgBasket, avgCols.length));

  s.kpis = [{ label: t('revenue'), value: moneyPairText(d.takings.syp, d.takings.usd) },
            { label: t('invoices'), value: nf(d.count) },
            { label: t('pieces'), value: nf(d.units) },
            { label: t('avg_basket'), value: moneyPairText(d.avgBasket.syp, d.avgBasket.usd) },
            { label: t('discount'), value: moneyPairText(d.discount.syp, d.discount.usd) }];
}

function profitExportSpec(s, r) {
  var p = r.profit, rows = p.rows, tot = p.totals;
  s.title = t('tab_profit'); s.sheet = 'Profit';

  if (!p.hasCost) {
    /* The account may open the screen but not see cost. The sheet carries
       what it is allowed to carry rather than a column of blanks — a hidden
       column in a spreadsheet is a column somebody will ask about. */
    var rCols = exMoneyCols(t('revenue'), rows.map(function (x) { return x.revenue; }).concat([tot.revenue]));
    s.columns = [{ label: t('type'), width: 22 }, { label: t('units'), int: true }].concat(rCols);
    s.rows = rows.map(function (x) {
      return [DB.typeLabels[x.type] || x.type || '—', x.units].concat(exMoneyVals(x.revenue, rCols.length));
    });
    s.totals = [t('total'), tot.units].concat(exMoneyVals(tot.revenue, rCols.length));
    s.kpis = [{ label: t('revenue'), value: moneyPairText(tot.revenue.syp, tot.revenue.usd) },
              { label: t('units'), value: nf(tot.units) }];
    return;
  }

  var all = [];
  rows.forEach(function (x) { all.push(x.revenue, x.cost, x.profit); });
  all.push(tot.revenue, tot.cost, tot.profit);
  var revC = exMoneyCols(t('revenue'), all), costC = exMoneyCols(t('cost'), all),
      proC = exMoneyCols(t('profit'), all);

  s.columns = [{ label: t('type'), width: 22 }, { label: t('units'), int: true }]
    .concat(revC, costC, proC, [{ label: t('margin') + ' (SYP)', pct: true }]);
  if (revC.length > 1) s.columns.push({ label: t('margin') + ' (USD)', pct: true });

  s.rows = rows.map(function (x) {
    var out = [DB.typeLabels[x.type] || x.type || '—', x.units]
      .concat(exMoneyVals(x.revenue, revC.length), exMoneyVals(x.cost, costC.length),
              exMoneyVals(x.profit, proC.length), [x.margin.syp]);
    if (revC.length > 1) out.push(x.margin.usd);
    return out;
  });

  s.totals = [t('total'), tot.units]
    .concat(exMoneyVals(tot.revenue, revC.length), exMoneyVals(tot.cost, costC.length),
            exMoneyVals(tot.profit, proC.length), [tot.margin.syp]);
  if (revC.length > 1) s.totals.push(tot.margin.usd);

  s.kpis = [{ label: t('revenue'), value: moneyPairText(tot.revenue.syp, tot.revenue.usd) },
            { label: t('cost'), value: moneyPairText(tot.cost.syp, tot.cost.usd) },
            { label: t('profit'), value: moneyPairText(tot.profit.syp, tot.profit.usd) },
            { label: t('margin'), value: tot.margin.syp === null ? '—' : pct(tot.margin.syp, 1) }];
}

function inventoryExportSpec(s, r) {
  var iv = r.inventory, rows = iv.rows, tot = iv.totals;
  s.title = t('tab_inventory'); s.sheet = 'Inventory';

  var all = [];
  rows.forEach(function (x) { all.push(x.retail); if (iv.hasCost) all.push(x.cost); });
  all.push(tot.retail); if (iv.hasCost) all.push(tot.cost);

  var costC = iv.hasCost ? exMoneyCols(t('capital_in_stock'), all) : [];
  var retC = exMoneyCols(t('retail_value'), all);
  var proC = iv.hasCost ? exMoneyCols(t('profit'), all) : [];

  s.columns = [{ label: t('type'), width: 22 }, { label: t('pieces'), int: true },
               { label: t('rp_lines'), int: true }].concat(costC, retC, proC);

  s.rows = rows.map(function (x) {
    var out = [DB.typeLabels[x.type] || x.type || '—', x.units, x.skus];
    if (iv.hasCost) out = out.concat(exMoneyVals(x.cost, costC.length));
    out = out.concat(exMoneyVals(x.retail, retC.length));
    if (iv.hasCost) {
      out = out.concat(exMoneyVals({ syp: x.retail.syp - x.cost.syp,
                                     usd: x.retail.usd - x.cost.usd }, proC.length));
    }
    return out;
  });

  var totals = [t('total'), tot.units, tot.skus];
  if (iv.hasCost) totals = totals.concat(exMoneyVals(tot.cost, costC.length));
  totals = totals.concat(exMoneyVals(tot.retail, retC.length));
  if (iv.hasCost) totals = totals.concat(exMoneyVals(tot.profit, proC.length));
  s.totals = totals;

  s.kpis = [];
  if (iv.hasCost) s.kpis.push({ label: t('capital_in_stock'), value: moneyPairText(tot.cost.syp, tot.cost.usd) });
  s.kpis.push({ label: t('retail_value'), value: moneyPairText(tot.retail.syp, tot.retail.usd) },
              { label: t('pieces'), value: nf(tot.units) },
              { label: t('rp_lines'), value: nf(tot.skus) });

  /* The pieces this sheet is NOT counting, on the sheet. A total somebody
     remembers as bigger needs its reason travelling with it, or the file
     starts an argument the next time it is opened. */
  if (iv.archivedUnits) {
    s.note = t('rp_archived_note').replace('{n}', nf(iv.archivedUnits));
  }
}

function paymentsExportSpec(s, r) {
  var p = r.payments, d = r.sales;
  s.title = t('rp_tab_payments'); s.sheet = 'Payments';

  var all = p.byPayment.slice().concat(p.expenses.rows, [d.takings, p.debts, p.suppliers,
                                                         p.expenses.total, p.collected.total]);
  var amtC = exMoneyCols(t('total'), all);

  s.columns = [{ label: t('status'), width: 20 }, { label: t('rp_method'), width: 26 },
               { label: t('invoices'), int: true }].concat(amtC);

  var rows = [];
  p.byPayment.forEach(function (x) {
    rows.push([t('rp_taken'), DB.payLabel(x.payment), x.count].concat(exMoneyVals(x, amtC.length)));
  });
  p.expenses.rows.forEach(function (x) {
    rows.push([t('mn_expenses'), expenseLabel(x.category), x.count].concat(exMoneyVals(x, amtC.length)));
  });
  if (p.collected.count) {
    rows.push([t('rp_collected'), t('cu_take_payment'), p.collected.count]
      .concat(exMoneyVals(p.collected.total, amtC.length)));
  }
  /* Balances, not takings — and marked as such in the first column, because a
     column of money with no label is exactly how a debt gets added to a day's
     cash. */
  rows.push([t('rp_owed_by_customers'), nf(p.debts.customers) + ' ' + t('rp_people'),
             p.debts.invoices].concat(exMoneyVals(p.debts, amtC.length)));
  rows.push([t('rp_owed_to_suppliers'), nf(p.suppliers.count) + ' ' + t('tab_suppliers'),
             null].concat(exMoneyVals(p.suppliers, amtC.length)));
  rows.push([t('discount'), p.discounts.overCap
              ? t('rp_over_cap').replace('{n}', nf(p.discounts.overCap)).replace('{p}', p.discounts.capPct + '%')
              : t('discount'),
             p.discounts.count].concat(exMoneyVals(p.discounts.amount, amtC.length)));

  s.rows = rows;
  s.totals = [t('rp_taken'), t('total'), d.count].concat(exMoneyVals(d.takings, amtC.length));
  s.kpis = [{ label: t('rp_taken'), value: moneyPairText(d.takings.syp, d.takings.usd) },
            { label: t('rp_owed_by_customers'), value: moneyPairText(p.debts.syp, p.debts.usd) },
            { label: t('rp_owed_to_suppliers'), value: moneyPairText(p.suppliers.syp, p.suppliers.usd) },
            { label: t('mn_expenses'), value: moneyPairText(p.expenses.total.syp, p.expenses.total.usd) }];
  s.note = t('rp_debt_note');
}

function employeesExportSpec(s, r) {
  var e = r.employees, rows = e.rows;
  s.title = t('tab_employees'); s.sheet = 'Employees';

  var sold = { syp: 0, usd: 0 }, soldN = 0;
  rows.forEach(function (x) {
    if (!x.sold) return;
    sold.syp += x.sold.syp; sold.usd += x.sold.usd; soldN += x.sold.count;
  });

  var anyUsd = e.salary.usd || sold.usd ||
               rows.some(function (x) { return x.currency === 'USD'; });
  var pad = anyUsd ? [{ syp: 0, usd: 1 }] : [];
  var salC = exMoneyCols(t('salary'), pad);
  var solC = exMoneyCols(t('sales_made'), pad);

  s.columns = [{ label: t('name'), width: 26 }, { label: t('role'), width: 18 }]
    .concat(salC, [{ label: t('invoices'), int: true }], solC,
            [{ label: t('rp_started'), date: true }, { label: t('next_payment'), date: true },
             { label: t('phone'), width: 18 }]);

  /* Somebody with no till login gets BLANK sales cells, not zeros. A zero
     here is summed by anyone who selects the column, and it says a tailor
     sold nothing when the truth is that a tailor does not use the till. */
  var blanks = salC.length === solC.length ? solC.map(function () { return null; }) : [null];

  s.rows = rows.map(function (x) {
    return [x.name, x.role]
      .concat(exOneCur(x.currency, x.salary, salC.length),
              [x.sold ? x.sold.count : null],
              x.sold ? exMoneyVals(x.sold, solC.length) : blanks,
              [x.since || null, x.nextPayment || null, x.phone || '']);
  });

  s.totals = [t('total'), null]
    .concat(exMoneyVals(e.salary, salC.length), [soldN], exMoneyVals(sold, solC.length),
            [null, null, null]);

  s.kpis = [{ label: t('rp_payroll'), value: moneyPairText(e.salary.syp, e.salary.usd) },
            { label: t('rp_people'), value: nf(e.count) },
            { label: t('sales_made'), value: moneyPairText(sold.syp, sold.usd) }];
}

function suppliersExportSpec(s, r) {
  var list = r.suppliers || [];
  s.title = t('tab_suppliers'); s.sheet = 'Suppliers';

  var outstanding = { syp: 0, usd: 0 }, purchased = { syp: 0, usd: 0 };
  list.forEach(function (x) {
    if (x.currency === 'USD') { outstanding.usd += x.outstanding; purchased.usd += x.totalPurchased; }
    else { outstanding.syp += x.outstanding; purchased.syp += x.totalPurchased; }
  });

  var pad = list.some(function (x) { return x.currency === 'USD'; }) ? [{ syp: 0, usd: 1 }] : [];
  var purC = exMoneyCols(t('rp_purchased'), pad);
  var outC = exMoneyCols(t('outstanding'), pad);

  s.columns = [{ label: t('supplier'), width: 26 }, { label: t('category'), width: 18 }]
    /* `lastPayment`, which is when the shop last paid THEM — not "since". */
    .concat(purC, outC, [{ label: t('due'), date: true },
                         { label: t('rp_last_paid'), date: true },
                         { label: t('phone'), width: 18 }]);

  s.rows = list.map(function (x) {
    return [x.name, x.category || '']
      .concat(exOneCur(x.currency, x.totalPurchased, purC.length),
              exOneCur(x.currency, x.outstanding, outC.length),
              [x.dueDate || null, x.lastPayment || null, x.contact || '']);
  });

  s.totals = [t('total'), null]
    .concat(exMoneyVals(purchased, purC.length), exMoneyVals(outstanding, outC.length),
            [null, null, null]);

  s.kpis = [{ label: t('outstanding'), value: moneyPairText(outstanding.syp, outstanding.usd) },
            { label: t('rp_purchased'), value: moneyPairText(purchased.syp, purchased.usd) },
            { label: t('tab_suppliers'), value: nf(list.length) }];
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
      /* repTab() bounces an account that may not open the named tab back to
         Sales, so a QR printed by a manager and scanned by a cashier lands on
         a screen rather than on a blank card. */
      if (['sales', 'profit', 'inventory', 'payments', 'employees', 'suppliers'].indexOf(id) > -1) {
        OG.rep.tab = id;
      }
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
  /* Everything money-shaped comes off the server's snapshot — the same one
     the screen was drawn from, over every sale rather than the last two
     hundred. Written in the shop's own currency; dollars taken as dollars
     get their own column only when there were any. */
  var dash = DB.dash || {};
  var charts = dash.charts || { monthly: [], byType: [] };
  var sales = dash.sales || null;
  var todo = dash.todo ? dash.todo.rows : [];
  var base = dash.base || 'SYP';
  var pick = function (p) { return base === 'USD' ? p.usd / 100 : p.syp; };
  var anyUsd = charts.monthly.some(function (m) { return m.usd > 0; }) ||
               charts.byType.some(function (x) { return x.usd > 0; });

  var crit = DB.criticalVariants().length;
  /* Bought within the at-risk window. null is never-bought, which is not
     "active" — and would count as one here, because null < 90 is true in
     JavaScript. */
  var active = DB.customers.filter(function (c) {
    var n = DB.daysSince(c.lastPurchaseDate);
    return n !== null && n < DB.atRiskDays();
  }).length;
  var pend = DB.printJobs.filter(function (j) { return j.stage !== 'done'; }).length;

  var rows = charts.monthly.map(function (m) {
    var r = [t('sales_6m'), monthLabel(m.month) + ' ' + m.month.slice(0, 4), m.count, pick(m)];
    if (anyUsd) r.push(base === 'USD' ? m.syp : m.usd / 100);
    return r;
  });
  charts.byType.forEach(function (x) {
    var r = [t('sales_by_type'), DB.typeLabels[x.type] || x.type || '—', x.units, pick(x)];
    if (anyUsd) r.push(base === 'USD' ? x.syp : x.usd / 100);
    return rows.push(r);
  });
  todo.forEach(function (a) {
    var r = [t('needs_attention'), String(DB.alertText(a)).replace(/<[^>]+>/g, ''), null, null];
    if (anyUsd) r.push(null);
    rows.push(r);
  });

  var columns = [{ label: t('status'), width: 22 }, { label: t('name'), width: 44 },
                 { label: t('invoices'), num: true },
                 { label: t('total') + ' (' + base + ')', num: true }];
  if (anyUsd) columns.push({ label: t('total') + ' (' + (base === 'USD' ? 'SYP' : 'USD') + ')', num: true });

  var scopeLabel = t(OG.dashScope === '30d' ? 'dash_scope_30d' : OG.dashScope === '7d' ? 'dash_scope_7d' : 'dash_scope_today');

  return {
    name: 'dashboard', sheet: 'Dashboard', title: t('dash_title'),
    subtitle: CONFIG.SHOP_NAME + ' · ' + fmtDate(new Date()) + ' · ' + scopeLabel, chartId: 'dashLine',
    docUrl: deepLink('report', 'sales'),
    columns: columns,
    rows: rows,
    kpis: [{ label: t('dash_takings') + ' · ' + scopeLabel,
             value: sales ? moneyPairText(sales.takings.syp, sales.takings.usd) : '—' },
           { label: t('invoices'), value: sales ? nf(sales.count) : '—' },
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

/* Who is allowed to do what — printable, for pinning on the wall.

   THIS THREW EVERY TIME IT WAS PRESSED. It walked a global called
   PERMISSIONS: four roles and a hardcoded matrix, which stopped existing when
   the real one moved into the `role_permissions` table, and nothing was left
   behind under that name. Both Export buttons on the Settings screen have
   been raising a ReferenceError ever since — before the guard in ACTIONS
   could even look at the result — so the two buttons did nothing at all and
   said nothing about why.

   It now reads the SAME matrix the grid on screen is drawn from: ROLE_MATRIX,
   which GET /api/roles filled in, with the shipped defaults as the fallback
   for _shot.html where there is no server to ask. Five roles, not four, and
   the permission list is whatever the server actually holds rather than a
   copy that had already gone stale. */
function settingsExportSpec() {
  var m = (typeof ROLE_MATRIX !== 'undefined' && ROLE_MATRIX) ||
          (typeof demoMatrix === 'function' ? demoMatrix() : null);
  if (!m) return null;

  var columns = [{ label: t('permission'), width: 36 }];
  m.roles.forEach(function (r) { columns.push({ label: roleLabel(r), width: 14 }); });

  var pad = m.roles.map(function () { return ''; });
  var rows = [];
  var lastGroup = null;
  m.permissions.forEach(function (p) {
    /* The same group headings the grid uses. Twenty-five ticked boxes in one
       column is unreadable; broken into Till, Stock, Money it reads as a
       description of a job. */
    if (p.group !== lastGroup) {
      lastGroup = p.group;
      rows.push(['— ' + t('pg_' + p.group).toUpperCase()].concat(pad));
    }
    rows.push([p.label].concat(m.roles.map(function (r) {
      var cell = p.roles[r] || {};
      /* A locked box is not the same as an unticked one — `manager` cannot
         lose config.write, and `partner` can never be given customer.read —
         and a wall chart that does not say so invites somebody to try. */
      return (cell.allowed ? '✓' : '—') + (cell.locked ? ' 🔒' : '');
    })));
  });

  /* The shop's own numbers under the matrix, because the page they are
     printed from is the page they are set on. */
  rows.push([''].concat(pad));
  rows.push(['— ' + t('setg_shop').toUpperCase()].concat(pad));
  rows.push([t('exchange_rate') + ': 1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' SYP'].concat(pad));
  rows.push([t('points_per') + ': ' + nf(CONFIG.LOYALTY_POINTS_PER_1000)].concat(pad));
  rows.push([t('point_value') + ': ' + nf(CONFIG.LOYALTY_POINT_VALUE) + ' SYP'].concat(pad));
  rows.push([t('tier') + ': ' + t('silver') + ' ' + nf(CONFIG.TIER_SILVER) +
             ' · ' + t('gold') + ' ' + nf(CONFIG.TIER_GOLD)].concat(pad));

  return {
    name: 'roles-and-permissions', sheet: 'Roles', title: t('roles_perms'),
    subtitle: CONFIG.SHOP_NAME + ' · ' + fmtDate(new Date()),
    columns: columns,
    rows: rows,
    kpis: [{ label: t('roles_perms'), value: m.permissions.length + ' × ' + m.roles.length },
           { label: t('exchange_rate'), value: '1 USD = ' + nf(CONFIG.EXCHANGE_RATE) + ' SYP' }],
    note: t('rp_locked_note')
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
