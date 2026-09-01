/* ==========================================================================
   OG SYSTEM — customers
   --------------------------------------------------------------------------
   The people the shop knows by name. Small table, but it is the one that
   decides whether the loyalty scheme is a real promise or a number on a
   screen, so two rules are load-bearing:

   POINTS ARE NEVER WRITTEN FROM HERE ON A SALE. `Sales.record` earns and
   redeems them inside the same transaction as the invoice, because a balance
   that can move independently of the sales that moved it cannot be audited.
   `adjustPoints` below exists for the manager's deliberate correction — a
   goodwill gesture, a mistake being put right — and it says so in the trail.

   CUSTOMERS ARE ARCHIVED, NEVER DELETED. Every past sale carries a
   customer_id. Deleting the row leaves invoices pointing at nobody, and the
   shop loses the ability to answer "who bought this" about its own history.

   MONEY IS NEVER ADDED ACROSS CURRENCIES. The list used to send one
   `total_spent` that was SUM(total) over every sale regardless of currency —
   a $45 sale (total 4500, USD) and a 4,500-lira sale (total 4500, SYP) each
   counted 4500. It was right only while every sale happened to be lira. The
   shop prices goods in both, so lifetime spend is now two figures in the
   currency the customer actually handed over, plus a third that exists only
   to sort by. See the SELECT below.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';
import { openDebts } from './money.js';
import { normPhone } from './text.js';

/* Everything the list needs to draw one customer, in one query.

   spent_syp / spent_usd are what the person actually paid, in the currency
   they paid it in. They never change and they are what the screen shows,
   side by side.

   spent_usd_equiv exists ONLY TO SORT — a list needs one number to order
   by. Every sale is converted at ITS OWN frozen fx_rate (the same arithmetic
   server/lib/sales.js's convert() does at the till: out of minor units,
   across the rate, into USD cents, rounded once). IT MUST NEVER BE
   DISPLAYED. Showing it would restate lira somebody handed over as dollars
   they never did, at a rate that has since moved. The temptation will be
   strong; the answer is no.

   visits / last_purchase_at are derived, not stored. A stored total is a
   second source of truth for money that has to be kept in step with the
   sales table by hand, and the first time a sale is voided it stops
   agreeing. Voided sales are excluded for exactly that reason.

   The minor-unit divisor is a CASE rather than power(): node:sqlite's math
   functions are not something this schema has leaned on before, and there
   are exactly two currencies with exponents 0 and 2. fx_base is 'USD' on
   every row Sales.record writes; a row that said otherwise would be counted
   in visits but contribute nothing to the equivalent rather than a wrong
   number. */
const SELECT = `
  SELECT c.id, c.name, c.phone, c.city, c.source, c.address, c.note,
         c.loyalty_points, c.archived, c.demo, c.created_at, c.updated_at,
         COALESCE(agg.spent_syp, 0)       AS spent_syp,
         COALESCE(agg.spent_usd, 0)       AS spent_usd,
         COALESCE(agg.spent_usd_equiv, 0) AS spent_usd_equiv,
         COALESCE(agg.visits, 0)          AS visits,
         agg.last_at                      AS last_purchase_at
    FROM customers c
    LEFT JOIN (
      SELECT s.customer_id,
             SUM(CASE WHEN s.currency = 'SYP' THEN s.total ELSE 0 END) AS spent_syp,
             SUM(CASE WHEN s.currency = 'USD' THEN s.total ELSE 0 END) AS spent_usd,
             CAST(ROUND(SUM(
               CASE WHEN s.fx_base = 'USD' AND s.fx_rate > 0
                    THEN s.total * 100.0
                         / (CASE cu.minor_exp WHEN 0 THEN 1 WHEN 1 THEN 10
                                              WHEN 2 THEN 100 WHEN 3 THEN 1000 ELSE 1 END)
                         / s.fx_rate
                    ELSE 0 END
             )) AS INTEGER)                                          AS spent_usd_equiv,
             COUNT(*)  AS visits,
             MAX(s.at) AS last_at
        FROM sales s
        JOIN currencies cu ON cu.code = s.currency
       WHERE s.voided = 0 AND s.customer_id IS NOT NULL
       GROUP BY s.customer_id
    ) agg ON agg.customer_id = c.id`;

