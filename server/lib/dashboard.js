/* ============================================================================
   THE DASHBOARD'S FIGURES                                      [dashboard.js]
   ----------------------------------------------------------------------------
   Every number the home screens show, computed here in SQL over EVERY sale.

   It used to be summed in the browser from `GET /api/sales?limit=200` — the
   last two hundred invoices — and nothing on the screen said so. The day the
   shop rang up its 201st sale of the month, "30 days" quietly became "the
   most recent two hundred", and the owner's takings, the six-month chart, the
   margin and the best sellers were all wrong by an amount nobody could name.
   The cap family again, on the screen he opens first.

   THREE RULES, ALL OF THEM ABOUT NOT LYING
   ----------------------------------------
   1. THE DAY BELONGS TO THE BROWSER. This server is on UTC and the shop is
      not; a "today" computed here is wrong until three in the morning. The
      till sends `from`/`to` as the two instants it means, plus its zone as
      minutes, and every range here is half-open `at >= from AND at < to` on
      those exact strings. `parseRange` re-normalises both through
      toISOString() first, because `at` is written by nowIso() and a
      `+03:00` string would compare wrongly as TEXT.

   2. MONEY IS NEVER CONVERTED AND NEVER ADDED ACROSS CURRENCIES. Every sum is
      GROUP BY currency and comes back as a `{ syp, usd }` pair. A sale can
      settle in dollars, and a dollar added to a lira is a number that means
      nothing. The browser draws the pair as a pair.

   3. A BLOCK THE ACCOUNT MAY NOT SEE IS LEFT OUT, not nulled. The drawer is
      money.read, the margin is profit.read, one's own sales are `sell` — the
      same shape as GET /api/partner. The margin leaves as a percentage ONLY:
      no revenue, no cost, nothing a cashier could reconstruct a cost from.
      And the payload must never pass through scrubCost whole — COST_KEYS
      deletes keys literally named `margin`, which would blank the block for
      a manager who holds profit.read and not cost.read.
   ========================================================================== */

import * as DB from './db.js';
import * as Auth from './auth.js';
import * as Money from './money.js';
import * as Alerts from './alerts.js';
import * as Sales from './sales.js';
import * as Wants from './wants.js';

const DAY = 86400000;
const MAX_SPAN_DAYS = 366;
const TODO_ROWS = 50;

/* Two ISO instants and a zone, or one sentence saying what was wrong. The
   zone is whole minutes east of UTC — what `-new Date().getTimezoneOffset()`
   gives in the browser — and is only used to bucket the monthly chart in the
   caller's months rather than UTC's. */
export function parseRange(fromRaw, toRaw, tzRaw) {
  if (!fromRaw || !toRaw) return { error: 'from and to are both required, as ISO dates' };
  const f = Date.parse(fromRaw), t = Date.parse(toRaw);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return { error: 'from and to must be ISO dates' };
  if (t <= f) return { error: 'to must be after from' };
  if (t - f > MAX_SPAN_DAYS * DAY) return { error: `the range may not exceed ${MAX_SPAN_DAYS} days` };

  let tz = 0;
  if (tzRaw != null && tzRaw !== '') {
    tz = Number(tzRaw);
    if (!Number.isInteger(tz) || tz < -840 || tz > 840) {
      return { error: 'tz must be whole minutes between -840 and 840' };
    }
  }

  /* The first of the month five months before `to`, in the caller's zone —
     six months of chart, the current one included. */
  const local = new Date(t + tz * 60000);
  const first = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 5, 1) - tz * 60000;

  return {
    from: new Date(f).toISOString(),
    to: new Date(t).toISOString(),
    tz,
    monthsFrom: new Date(first).toISOString()
  };
}

/* Fold `GROUP BY currency` rows into one pair. Anything that is not one of
   the shop's two currencies is dropped rather than guessed at. */
function pair(rows, field) {
  const out = { syp: 0, usd: 0 };
  for (const r of rows) {
    if (r.currency === 'SYP') out.syp += Number(r[field]) || 0;
    else if (r.currency === 'USD') out.usd += Number(r[field]) || 0;
  }
  return out;
}

