/* ==========================================================================
   OG SYSTEM — the month's statement                             [statement.js]
   --------------------------------------------------------------------------
   Two questions about one calendar month in the shop's own clock:

     PROFIT AND LOSS — did the shop make money? Sales, less what came back,
     less what the goods cost, less what it cost to keep the doors open.

     CASH FLOW — where did the money go? Every place in the cash book: what it
     held when the month began, what came in and went out by kind, what it
     held when the month ended. Straight from money_moves, so the closing
     figure of the current month IS the Now tab's balance.

   THREE RULES, the same ones as everywhere else:

   1. Every row of every table, never the browser's last 200.
   2. Lira and dollars are two columns and are never added. The one line that
      puts them together — "≈ in lira" — converts EACH ROW at the shop's rate
      at that row's own moment (the fx_rates history, which is append-only),
      and says it is approximate. A dollar sale froze fx_rate = 1, which is
      no lira rate at all, so the history is the only honest source.
   3. What cannot be known is said, not guessed. Printing charged at the till
      is not part of the sale, so neither it nor Yalla Wear's bill is in the
      profit; pieces sold with no cost price make the gross too high and the
      statement counts them.

   Owner draws, money the owner put in, and payments to suppliers are shown
   BELOW the line: none of them is a cost. The goods a supplier is paid for
   are already in the cost of goods sold.
   ========================================================================== */

import { get } from './db.js';
import * as Payables from './payables.js';

const fail = (message, code) => Object.assign(new Error(message), { code });

function config(d, key, fallback) {
  const r = d.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return r ? r.value : fallback;
}

/* The shop's month as two UTC instants. `tz` is minutes east of UTC — the
   browser sends -getTimezoneOffset(), as it does for the dashboard. */
export function monthRange(d, month, tz) {
  const off = tz === undefined || tz === null || tz === ''
    ? Number(config(d, 'shop.tz_minutes', 180))
    : Number(tz);
  if (!Number.isInteger(off) || Math.abs(off) > 840) throw fail('tz must be whole minutes between -840 and 840', 'bad_range');
  let ym = month;
  if (!ym) ym = new Date(Date.now() + off * 60000).toISOString().slice(0, 7);
  if (typeof ym !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw fail('a month is YYYY-MM', 'bad_range');
  const [y, m] = ym.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) - off * 60000).toISOString();
  const to = new Date(Date.UTC(y, m, 1) - off * 60000).toISOString();
  return { month: ym, from, to, tz: off };
}

/* The shop's rate at any moment, from the history. Before the first rate
   was ever set, the first one is the nearest thing to true. */
function rates(d) {
  const hist = {};
  for (const r of d.prepare(
    "SELECT quote, rate, set_at FROM fx_rates WHERE base = 'USD' ORDER BY set_at, id"
  ).all()) (hist[r.quote] || (hist[r.quote] = [])).push(r);
  return (quote, at) => {
    if (quote === 'USD') return 1;
    const list = hist[quote];
    if (!list || !list.length) return null;
    let best = list[0].rate;
    for (const r of list) { if (r.set_at <= at) best = r.rate; else break; }
    return best;
  };
}