/* ---- what each customer still owes ---------------------------------------
   The arithmetic is Money.openDebts()'s — total minus the summed payments,
   positive balances only — and it is REUSED rather than restated: one rule,
   one place, one answer to "what is owed". A second SQL copy here is how a
   shop ends up with two figures for the same debt.

   This is also the only way a cashier can ever see a debt: she never
   receives /api/money, so the browser's own debt arithmetic has no payments
   to subtract and reports the whole sale as owed. */
function debtsByCustomer(customerId = null) {
  const out = new Map();
  for (const s of openDebts()) {
    if (!s.customer_id) continue;
    if (customerId !== null && s.customer_id !== customerId) continue;
    const row = out.get(s.customer_id) || { debt_syp: 0, debt_usd: 0, open_debts: 0 };
    if (s.currency === 'SYP') row.debt_syp += s.balance;
    else if (s.currency === 'USD') row.debt_usd += s.balance;
    row.open_debts += 1;
    out.set(s.customer_id, row);
  }
  return out;
}

/* ---- the sizes a customer actually buys ----------------------------------
   The drawer used to infer these from whatever sales the browser happened to
   hold — the shop's last 200 — so for anyone not recent it was empty or
   wrong. Aggregated here over every non-voided sale instead, and sent as the
   top two sizes per family so the list can filter on them.

   The family mapping is the one the drawer already used, moved into SQL so
   it exists in one language: sneakers/boots/crocs → Footwear, jeans → Jeans,
   everything else → Tops. It reads products.type, so a line whose product
   has since been purged (a LEFT JOIN miss) lands in Tops — the same answer
   the browser gave for an unknown type. */
const SIZES = `
  SELECT s.customer_id,
         CASE WHEN p.type IN ('sneakers', 'boots', 'crocs') THEN 'Footwear'
              WHEN p.type = 'jeans' THEN 'Jeans'
              ELSE 'Tops' END AS fam,
         i.size,
         SUM(i.qty) AS qty
    FROM sale_items i
    JOIN sales s ON s.id = i.sale_id
    LEFT JOIN products p ON p.id = i.product_id
   WHERE s.voided = 0 AND s.customer_id IS NOT NULL
     AND i.size IS NOT NULL AND i.size <> ''
     /*WHO*/
   GROUP BY s.customer_id, fam, i.size
   ORDER BY s.customer_id, fam, qty DESC, i.size`;

function sizesByCustomer(customerId = null) {
  const sql = SIZES.replace('/*WHO*/', customerId === null ? '' : 'AND s.customer_id = ?');
  const rows = customerId === null
    ? get().prepare(sql).all()
    : get().prepare(sql).all(customerId);

  /* Top two per (customer, family). The rows arrive ordered by qty within
     each family, so this is one pass with a counter rather than a window
     function — the same caution 010_labels.sql took about leaning on a newer
     SQLite than node:sqlite is known to ship. */
  const out = new Map();
  const kept = new Map();
  for (const r of rows) {
    const k = r.customer_id + '|' + r.fam;
    const n = kept.get(k) || 0;
    if (n >= 2) continue;
    kept.set(k, n + 1);
    if (!out.has(r.customer_id)) out.set(r.customer_id, []);
    out.get(r.customer_id).push({ fam: r.fam, size: r.size, qty: r.qty });
  }
  return out;
}

/* ---- how often this person actually comes in -----------------------------
   customer.at_risk_days is one number for the whole shop, and it is wrong in
   both directions: somebody who comes every 40 days and has not been seen for
   90 is late, while somebody who comes twice a year at 90 days is perfectly
   fine. So each customer gets their own rhythm — the MEDIAN gap between their
   purchases, in days.

   Median rather than mean: one order placed two years before the rest drags a
   mean far enough to make a regular look occasional, and the median does not
   move. Two purchases give one gap, which is not a rhythm — it is a
   coincidence — so this is null below three purchases and the browser falls
   back to the shop-wide number (DB.quietAfter, js/data.js).

   Computed here, not in the browser: js/data.js holds the shop's last 200
   sales, so the same customer would get a different rhythm on a machine that
   had been open longer. Sorted per customer in JS for the same reason
   sizesByCustomer does its top-two there — SQLite has no median, and window
   functions are a newer SQLite than node:sqlite is known to ship. */