/* SQLite's datetime() modifier for the caller's zone, built from the
   validated integer and never from the raw query string. */
function tzModifier(tz) {
  return (tz >= 0 ? '+' : '-') + Math.abs(tz) + ' minutes';
}

export function build(user, { from, to, tz, monthsFrom }) {
  const d = DB.get();
  const can = (p) => Auth.can(user, p);
  const cfg = (k) => (d.prepare('SELECT value FROM config WHERE key = ?').get(k) || {}).value;
  const args = [from, to];

  const out = {
    range: { from, to },
    base: cfg('shop.base_currency') || 'SYP',
    at: DB.nowIso()
  };

  const sellish = can('sell') || can('report.read');

  /* ---- takings, per currency, and how they were paid --------------------- */
  if (sellish) {
    const byCur = d.prepare(
      `SELECT currency, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total,
              SUM(CASE WHEN discount > 0 THEN 1 ELSE 0 END) AS discounted
         FROM sales
        WHERE voided = 0 AND at >= ? AND at < ?
        GROUP BY currency`
    ).all(...args);

    const takings = pair(byCur, 'total');
    const countBy = pair(byCur, 'n');
    const avg = (sum, n) => (n > 0 ? Math.round(sum / n) : 0);

    const paid = new Map();
    d.prepare(
      `SELECT payment, currency, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
         FROM sales
        WHERE voided = 0 AND at >= ? AND at < ?
        GROUP BY payment, currency`
    ).all(...args).forEach((r) => {
      const row = paid.get(r.payment) || { payment: r.payment, count: 0, syp: 0, usd: 0 };
      row.count += r.n;
      if (r.currency === 'SYP') row.syp += r.total;
      else if (r.currency === 'USD') row.usd += r.total;
      paid.set(r.payment, row);
    });

    /* Above the cap a cashier may give on her own. The same rule the till
       enforces (config.sale.max_discount_pct); a sale over it went through a
       manager's override, and the owner wants to know how often. */
    const capPct = Number(cfg('sale.max_discount_pct')) || 10;
    const overCap = d.prepare(
      `SELECT COUNT(*) AS n FROM sales
        WHERE voided = 0 AND at >= ? AND at < ?
          AND discount > 0 AND subtotal > 0 AND discount * 100 > subtotal * ?`
    ).get(from, to, capPct).n;

    /* The one comparison: the same length of time immediately before. */
    const span = Date.parse(to) - Date.parse(from);
    const prevFrom = new Date(Date.parse(from) - span).toISOString();
    const previous = pair(d.prepare(
      `SELECT currency, COALESCE(SUM(total), 0) AS total
         FROM sales WHERE voided = 0 AND at >= ? AND at < ? GROUP BY currency`
    ).all(prevFrom, from), 'total');

    out.sales = {
      count: countBy.syp + countBy.usd,
      takings,
      countBy,
      avgBasket: { syp: avg(takings.syp, countBy.syp), usd: avg(takings.usd, countBy.usd) },
      byPayment: [...paid.values()].sort((a, b) => b.count - a.count),
      discounts: { count: byCur.reduce((a, r) => a + (r.discounted || 0), 0), overCap },
      previous
    };

    /* Margin as a percentage and nothing else. The cost total is computed
       and discarded here; it never leaves. `total` is after discount, so the
       margin is on what the shop actually took. */
    if (can('profit.read')) {
      const cost = pair(d.prepare(
        `SELECT s.currency, COALESCE(SUM(i.qty * i.unit_cost), 0) AS cost
           FROM sale_items i JOIN sales s ON s.id = i.sale_id
          WHERE s.voided = 0 AND s.at >= ? AND s.at < ?
          GROUP BY s.currency`
      ).all(...args), 'cost');
      const pctOf = (rev, c) => (rev > 0 ? Math.round((rev - c) / rev * 1000) / 10 : null);
      out.margin = { pct: { syp: pctOf(takings.syp, cost.syp), usd: pctOf(takings.usd, cost.usd) } };
    }
  }

  /* ---- the drawer --------------------------------------------------------
     Two views of the same shift. `shift` is the fact that a box is open and
     since when — the cashier gets that, so her home can say so. `drawer` is
     what it should hold, and that is money.read: a cashier who can see
     `expected` before she counts has nothing to count. */
  const open = (can('sell') || can('money.read')) ? Money.currentShift() : null;
  if (can('sell') || can('money.read')) {
    out.shift = open
      ? { open: true, id: open.id, openedAt: open.opened_at, by: open.user_name || null, whId: open.wh_id }
      : { open: false };
  }
  if (can('money.read')) {
    if (open) {
      const s = Money.shift(open.id);
      out.drawer = {
        open: true, id: s.id, openedAt: s.opened_at, by: s.user_name || null,
        currency: s.currency, float: s.float_amount,
        sales: s.sales, collected: s.collected, paidOut: s.paidOut, expected: s.expected
      };
    } else {
      out.drawer = { open: false };
    }

    /* What customers owe the shop, whole. Money.openDebts() is the one list
       every debt screen reads, uncapped by design, and this is the first
       place it has ever been totalled. Folded per currency the way
       customers.js does it, never restated as SQL. */
    const debts = { syp: 0, usd: 0, invoices: 0, customers: 0 };
    const who = new Set();
    for (const s of Money.openDebts()) {
      if (s.currency === 'SYP') debts.syp += s.balance;
      else if (s.currency === 'USD') debts.usd += s.balance;
      debts.invoices += 1;
      if (s.customer_id) who.add(s.customer_id);
    }
    debts.customers = who.size;
    out.debts = debts;

    const sup = d.prepare(
      `SELECT currency, COUNT(*) AS n, COALESCE(SUM(outstanding), 0) AS total
         FROM suppliers WHERE archived = 0 AND outstanding > 0
        GROUP BY currency`
    ).all();
    out.suppliers = { ...pair(sup, 'total'), count: sup.reduce((a, r) => a + r.n, 0) };
  }

  /* ---- customers ---------------------------------------------------------
     Only what the browser cannot already know exactly. Quiet regulars and
     full stamp cards are derived there from lists that are NOT windowed —
     /api/customers is uncapped and carries each person's rhythm, and the
     full-card ids ride beside the bell — so they stay where the At-risk and
     Card-full chips already compute them, one rule, one answer. */
  if (can('customer.read')) {
    const fresh = d.prepare(
      `SELECT COUNT(*) AS n FROM customers
        WHERE archived = 0 AND merged_into IS NULL AND created_at >= ? AND created_at < ?`
    ).get(...args).n;
    out.customers = { newInScope: fresh, wantsBack: Wants.backInStockTotals() };
  }

  /* ---- the to-do list ----------------------------------------------------
     The same function the bell calls, asked for more rows. Per account
     already, read state already on it. */
  out.todo = Alerts.list(user, { limit: TODO_ROWS });

  /* ---- who sold what ------------------------------------------------------
     Named people with money against them is staff.read, not `sell`. */
  if (can('staff.read')) {
    const people = new Map();
    d.prepare(
      `SELECT s.cashier_id, u.name, s.currency, COUNT(*) AS n, COALESCE(SUM(s.total), 0) AS total
         FROM sales s LEFT JOIN users u ON u.id = s.cashier_id
        WHERE s.voided = 0 AND s.at >= ? AND s.at < ?
        GROUP BY s.cashier_id, s.currency`
    ).all(...args).forEach((r) => {
      const key = r.cashier_id == null ? 'none' : String(r.cashier_id);
      const row = people.get(key) || { userId: r.cashier_id, name: r.name || null, count: 0, syp: 0, usd: 0 };
      row.count += r.n;
      if (r.currency === 'SYP') row.syp += r.total;
      else if (r.currency === 'USD') row.usd += r.total;
      people.set(key, row);
    });
    out.staff = [...people.values()].sort((a, b) => b.count - a.count);
  }

  /* ---- one's own sales, by id ---------------------------------------------
     The cashier's home. Keyed on cashier_id = this account, never on a name. */
  if (can('sell')) {
    const mine = pair(d.prepare(
      `SELECT currency, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
         FROM sales WHERE voided = 0 AND cashier_id = ? AND at >= ? AND at < ?
        GROUP BY currency`
    ).all(user.id, from, to), 'total');
    const mineN = pair(d.prepare(
      `SELECT currency, COUNT(*) AS n
         FROM sales WHERE voided = 0 AND cashier_id = ? AND at >= ? AND at < ?
        GROUP BY currency`
    ).all(user.id, from, to), 'n');
    out.me = {
      count: mineN.syp + mineN.usd,
      takings: mine,
      latest: Sales.inRange({ from, to, limit: 5, cashierId: user.id })
    };
    out.latest = Sales.inRange({ from, to, limit: 5 });
  }

  /* ---- charts ------------------------------------------------------------
     Monthly over ALL sales since monthsFrom, bucketed in the caller's months.
     By type and best sellers over the scope. Units are currency-free; money
     is a pair like everywhere else. */
  if (sellish) {
    const local = new Date(Date.parse(to) + tz * 60000);
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - i, 1));
      months.push(m.toISOString().slice(0, 7));
    }
    const byMonth = new Map(months.map((m) => [m, { month: m, syp: 0, usd: 0, count: 0 }]));
    d.prepare(
      `SELECT SUBSTR(datetime(at, ?), 1, 7) AS month, currency,
              COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
         FROM sales
        WHERE voided = 0 AND at >= ?
        GROUP BY month, currency`
    ).all(tzModifier(tz), monthsFrom).forEach((r) => {
      const row = byMonth.get(r.month);
      if (!row) return;
      row.count += r.n;
      if (r.currency === 'SYP') row.syp += r.total;
      else if (r.currency === 'USD') row.usd += r.total;
    });

    const types = new Map();
    d.prepare(
      `SELECT COALESCE(p.type, '') AS type, s.currency,
              COALESCE(SUM(i.qty * i.unit_price), 0) AS total, COALESCE(SUM(i.qty), 0) AS units
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         LEFT JOIN products p ON p.id = i.product_id
        WHERE s.voided = 0 AND s.at >= ? AND s.at < ?
        GROUP BY type, s.currency`
    ).all(...args).forEach((r) => {
      const row = types.get(r.type) || { type: r.type, syp: 0, usd: 0, units: 0 };
      row.units += r.units;
      if (r.currency === 'SYP') row.syp += r.total;
      else if (r.currency === 'USD') row.usd += r.total;
      types.set(r.type, row);
    });

    const top = d.prepare(
      `SELECT i.product_id AS productId, COALESCE(p.name, i.name) AS name, SUM(i.qty) AS units
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         LEFT JOIN products p ON p.id = i.product_id
        WHERE s.voided = 0 AND s.at >= ? AND s.at < ?
        GROUP BY i.product_id, COALESCE(p.name, i.name)
        ORDER BY units DESC, COALESCE(p.name, i.name)
        LIMIT 6`
    ).all(...args);

    out.charts = {
      monthly: [...byMonth.values()],
      /* Ordered by units, which is the one figure that is the same in any
         currency. Ordering by syp + usd would be adding lira to dollars, even
         if only to sort. */
      byType: [...types.values()].sort((a, b) => b.units - a.units || b.syp - a.syp),
      topProducts: top
    };
  }

  /* ---- what arrived -------------------------------------------------------
     `type = 'received'` and not any positive delta: the browser's figure
     counted a transfer from the back to the floor as an arrival, so moving a
     box across the shop made it look like a delivery had come. */
  if (can('stock.read')) {
    const r = d.prepare(
      `SELECT COALESCE(SUM(delta), 0) AS pieces, COUNT(*) AS moves
         FROM stock_movements
        WHERE type = 'received' AND delta > 0 AND at >= ? AND at < ?`
    ).get(...args);
    out.arrivals = { pieces: r.pieces, moves: r.moves };
  }

  return out;
}