export function build({ month = null, tz = null, withCash = true } = {}) {
  const d = get();
  const range = monthRange(d, month, tz);
  const { from, to } = range;
  const base = config(d, 'shop.base_currency', 'SYP');
  const exps = {};
  for (const c of d.prepare('SELECT code, minor_exp FROM currencies').all()) exps[c.code] = c.minor_exp;
  const currencies = Object.keys(exps).sort((a, b) => (a === base ? -1 : b === base ? 1 : a.localeCompare(b)));
  const rateAt = rates(d);

  /* Minor units of `cur` at `at`, as (fractional) minor units of the base. */
  let unconverted = 0;
  const toBase = (amount, cur, at) => {
    if (cur === base) return amount;
    const rc = rateAt(cur, at), rb = rateAt(base, at);
    if (!rc || !rb) { unconverted++; return 0; }
    const usd = amount / Math.pow(10, exps[cur] ?? 0) / rc;
    return usd * rb * Math.pow(10, exps[base] ?? 0);
  };

  /* A line is { key, amounts: {cur: minor}, approx } — built by adding rows. */
  const line = (key, extra) => ({ key, amounts: {}, approx: 0, ...(extra || {}) });
  const add = (l, cur, amount, at) => {
    if (!amount) return;
    l.amounts[cur] = (l.amounts[cur] || 0) + amount;
    l.approx += toBase(amount, cur, at);
  };

  /* ---- what was sold ---------------------------------------------------- */
  const sales = line('sales');
  const shipping = line('shipping');
  const cogs = line('cogs');
  let count = 0;
  let noCost = 0;
  for (const s of d.prepare(
    `SELECT s.at, s.currency, s.total,
            (SELECT COALESCE(SUM(i.qty * COALESCE(i.unit_cost, 0)), 0) FROM sale_items i WHERE i.sale_id = s.id) AS cost,
            (SELECT COALESCE(SUM(i.qty), 0) FROM sale_items i
              WHERE i.sale_id = s.id AND COALESCE(i.unit_cost, 0) <= 0) AS uncosted,
            CASE WHEN dl.fee_mode = 'invoice' THEN COALESCE(dl.fee, 0) ELSE 0 END AS ship
       FROM sales s LEFT JOIN deliveries dl ON dl.sale_id = s.id
      WHERE s.voided = 0 AND s.at >= ? AND s.at < ?`
  ).all(from, to)) {
    count++;
    add(sales, s.currency, s.total, s.at);
    add(shipping, s.currency, s.ship, s.at);
    add(cogs, s.currency, -s.cost, s.at);
    noCost += s.uncosted;
  }

  /* ---- what came back --------------------------------------------------
     A return takes its own figure off the bill (goods at the price they were
     sold at, and the shipping when all of it came back), and its goods go
     back into stock — so their cost comes back off the cost of goods. */
  const returns = line('returns');
  for (const r of d.prepare(
    `SELECT r.at, s.currency, r.due_minor,
            (SELECT COALESCE(SUM(rl.qty * COALESCE(
                      (SELECT i.unit_cost FROM sale_items i WHERE i.sale_id = r.sale_id AND i.sku = rl.sku LIMIT 1), 0)), 0)
               FROM order_return_lines rl WHERE rl.return_id = r.id) AS cost_back
       FROM order_returns r JOIN sales s ON s.id = r.sale_id
      WHERE s.voided = 0 AND r.at >= ? AND r.at < ?`
  ).all(from, to)) {
    add(returns, r.currency, -(r.due_minor || 0), r.at);
    add(cogs, r.currency, r.cost_back, r.at);
  }

  /* ---- what it cost to keep the doors open ------------------------------ */
  const byCat = new Map();
  for (const e of d.prepare(
    `SELECT e.at, e.currency, e.amount, e.category FROM expenses e
      WHERE e.at >= ? AND e.at < ?
        AND e.id NOT IN (SELECT ref_id FROM money_moves WHERE kind = 'expense_void' AND ref_type = 'expense')`
  ).all(from, to)) {
    if (!byCat.has(e.category)) byCat.set(e.category, line('expense', { category: e.category }));
    add(byCat.get(e.category), e.currency || base, -e.amount, e.at);
  }
  const expenses = [...byCat.values()].sort((a, b) => a.approx - b.approx);

  /* Salaries paid FOR this month, whenever they were paid — an advance in
     the last week of August for September is September's cost. */
  const salaries = line('salaries');
  for (const p of d.prepare(
    `SELECT p.at, p.currency, p.kind, p.amount,
            (SELECT o.kind FROM salary_payments o WHERE o.id = p.reverses_id) AS undid
       FROM salary_payments p WHERE p.month = ?`
  ).all(range.month)) {
    if (p.kind === 'advance' || p.kind === 'salary') add(salaries, p.currency, -p.amount, p.at);
    else if (p.kind === 'reversal' && (p.undid === 'advance' || p.undid === 'salary')) add(salaries, p.currency, p.amount, p.at);
  }

  /* ---- the cash book's own costs and corrections ------------------------ */
  const fees = line('fees');
  const counts = line('count_diff');
  const exchange = line('exchange');
  const ownerDraw = line('owner_draw');
  const ownerIn = line('owner_in');
  const supplierPay = line('supplier_pay');
  const partnerPay = line('partner_pay');
  const moves = d.prepare(
    `SELECT id, at, place, currency, amount, kind, pair_id FROM money_moves
      WHERE at >= ? AND at < ? ORDER BY id`
  ).all(from, to);
  const pairs = new Map();
  for (const m of moves) {
    if (m.kind === 'fee') add(fees, m.currency, m.amount, m.at);
    else if (m.kind === 'count_diff') add(counts, m.currency, m.amount, m.at);
    else if (m.kind === 'owner_draw') add(ownerDraw, m.currency, m.amount, m.at);
    else if (m.kind === 'owner_in') add(ownerIn, m.currency, m.amount, m.at);
    else if (m.kind === 'supplier_pay') add(supplierPay, m.currency, m.amount, m.at);
    else if (m.kind === 'partner_pay') add(partnerPay, m.currency, m.amount, m.at);
    else if (m.kind === 'exchange') {
      const k = m.pair_id || m.id;
      pairs.set(k, (pairs.get(k) || 0) + toBase(m.amount, m.currency, m.at));
    }
  }
  /* An exchange at the shop's own rate is worth nothing either way; at a
     better or worse one it is a gain or a loss, in the shop's currency. */
  for (const gain of pairs.values()) {
    const g = Math.round(gain);
    if (g) { exchange.amounts[base] = (exchange.amounts[base] || 0) + g; exchange.approx += g; }
  }

  /* ---- the arithmetic --------------------------------------------------- */
  const total = (key, parts) => {
    const t = line(key, { total: true });
    for (const p of parts) {
      for (const [c, v] of Object.entries(p.amounts)) t.amounts[c] = (t.amounts[c] || 0) + v;
      t.approx += p.approx;
    }
    return t;
  };
  const revenue = total('revenue', [sales, shipping, returns]);
  const gross = total('gross', [revenue, cogs]);
  const costs = [...expenses, salaries, fees, counts, exchange];
  const net = total('net', [gross, ...costs]);

  const round = (l) => ({ ...l, approx: Math.round(l.approx) });
  const lines = [sales, shipping, returns, revenue, cogs, gross, ...expenses, salaries, fees, counts, exchange, net]
    .map(round);

  const payroll = Payables.payroll({ month: range.month });
  const left = line('salaries_left');
  for (const [c, v] of Object.entries(payroll.totals)) if (v.left) left.amounts[c] = v.left;

  const below = [ownerDraw, ownerIn, supplierPay, partnerPay].map(round);
  below.push({ ...left, approx: null });

  const out = {
    ...range, base, currencies,
    lines, below,
    facts: {
      sales: count,
      noCost,
      unconverted,
      printingOutside: true,
      booksFrom: (d.prepare('SELECT MIN(at) AS at FROM money_moves').get() || {}).at || null
    }
  };

  /* ---- cash flow -------------------------------------------------------- */
  if (withCash) {
    const byPlace = new Map();
    const key = (p, c) => p + ' ' + c;
    for (const r of d.prepare(
      `SELECT place, currency,
              COALESCE(SUM(CASE WHEN at < ? THEN amount ELSE 0 END), 0) AS opening,
              COALESCE(SUM(CASE WHEN at < ? THEN amount ELSE 0 END), 0) AS closing
         FROM money_moves WHERE at < ? GROUP BY place, currency`
    ).all(from, to, to)) {
      byPlace.set(key(r.place, r.currency), {
        place: r.place, currency: r.currency, opening: r.opening, closing: r.closing,
        in: 0, out: 0, kinds: {}
      });
    }
    for (const m of moves) {
      const row = byPlace.get(key(m.place, m.currency));
      if (!row) continue;
      if (m.amount > 0) row.in += m.amount; else row.out += m.amount;
      row.kinds[m.kind] = (row.kinds[m.kind] || 0) + m.amount;
    }
    const places = [...byPlace.values()].filter((r) => r.opening || r.closing || r.in || r.out);
    const totals = {};
    for (const r of places) {
      const t = totals[r.currency] || (totals[r.currency] = { opening: 0, in: 0, out: 0, closing: 0, kinds: {} });
      t.opening += r.opening; t.in += r.in; t.out += r.out; t.closing += r.closing;
      for (const [k, v] of Object.entries(r.kinds)) t.kinds[k] = (t.kinds[k] || 0) + v;
    }
    out.cash = { places, totals };
  }
  return out;
}
