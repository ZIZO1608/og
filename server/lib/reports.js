/* ============================================================================
   THE ADMIN REPORTS                                              [reports.js]
   ----------------------------------------------------------------------------
   Every figure on the Reports screen, computed here in SQL over EVERY sale.

   This is the second half of the job server/lib/dashboard.js did for the home
   screens, and it exists for the same reason. Until now the Reports screen was
   summed in the browser out of `DB.sales` — the last two hundred invoices the
   server happened to send — and it was wrong in two separate ways at once:

     1. THE WINDOW.  "Six months of revenue" meant "whatever of the last two
        hundred invoices happens to fall in six months". On a shop doing eight
        sales a day that is five weeks, printed under a heading that says half
        a year. There was a note on the screen saying the LIST was capped; the
        totals under it went on claiming to be the shop.

     2. THE CURRENCY.  It added `s.total` across every sale in the window with
        no regard for `sales.currency` — the browser's sale object did not even
        carry one — so a $100 pair of trainers went into the month as 100 lira,
        about seventy US cents. Every revenue, profit and margin figure on the
        screen was built on that sum.

   THE SAME THREE RULES AS THE DASHBOARD, FOR THE SAME REASONS
   -----------------------------------------------------------
   1. THE DAY BELONGS TO THE BROWSER. This machine is on UTC and Aleppo is not.
      The range arrives as two instants and a zone; `parseRange` is shared with
      dashboard.js so there is one definition and not two, and it re-normalises
      both through toISOString() because `at` is UTC text and a `+03:00` string
      compares wrongly as TEXT. Every range is half-open: `at >= ? AND at < ?`.

   2. MONEY IS NEVER CONVERTED AND NEVER ADDED ACROSS CURRENCIES. Every sum is
      GROUP BY currency and leaves as a `{ syp, usd }` pair, in minor units.
      The browser draws the pair as a pair.

   3. A BLOCK THE ACCOUNT MAY NOT SEE IS ABSENT, NOT NULLED. `profit` needs
      profit.read, `payments`/`suppliers` need money.read, `employees` needs
      staff.read, the cost half of `inventory` needs cost.read. Every reader in
      the browser is null-safe and draws "unavailable" rather than a zero — a
      zero is a claim, and it is the wrong one.

   AND ONE RULE OF ITS OWN
   -----------------------
   4. ARCHIVED STOCK IS NOT STOCK. `products.hidden` is the shop's "we have
      stopped selling this"; the row survives because invoices still name it.
      Every figure here that answers "how much stock does the shop have" filters
      it out. The browser's old inventoryValue() walked every product, so the
      demo catalogue's discontinued pieces were counted as capital in the one
      figure the owner reads as money he is owed by his own shelves.
      Sales history is the opposite case and deliberately does NOT filter: a
      pair sold in March was sold, whatever the shop stocks today.
   ========================================================================== */

import * as DB from './db.js';
import * as Auth from './auth.js';
import * as Money from './money.js';
import { parseRange } from './dashboard.js';

export { parseRange };

const DAY = 86400000;

/* Past this many days the sales series is bucketed by month instead of by day.
   A year of daily rows is 365 lines nobody reads; a week of monthly rows is one
   line that says nothing. The browser is told which it got (`grain`) so the
   column header can name it rather than guess. */
const DAILY_MAX_DAYS = 92;
const MAX_BUCKETS = 400;

/* SQLite's datetime() modifier for the caller's zone, built from the integer
   parseRange already validated and never from the raw query string. */
function tzModifier(tz) {
  return (tz >= 0 ? '+' : '-') + Math.abs(tz) + ' minutes';
}

/* Fold `GROUP BY currency` rows into one pair. Anything that is not one of the
   shop's two currencies is dropped rather than guessed at. */
function pair(rows, field) {
  const out = { syp: 0, usd: 0 };
  for (const r of rows) {
    if (r.currency === 'SYP') out.syp += Number(r[field]) || 0;
    else if (r.currency === 'USD') out.usd += Number(r[field]) || 0;
  }
  return out;
}

function addPair(into, r, field) {
  if (r.currency === 'SYP') into.syp += Number(r[field]) || 0;
  else if (r.currency === 'USD') into.usd += Number(r[field]) || 0;
}