function rhythmByCustomer(customerId = null) {
  const rows = get().prepare(
    `SELECT customer_id, at
       FROM sales
      WHERE voided = 0 AND customer_id IS NOT NULL
        ${customerId === null ? '' : 'AND customer_id = ?'}
      ORDER BY customer_id, at`
  ).all(...(customerId === null ? [] : [customerId]));

  const gaps = new Map();
  let prevId = null, prevAt = 0;
  for (const r of rows) {
    const at = Date.parse(r.at);
    if (!Number.isFinite(at)) continue;
    if (r.customer_id === prevId) {
      const days = (at - prevAt) / 86400000;
      /* Two sales in one visit are one visit, not a gap of zero. */
      if (days >= 0.5) {
        if (!gaps.has(r.customer_id)) gaps.set(r.customer_id, []);
        gaps.get(r.customer_id).push(days);
      }
    }
    prevId = r.customer_id;
    prevAt = at;
  }

  const out = new Map();
  for (const [id, list] of gaps) {
    if (list.length < 2) continue;              /* fewer than three purchases */
    list.sort((a, b) => a - b);
    const mid = list.length >> 1;
    const median = list.length % 2
      ? list[mid]
      : (list[mid - 1] + list[mid]) / 2;
    out.set(id, Math.round(median));
  }
  return out;
}

function decorate(row, debts, sizes, rhythm) {
  const d = debts.get(row.id) || { debt_syp: 0, debt_usd: 0, open_debts: 0 };
  return {
    ...row,
    debt_syp: d.debt_syp,
    debt_usd: d.debt_usd,
    open_debts: d.open_debts,
    sizes: sizes.get(row.id) || [],
    /* null means "not enough history to say" — never 0, which would read as
       "comes in every day". */
    median_gap_days: rhythm.get(row.id) ?? null
  };
}

/* ---- the delivery driver -------------------------------------------------
   A driver holds customer.read — he has to, or he cannot see who he is
   delivering to — and that used to hand him the WHOLE customer table with
   spend and debt on every row, on a phone, out on a run. The shop's debt book
   is not something a driver carries around.

   Scoped by ROLE, not by permission, and in the SQL rather than by filtering
   afterwards: the same rule and the same reasoning as scope() in
   server/lib/deliveries.js. Giving a manager customer.read should show him the
   shop; giving a second driver the same permission must not show him the first
   driver's round.

   Two narrowings, both deliberate:
     - only customers on a run he is actually carrying (waiting or out), and
     - no money at all. Not scrubbed from the row afterwards — never selected,
       so there is no debt arithmetic to leak and nothing to forget to strip.
   He gets who they are and how to reach them, which is the job. */
function driverScope(user) {
  return user && user.role === 'delivery' ? user.id : null;
}

const ON_MY_RUN = `
  c.id IN (SELECT s.customer_id
             FROM deliveries d
             JOIN sales s ON s.id = d.sale_id
            WHERE d.driver_id = ?
              AND d.status IN ('waiting', 'out')
              AND s.customer_id IS NOT NULL)`;

const DRIVER_SELECT = `
  SELECT c.id, c.name, c.phone, c.city, c.source, c.address,
         c.archived, c.created_at, c.updated_at
    FROM customers c`;

export function list(user, { includeArchived = false } = {}) {
  const mine = driverScope(user);
  if (mine !== null) {
    /* Archived customers are included: somebody archived after the parcel was
       assigned still has to receive it. */
    return get().prepare(
      `${DRIVER_SELECT} WHERE ${ON_MY_RUN} ORDER BY c.name`
    ).all(mine);
  }

  const rows = get().prepare(
    `${SELECT} ${includeArchived ? '' : 'WHERE c.archived = 0'} ORDER BY c.name`
  ).all();
  const debts = debtsByCustomer();
  const sizes = sizesByCustomer();
  const rhythm = rhythmByCustomer();
  return rows.map((r) => decorate(r, debts, sizes, rhythm));
}

/* null for "not yours", which the routes turn into 404 rather than 403 — the
   same rule deliveries.js follows, so a driver cannot learn that a customer
   exists by telling the two answers apart. */
export function byId(id, user) {
  const mine = driverScope(user);
  if (mine !== null) {
    return get().prepare(
      `${DRIVER_SELECT} WHERE c.id = ? AND ${ON_MY_RUN}`
    ).get(id, mine) || null;
  }

  const row = get().prepare(`${SELECT} WHERE c.id = ?`).get(id);
  if (!row) return null;
  return decorate(row, debtsByCustomer(id), sizesByCustomer(id), rhythmByCustomer(id));
}

/* The invoices, newest first, WITH their lines. Loaded per customer rather
   than joined into the list above — forty customers with a hundred sales
   each is a lot of rows to build a screen that shows one of them.

   unit_cost is selected on purpose. The route runs every row through
   scrubCost, which strips it — from the header and from every nested item —
   for anyone without cost.read. That call is what decides, and it is
   load-bearing from the moment this function started carrying lines. */
export function historyFor(id, limit = 200) {
  const d = get();
  const n = Math.max(1, Math.min(1000, Math.floor(Number(limit)) || 200));

  const sales = d.prepare(
    `SELECT id, at, total, currency, payment, voided,
            fx_rate, points_earned, points_used, discount
       FROM sales
      WHERE customer_id = ?
      ORDER BY at DESC, id DESC
      LIMIT ?`
  ).all(id, n);

  if (!sales.length) return sales;

  const bySale = new Map(sales.map((s) => [s.id, s]));
  for (const s of sales) s.items = [];

  const marks = sales.map(() => '?').join(',');
  const items = d.prepare(
    `SELECT sale_id, sku, name, size, qty, unit_price, unit_cost, product_id
       FROM sale_items
      WHERE sale_id IN (${marks})
      ORDER BY id`
  ).all(...sales.map((s) => s.id));

  for (const it of items) bySale.get(it.sale_id)?.items.push(it);
  return sales;
}

/* The parcels, for the profile's timeline. Reached through the sale, because
   that is the only link a delivery has to a person — deliveries carry their
   own typed address, not a customer_id (recon §C7).

   Gated on delivery.read at the route: a cashier's timeline simply has no
   delivery rows in it rather than being told there are some she cannot see. */
export function deliveriesFor(id, limit = 100) {
  const n = Math.max(1, Math.min(500, Math.floor(Number(limit)) || 100));
  return get().prepare(
    `SELECT d.id, d.sale_id, d.status, d.address, d.assigned_at, d.out_at,
            d.closed_at, d.fail_reason, u.name AS driver_name
       FROM deliveries d
       JOIN sales s ON s.id = d.sale_id
       LEFT JOIN users u ON u.id = d.driver_id
      WHERE s.customer_id = ?
      ORDER BY d.assigned_at DESC
      LIMIT ?`
  ).all(id, n);
}

/* ------------------------------------------------------------------ writing */

const FIELDS = ['name', 'phone', 'city', 'source', 'address', 'note'];

function clean(fields) {
  const out = {};
  for (const k of FIELDS) {
    if (fields[k] === undefined) continue;
    const v = fields[k];
    out[k] = (v === null || v === '') ? null : String(v).trim();
  }
  return out;
}

/* Whoever already holds this number, or null.

   A pass over the rows rather than a WHERE, because the normalised form is
   arithmetic on the stored string and there is deliberately no phone_norm
   column to index (028's header says why). Archived holders are included —
   the owner's call: re-adding somebody who was archived should still warn,
   with the warning saying they are archived, because the right move is
   usually to bring the old record (and its history) back rather than start
   a second one. Live holders are checked first, so when a live and an
   archived customer share the number the warning names the live one. */
function phoneHolder(d, phone, exceptId) {
  const want = normPhone(phone);
  if (!want) return null;
  const rows = d.prepare(
    `SELECT id, name, phone, archived FROM customers
      WHERE phone IS NOT NULL AND phone <> ''
      ORDER BY archived, id`
  ).all();
  for (const r of rows) {
    if (r.id === exceptId) continue;
    if (normPhone(r.phone) === want) {
      return { id: r.id, name: r.name, archived: !!r.archived };
    }
  }
  return null;
}

/* A duplicate phone is a WARNING, not a refusal, and — since Stage C — not an
   error either. Two people genuinely share a number (a household, a shop
   landline), so the row is written and the caller is told; but the same
   person typed once in Arabic and once in Latin is the commoner case, and
   somebody has to be told.

   This used to write the row, commit, and then THROW, which the route turned
   into a 409. That was wrong: 409 says the request did not happen, so a retry
   layer — or any future client reading the status rather than the body —
   would send it again and make a second duplicate. The creation succeeded, so
   it answers 200, and the warning rides along beside the customer. */