/* Every bucket in the range, in the caller's zone, INCLUDING the empty ones —
   a month the shop took nothing is a fact and has to be drawn, or the chart
   silently closes the gap and a dead February looks like it never happened.

   `to` is exclusive, so the last bucket is measured from one millisecond
   before it: a "today" window ends at tomorrow's midnight, and reading that
   as a bucket would add a second day (or, in month grain, a whole month). */
function buckets(from, to, tz, grain) {
  const out = [];
  const first = new Date(Date.parse(from) + tz * 60000);
  const last = new Date(Date.parse(to) - 1 + tz * 60000);

  if (grain === 'day') {
    let cur = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
    const end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
    while (cur <= end && out.length < MAX_BUCKETS) {
      out.push(new Date(cur).toISOString().slice(0, 10));
      cur += DAY;
    }
    return out;
  }

  let y = first.getUTCFullYear(), m = first.getUTCMonth();
  const endY = last.getUTCFullYear(), endM = last.getUTCMonth();
  while ((y < endY || (y === endY && m <= endM)) && out.length < MAX_BUCKETS) {
    out.push(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7));
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

export function build(user, { from, to, tz }) {
  const d = DB.get();
  const can = (p) => Auth.can(user, p);
  const cfg = (k) => (d.prepare('SELECT value FROM config WHERE key = ?').get(k) || {}).value;
  const args = [from, to];

  const spanDays = (Date.parse(to) - Date.parse(from)) / DAY;
  const grain = spanDays <= DAILY_MAX_DAYS ? 'day' : 'month';

  const out = {
    range: { from, to, tz, grain, days: Math.round(spanDays) },
    base: cfg('shop.base_currency') || 'SYP',
    at: DB.nowIso()
  };

  /* ---- the sales series --------------------------------------------------
     One row per bucket, always in order, empty buckets included. `count` is
     currency-free (an invoice is an invoice); money is a pair. */
  {
    const keys = buckets(from, to, tz, grain);
    const cut = grain === 'day' ? 10 : 7;
    const rows = new Map(keys.map((k) => [k, { bucket: k, count: 0, syp: 0, usd: 0 }]));

    d.prepare(
      `SELECT SUBSTR(datetime(at, ?), 1, ${cut}) AS bucket, currency,
              COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
         FROM sales
        WHERE voided = 0 AND at >= ? AND at < ?
        GROUP BY bucket, currency`
    ).all(tzModifier(tz), from, to).forEach((r) => {
      const row = rows.get(r.bucket);
      if (!row) return;
      row.count += r.n;
      addPair(row, r, 'total');
    });

    const byCur = d.prepare(
      `SELECT currency, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total,
              COALESCE(SUM(subtotal), 0) AS subtotal,
              COALESCE(SUM(discount), 0) AS discount,
              COALESCE(SUM(CASE WHEN discount > 0 THEN 1 ELSE 0 END), 0) AS discounted
         FROM sales
        WHERE voided = 0 AND at >= ? AND at < ?
        GROUP BY currency`
    ).all(...args);

    const takings = pair(byCur, 'total');
    const countBy = pair(byCur, 'n');
    const avg = (sum, n) => (n > 0 ? Math.round(sum / n) : 0);

    /* Units shifted, so "average basket" can be read beside "pieces per sale"
       rather than only in money that moves with the lira. */
    const units = d.prepare(
      `SELECT COALESCE(SUM(i.qty), 0) AS units
         FROM sale_items i JOIN sales s ON s.id = i.sale_id
        WHERE s.voided = 0 AND s.at >= ? AND s.at < ?`
    ).get(...args).units;

    /* The one comparison: the same length of time immediately before. */
    const span = Date.parse(to) - Date.parse(from);
    const prevFrom = new Date(Date.parse(from) - span).toISOString();
    const prevRows = d.prepare(
      `SELECT currency, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
         FROM sales WHERE voided = 0 AND at >= ? AND at < ? GROUP BY currency`
    ).all(prevFrom, from);

    /* Voids are not a rounding error — a voided sale is money that looked like
       it arrived and did not, and the owner is entitled to see how often. */
    const voided = d.prepare(
      `SELECT currency, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
         FROM sales WHERE voided = 1 AND at >= ? AND at < ? GROUP BY currency`
    ).all(...args);

    out.sales = {
      grain,
      series: keys.map((k) => rows.get(k)),
      count: countBy.syp + countBy.usd,
      countBy,
      takings,
      subtotal: pair(byCur, 'subtotal'),
      discount: pair(byCur, 'discount'),
      discounted: byCur.reduce((a, r) => a + (r.discounted || 0), 0),
      units,
      avgBasket: { syp: avg(takings.syp, countBy.syp), usd: avg(takings.usd, countBy.usd) },
      previous: { takings: pair(prevRows, 'total'), count: prevRows.reduce((a, r) => a + r.n, 0) },
      voided: { count: voided.reduce((a, r) => a + r.n, 0), total: pair(voided, 'total') }
    };
  }

  /* ---- profit by product type -------------------------------------------
     Revenue and units are `sell`-level facts and go out to anyone who may open
     this screen; cost, profit and margin are profit.read and are simply not
     computed for anyone else. `unit_price` and `unit_cost` are both stored in
     the SALE's currency, so this is arithmetic on one currency per row rather
     than a re-conversion at today's rate — which is the whole point of
     freezing fx onto the sale.

     LEFT JOIN products, and the type falls back to '': a line whose product
     was later deleted is still revenue that happened. */
  {
    const wantsProfit = can('profit.read');
    const types = new Map();
    const touch = (k) => {
      if (!types.has(k)) {
        types.set(k, {
          type: k, units: 0,
          revenue: { syp: 0, usd: 0 },
          cost: wantsProfit ? { syp: 0, usd: 0 } : null,
          profit: wantsProfit ? { syp: 0, usd: 0 } : null
        });
      }
      return types.get(k);
    };

    d.prepare(
      `SELECT COALESCE(p.type, '') AS type, s.currency,
              COALESCE(SUM(i.qty), 0) AS units,
              COALESCE(SUM(i.qty * i.unit_price), 0) AS revenue,
              COALESCE(SUM(i.qty * i.unit_cost), 0) AS cost
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         LEFT JOIN products p ON p.id = i.product_id
        WHERE s.voided = 0 AND s.at >= ? AND s.at < ?
        GROUP BY type, s.currency`
    ).all(...args).forEach((r) => {
      const row = touch(r.type);
      row.units += Number(r.units) || 0;
      addPair(row.revenue, r, 'revenue');
      if (wantsProfit) {
        addPair(row.cost, r, 'cost');
        row.profit.syp = row.revenue.syp - row.cost.syp;
        row.profit.usd = row.revenue.usd - row.cost.usd;
      }
    });

    /* Margin as a percentage per currency, one decimal, and null where there
       was no revenue in that currency at all — a shop that took no dollars has
       no dollar margin, and 0% would say it sold at cost. */
    const pctOf = (rev, c) => (rev > 0 ? Math.round((rev - c) / rev * 1000) / 10 : null);
    const list = [...types.values()].map((r) => ({
      ...r,
      margin: wantsProfit
        ? { syp: pctOf(r.revenue.syp, r.cost.syp), usd: pctOf(r.revenue.usd, r.cost.usd) }
        : null
    }));

    const totRev = { syp: 0, usd: 0 }, totCost = { syp: 0, usd: 0 };
    let totUnits = 0;
    list.forEach((r) => {
      totUnits += r.units;
      totRev.syp += r.revenue.syp; totRev.usd += r.revenue.usd;
      if (wantsProfit) { totCost.syp += r.cost.syp; totCost.usd += r.cost.usd; }
    });

    /* Ranked on profit where it is visible and on revenue where it is not, so
       the ORDER of the rows never leaks the figure the account may not see. */
    const rank = (r) => (r.profit ? r.profit.syp + r.profit.usd : r.revenue.syp + r.revenue.usd);
    out.profit = {
      hasCost: wantsProfit,
      rows: list.sort((a, b) => rank(b) - rank(a)),
      totals: {
        units: totUnits,
        revenue: totRev,
        cost: wantsProfit ? totCost : null,
        profit: wantsProfit ? { syp: totRev.syp - totCost.syp, usd: totRev.usd - totCost.usd } : null,
        margin: wantsProfit
          ? { syp: pctOf(totRev.syp, totCost.syp), usd: pctOf(totRev.usd, totCost.usd) }
          : null
      }
    };
  }

  /* ---- what is on the shelves RIGHT NOW ----------------------------------
     Present tense, so the date range does not apply and the browser says so
     rather than letting a "30 days" chip imply this is thirty days of stock.
     Prices live on the product in the currency it is actually priced in, so
     this groups by (type, currency) and folds into a pair like everything
     else. Units are currency-free and add straight across.

     p.hidden = 0 is rule 4 at the top of this file. */
  {
    const wantsCost = can('cost.read');
    const types = new Map();
    d.prepare(
      `SELECT p.type AS type, p.currency AS currency,
              COALESCE(SUM(st.qty), 0) AS units,
              COALESCE(SUM(st.qty * p.cost_price), 0) AS cost,
              COALESCE(SUM(st.qty * p.selling_price), 0) AS retail,
              COUNT(DISTINCT v.sku) AS skus
         FROM stock st
         JOIN variants v ON v.sku = st.sku
         JOIN products p ON p.id = v.product_id
        WHERE p.hidden = 0
        GROUP BY p.type, p.currency`
    ).all().forEach((r) => {
      const row = types.get(r.type) || {
        type: r.type, units: 0, skus: 0,
        cost: wantsCost ? { syp: 0, usd: 0 } : null,
        retail: { syp: 0, usd: 0 }
      };
      row.units += Number(r.units) || 0;
      row.skus += Number(r.skus) || 0;
      addPair(row.retail, r, 'retail');
      if (wantsCost) addPair(row.cost, r, 'cost');
      types.set(r.type, row);
    });

    const list = [...types.values()];
    const totCost = { syp: 0, usd: 0 }, totRetail = { syp: 0, usd: 0 };
    let totUnits = 0, totSkus = 0;
    list.forEach((r) => {
      totUnits += r.units; totSkus += r.skus;
      totRetail.syp += r.retail.syp; totRetail.usd += r.retail.usd;
      if (wantsCost) { totCost.syp += r.cost.syp; totCost.usd += r.cost.usd; }
    });

    list.sort(wantsCost
      ? (a, b) => (b.cost.syp + b.cost.usd) - (a.cost.syp + a.cost.usd)
      : (a, b) => b.units - a.units);

    const archived = d.prepare(
      `SELECT COALESCE(SUM(st.qty), 0) AS units
         FROM stock st
         JOIN variants v ON v.sku = st.sku
         JOIN products p ON p.id = v.product_id
        WHERE p.hidden = 1`
    ).get().units;

    out.inventory = {
      hasCost: wantsCost,
      rows: list,
      totals: {
        units: totUnits, skus: totSkus,
        cost: wantsCost ? totCost : null,
        retail: totRetail,
        profit: wantsCost
          ? { syp: totRetail.syp - totCost.syp, usd: totRetail.usd - totCost.usd }
          : null
      },
      /* Named rather than silently dropped. Somebody who remembers a bigger
         number is owed the reason it moved, or the fix reads as a new bug. */
      archivedUnits: Number(archived) || 0
    };
  }

  /* ---- money in, and who owes what --------------------------------------- */
  if (can('money.read')) {
    const byPay = new Map();
    d.prepare(
      `SELECT payment, currency, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
         FROM sales
        WHERE voided = 0 AND at >= ? AND at < ?
        GROUP BY payment, currency`
    ).all(...args).forEach((r) => {
      const row = byPay.get(r.payment) || { payment: r.payment, count: 0, syp: 0, usd: 0 };
      row.count += r.n;
      addPair(row, r, 'total');
      byPay.set(r.payment, row);
    });

    /* Above the cap a cashier may give on her own — the same rule the till
       enforces. A sale over it went through a manager, and the owner wants to
       know how often that happens. */
    const capPct = Number(cfg('sale.max_discount_pct')) || 10;
    const overCap = d.prepare(
      `SELECT COUNT(*) AS n FROM sales
        WHERE voided = 0 AND at >= ? AND at < ?
          AND discount > 0 AND subtotal > 0 AND discount * 100 > subtotal * ?`
    ).get(from, to, capPct).n;

    /* What customers owe, WHOLE — not windowed by the range. A debt raised in
       March is still owed in September, and a report that dropped it because
       the chip says "30 days" would understate the shop's exposure by exactly
       the debts that have been outstanding longest. Folded per currency by the
       same uncapped list every debt screen reads. */
    const debts = { syp: 0, usd: 0, invoices: 0, customers: 0, oldestDays: null };
    const who = new Set();
    const now = Date.now();
    for (const s of Money.openDebts()) {
      if (s.currency === 'SYP') debts.syp += s.balance;
      else if (s.currency === 'USD') debts.usd += s.balance;
      debts.invoices += 1;
      if (s.customer_id) who.add(s.customer_id);
      const age = Math.floor((now - Date.parse(s.at)) / DAY);
      if (Number.isFinite(age) && (debts.oldestDays === null || age > debts.oldestDays)) {
        debts.oldestDays = age;
      }
    }
    debts.customers = who.size;

    const collected = d.prepare(
      `SELECT currency, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
         FROM debt_payments WHERE at >= ? AND at < ? GROUP BY currency`
    ).all(...args);

    const spend = new Map();
    d.prepare(
      `SELECT category, currency, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
         FROM expenses WHERE at >= ? AND at < ? GROUP BY category, currency`
    ).all(...args).forEach((r) => {
      const row = spend.get(r.category) || { category: r.category, count: 0, syp: 0, usd: 0 };
      row.count += r.n;
      addPair(row, r, 'total');
      spend.set(r.category, row);
    });

    const spendRows = [...spend.values()].sort((a, b) => (b.syp + b.usd) - (a.syp + a.usd));
    const spendTotal = { syp: 0, usd: 0 };
    spendRows.forEach((r) => { spendTotal.syp += r.syp; spendTotal.usd += r.usd; });

    const sup = d.prepare(
      `SELECT currency, COUNT(*) AS n, COALESCE(SUM(outstanding), 0) AS total
         FROM suppliers WHERE archived = 0 AND outstanding > 0 GROUP BY currency`
    ).all();

    out.payments = {
      byPayment: [...byPay.values()].sort((a, b) => b.count - a.count),
      discounts: {
        count: out.sales.discounted,
        amount: out.sales.discount,
        overCap,
        capPct
      },
      debts,
      collected: { count: collected.reduce((a, r) => a + r.n, 0), total: pair(collected, 'total') },
      expenses: { rows: spendRows, total: spendTotal },
      suppliers: { ...pair(sup, 'total'), count: sup.reduce((a, r) => a + r.n, 0) }
    };
  }

  /* ---- suppliers ---------------------------------------------------------- */
  if (can('money.read')) {
    out.suppliers = d.prepare(
      `SELECT id, name, contact, category, currency, outstanding, total_purchased,
              due_date, last_payment
         FROM suppliers WHERE archived = 0
        ORDER BY outstanding DESC, name COLLATE NOCASE`
    ).all().map((s) => ({
      id: s.id, name: s.name, contact: s.contact, category: s.category,
      currency: s.currency, outstanding: s.outstanding,
      totalPurchased: s.total_purchased, dueDate: s.due_date, lastPayment: s.last_payment
    }));
  }

  /* ---- the payroll, and what each of them sold ---------------------------
     Named people with money against them is staff.read, exactly as on the
     dashboard. An employee is matched to sales through `user_id`, never
     through a name: two people called Ahmad is a shop, not a bug. Somebody on
     the payroll with no login gets `sold: null` rather than a zero — "has no
     till login" and "sold nothing this week" are different sentences, and a
     tailor or a driver should not be shown as the worst salesman in the shop. */
  if (can('staff.read')) {
    const sold = new Map();
    d.prepare(
      `SELECT cashier_id, currency, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
         FROM sales
        WHERE voided = 0 AND cashier_id IS NOT NULL AND at >= ? AND at < ?
        GROUP BY cashier_id, currency`
    ).all(...args).forEach((r) => {
      const row = sold.get(r.cashier_id) || { count: 0, syp: 0, usd: 0 };
      row.count += r.n;
      addPair(row, r, 'total');
      sold.set(r.cashier_id, row);
    });

    const salary = { syp: 0, usd: 0 };
    const rows = d.prepare(
      `SELECT id, user_id, name, role, currency, salary, next_payment, since, phone
         FROM employees WHERE archived = 0
        ORDER BY name COLLATE NOCASE`
    ).all().map((e) => {
      if (e.currency === 'SYP') salary.syp += e.salary;
      else if (e.currency === 'USD') salary.usd += e.salary;
      const s = e.user_id != null ? sold.get(e.user_id) : null;
      return {
        id: e.id, userId: e.user_id, name: e.name, role: e.role,
        currency: e.currency, salary: e.salary,
        nextPayment: e.next_payment, since: e.since, phone: e.phone,
        sold: e.user_id == null ? null : (s || { count: 0, syp: 0, usd: 0 })
      };
    });

    out.employees = { rows, salary, count: rows.length };
  }

  return out;
}