export function create(fields, userId, { demo = false } = {}) {
  const f = clean(fields);
  if (!f.name) throw new Error('a customer needs a name');

  let taken = null;
  const made = tx((d) => {
    taken = f.phone ? phoneHolder(d, f.phone, null) : null;

    const at = nowIso();
    const info = d.prepare(
      `INSERT INTO customers
         (name, phone, city, source, address, note, loyalty_points,
          archived, demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
    ).run(f.name, f.phone ?? null, f.city ?? null, f.source ?? 'in-store',
          f.address ?? null, f.note ?? null, demo ? 1 : 0, at, at);

    const id = Number(info.lastInsertRowid);
    logChange('customers', id, 'insert', userId, null);
    return byId(id);
  });

  return {
    customer: made,
    /* null when there is nothing to say. The browser composes its own wording
       from I18N — this message is for anything that is not the browser. */
    warning: taken ? {
      code: 'phone_taken',
      message: `That number already belongs to ${taken.name} (#${taken.id}` +
               `${taken.archived ? ', archived' : ''}). ${made.name} was saved anyway.`,
      existing: taken
    } : null
  };
}

/* Same shape as create(): { customer, warning }.

   A phone CHANGE deserves the duplicate warning as much as a phone being
   typed for the first time — arguably more, since correcting a number is
   exactly when somebody merges two records by accident. phoneHolder has taken
   an exceptId since Stage A for precisely this and nobody had ever passed it,
   because until Stage C there was no way to edit a customer at all. */
export function update(id, fields, userId) {
  const f = clean(fields);

  /* `archived` is not in FIELDS because it is a flag, not text, and letting it
     through the same path would make an empty string archive somebody. */
  if (fields.archived !== undefined) f.archived = fields.archived ? 1 : 0;

  const keys = Object.keys(f);
  if (!keys.length) throw new Error('nothing to update');
  if (f.name === null) throw new Error('a customer needs a name');

  let taken = null;
  const row = tx((d) => {
    /* Only when the number actually moved. Re-saving a customer without
       touching the phone must not warn about the person themselves. */
    if (f.phone !== undefined) {
      const before = d.prepare('SELECT phone FROM customers WHERE id = ?').get(id);
      if (before && normPhone(before.phone) !== normPhone(f.phone)) {
        taken = phoneHolder(d, f.phone, id);
      }
    }

    const args = keys.map(k => f[k]);
    args.push(nowIso(), id);

    const info = d.prepare(
      `UPDATE customers SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ?
        WHERE id = ?`
    ).run(...args);

    if (info.changes === 0) throw new Error('no such customer');
    logChange('customers', id, 'update', userId, null);
    return byId(id);
  });

  return {
    customer: row,
    warning: taken ? {
      code: 'phone_taken',
      message: `That number already belongs to ${taken.name} (#${taken.id}` +
               `${taken.archived ? ', archived' : ''}).`,
      existing: taken
    } : null
  };
}

export function archive(id, userId) {
  return update(id, { archived: 1 }, userId).customer;
}

/* A manager moving someone's balance by hand.

   Separate from the sale path on purpose. The reason is written into the
   movement so that a balance which does not match the customer's purchases can
   still be explained a year later — "+250, goodwill, by Hussam" is an answer;
   a number that changed on its own is not.

   Refuses to take a balance negative rather than clamping, because a clamp
   quietly turns "take 500 off" into "take 300 off" and nobody is told. */
export function adjustPoints(id, delta, { reason, userId }) {
  const n = Math.round(Number(delta) || 0);
  if (!n) throw new Error('the adjustment is zero');

  return tx((d) => {
    const row = d.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(id);
    if (!row) throw new Error('no such customer');

    const after = row.loyalty_points + n;
    if (after < 0) {
      const e = new Error(
        `That would leave ${after} points. They have ${row.loyalty_points}.`);
      e.code = 'not_enough_points';
      throw e;
    }

    d.prepare('UPDATE customers SET loyalty_points = ?, updated_at = ? WHERE id = ?')
     .run(after, nowIso(), id);

    logChange('customers', id, 'update', userId,
              `points ${n > 0 ? '+' : ''}${n}${reason ? ': ' + reason : ''}`);

    return { id, before: row.loyalty_points, after, delta: n };
  });
}
