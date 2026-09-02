/* ============================================================================
   THE DRAWER                                                     [money.js]
   ----------------------------------------------------------------------------
   Shifts, expenses, and customers paying down what they owe.

   All three used to live in the browser. A shift opened, expenses were
   recorded against it, somebody settled a debt across the counter — and a
   refresh threw the lot away. The debt repayment is the one that mattered:
   real cash from a real person, written down nowhere.

   They are one module because they are one arithmetic. A shift's expected
   figure is the drawer's takings, PLUS what was collected against old debts
   during it, MINUS the cash paid out of it. Split across three files and that
   sum has to live in whichever one imports the other two.

   THREE GUARDS, ALL INSIDE THE TRANSACTION
   ----------------------------------------
   Money in is the one direction that cannot be corrected by doing it again,
   so paying a debt carries all three:

     1. Idempotent on the caller's opId, through the same applied_ops table a
        sale uses. A manager taps Save, the wifi stalls, they tap again — and
        a customer's debt must not clear twice on one payment.

     2. The balance is recomputed here, not trusted from the browser. Two
        devices settling the same debt both pass a check made on screen.

     3. A voided sale takes no payments, and a sale with payments cannot be
        voided. Otherwise half a settled debt vanishes from every report while
        the cash is still in the box.
   ========================================================================== */

import * as DB from './db.js';

const nowIso = () => new Date().toISOString();
const fail = (msg, code) => Object.assign(new Error(msg), { code });

function cfg(d, key, fallback) {
  const r = d.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return r ? r.value : fallback;
}

/* Every amount in this module is in the shop's base currency. Mixing them
   would make the drawer figure silently wrong rather than visibly wrong. */
function checkCurrency(d, currency) {
  const base = cfg(d, 'shop.base_currency', 'SYP');
  if (currency && currency !== base) {
    throw fail(`this shop counts in ${base}, not ${currency}`, 'bad_currency');
  }
  return base;
}

function nextId(d, table, prefix, width) {
  const top = d.prepare(
    `SELECT MAX(CAST(SUBSTR(id, ${prefix.length + 1}) AS INTEGER)) AS m
       FROM ${table} WHERE id GLOB '${prefix}[0-9]*'`
  ).get().m;
  return prefix + String((top || 0) + 1).padStart(width, '0');
}

/* ---------------------------------------------------------------- shifts */

export function currentShift(d = DB.get()) {
  return d.prepare('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1')
    .get() || null;
}

export function shifts({ limit = 60 } = {}) {
  const d = DB.get();
  return d.prepare('SELECT * FROM shifts ORDER BY opened_at DESC LIMIT ?').all(limit)
    .map((s) => ({ ...s, ...summary(d, s) }));
}

/* What the box should hold. Takings that went INTO the drawer, plus debts
   settled in cash during the shift, minus cash paid out of it, plus the float
   it started with.

   Card and transfer takings are deliberately excluded: they never touch the
   drawer, so counting them would make every honest count look short.

   ONE CURRENCY — the shift's. Every sum below is filtered to `s.currency`,
   because a sale can settle in dollars (Sales.record takes a currency; the
   till never sends one, but the API does not refuse it) and this used to add
   a $100 cash sale to a lira drawer as 100. A dollar note in the box is a
   real thing, but it is not 100 lira, and it is not what the cashier is asked
   to count against `expected`. Nothing already frozen changes: every till
   sale to date settled in the base currency. */
function summary(d, s) {
  const drawer = "('cash','cod')";
  const sales = d.prepare(
    `SELECT COALESCE(SUM(total), 0) AS n FROM sales
      WHERE shift_id = ? AND voided = 0 AND payment IN ${drawer} AND currency = ?`
  ).get(s.id, s.currency).n;
  const collected = d.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS n FROM debt_payments
      WHERE shift_id = ? AND method IN ${drawer} AND currency = ?`
  ).get(s.id, s.currency).n;
  const paidOut = d.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS n FROM expenses
      WHERE shift_id = ? AND method IN ${drawer} AND currency = ?`
  ).get(s.id, s.currency).n;

  const expected = s.float_amount + sales + collected - paidOut;
  return {
    sales, collected, paidOut,
    /* A closed shift keeps the figure it was signed off against. Recomputing
       it would let a void a week later rewrite last Tuesday's variance. */
    expected: s.closed_at ? s.expected : expected,
    diff: s.closed_at && s.counted != null ? s.counted - s.expected : null,
    closed: !!s.closed_at
  };
}

export function shift(id) {
  const d = DB.get();
  const s = d.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
  return s ? { ...s, ...summary(d, s) } : null;
}

export function openShift({ float = 0, whId = null, userId = null, userName = null }) {
  return DB.tx(() => {
    const d = DB.get();
    /* Race-free because DB.tx uses BEGIN IMMEDIATE: the write lock is held
       for this whole body, so a check-then-insert cannot interleave. It was
       checked in the browser before, which two devices defeat trivially.

       Not a UNIQUE index: NULLs are distinct in SQLite, so a unique
       constraint on closed_at would permit any number of open shifts. Worth
       saying so, or somebody will helpfully add one. */
    if (currentShift(d)) throw fail('a shift is already open', 'already_open');

    const base = checkCurrency(d, null);
    const id = nextId(d, 'shifts', 'SH-', 4);
    d.prepare(
      `INSERT INTO shifts (id, user_id, user_name, wh_id, currency, float_amount,
                           opened_at, created_by)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, userId, userName, whId, base, Math.max(0, Math.round(float)), nowIso(), userId);

    DB.logChange('shifts', id, 'insert', userId, null);
    return shift(id);
  });
}

export function closeShift(id, counted, userId = null) {
  if (!Number.isFinite(Number(counted))) throw fail('count the drawer first', 'bad_request');
  return DB.tx(() => {
    const d = DB.get();
    const s = d.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
    if (!s) throw fail('no such shift', 'not_found');
    if (s.closed_at) throw fail('that shift is already closed', 'already_closed');

    /* Computed here, never taken from the request. A till that can name its
       own expected figure can close a short drawer as exact. */
    const { expected } = summary(d, s);
    d.prepare('UPDATE shifts SET closed_at = ?, counted = ?, expected = ? WHERE id = ?')
      .run(nowIso(), Math.round(counted), expected, id);

    DB.logChange('shifts', id, 'update', userId, null);
    return shift(id);
  });
}

/* -------------------------------------------------------------- expenses */

export function expenses({ from = null, to = null, limit = 200 } = {}) {
  const d = DB.get();
  if (from && to) {
    return d.prepare('SELECT * FROM expenses WHERE at >= ? AND at < ? ORDER BY at DESC LIMIT ?')
      .all(from, to, limit);
  }
  return d.prepare('SELECT * FROM expenses ORDER BY at DESC LIMIT ?').all(limit);
}

export function categories(d = DB.get()) {
  return String(cfg(d, 'expense.categories', 'other')).split(',')
    .map((s) => s.trim()).filter(Boolean);
}

export function addExpense({ category, amount, method = 'cash', note = null,
                             at = null, currency = null, userId = null }) {
  if (!(amount > 0)) throw fail('an expense has to be more than nothing', 'bad_request');
  if (!category) throw fail('an expense needs a category', 'bad_request');

  return DB.tx(() => {
    const d = DB.get();
    const base = checkCurrency(d, currency);
    if (!categories(d).includes(category)) {
      throw fail(`there is no '${category}' category`, 'bad_category');
    }

    const id = nextId(d, 'expenses', 'EX-', 4);
    const open = currentShift(d);
    d.prepare(
      `INSERT INTO expenses (id, at, category, amount, currency, method, note,
                             shift_id, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(id, at || nowIso(), category, Math.round(amount), base, method, note,
          /* Stamped, not matched by time — so cash paid out of THIS drawer
             comes out of this drawer's count and no other. */
          open ? open.id : null, nowIso(), userId);

    DB.logChange('expenses', id, 'insert', userId, null);
    return d.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  });
}

/* ---------------------------------------------------------------- debts */

/* Every credit sale still carrying a balance — regardless of how far back it
   goes. The screens read the debt book out of the recent-sales list, which is
   capped; a debt that ages past the cap would silently stop being owed. */
export function openDebts() {
  const d = DB.get();
  return d.prepare(
    `SELECT s.*, COALESCE((SELECT SUM(amount) FROM debt_payments p
                            WHERE p.sale_id = s.id), 0) AS paid
       FROM sales s
      WHERE s.payment = 'credit' AND s.voided = 0
      ORDER BY s.created_at DESC`
  ).all().map((s) => ({ ...s, balance: s.total - s.paid })).filter((s) => s.balance > 0);
}

/* One customer's open debts, oldest first, each with what it was worth THEN
   and what it is worth NOW.

   The shop freezes an exchange rate onto every sale, so it can answer this —
   and refusing to would be a quiet lie. "Took 500,000 in March" is a
   different sentence from "took $38 in March, which is $34 today", and the
   second one is what the owner is actually deciding about.

   `thenUsd` uses the sale's own frozen fx_rate. `nowUsd` uses the current
   one. Both are cents, and both are only ever shown BESIDE the real figure
   in the currency the customer actually owes — never instead of it.

   Oldest first because that is the order they get chased in. */
export function debtsForCustomer(customerId) {
  const d = DB.get();
  const now = d.prepare(
    `SELECT rate FROM fx_rates WHERE base = 'USD' AND quote = 'SYP'
      ORDER BY set_at DESC, id DESC LIMIT 1`).get();
  const nowRate = now ? now.rate : null;

  const rows = d.prepare(
    `SELECT s.id, s.at, s.total, s.currency, s.fx_rate, s.fx_base,
            COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.sale_id = s.id), 0) AS paid
       FROM sales s
      WHERE s.customer_id = ? AND s.payment = 'credit' AND s.voided = 0
      ORDER BY s.at ASC`
  ).all(customerId);

  const exp = {};
  for (const c of d.prepare('SELECT code, minor_exp FROM currencies').all()) exp[c.code] = c.minor_exp;

  return rows
    .map((s) => {
      const balance = s.total - s.paid;
      const whole = balance / Math.pow(10, exp[s.currency] ?? 0);
      /* A dollar debt is already dollars; only a lira one has a rate to cross. */
      const thenUsd = s.currency === 'USD' ? Math.round(whole * 100)
        : (s.fx_rate > 0 ? Math.round(whole / s.fx_rate * 100) : null);
      const nowUsd = s.currency === 'USD' ? Math.round(whole * 100)
        : (nowRate > 0 ? Math.round(whole / nowRate * 100) : null);
      return {
        id: s.id, at: s.at, total: s.total, paid: s.paid, balance,
        currency: s.currency, fxRate: s.fx_rate,
        thenUsd, nowUsd,
        payments: d.prepare(
          `SELECT id, at, amount, currency, method, note FROM debt_payments
            WHERE sale_id = ? ORDER BY at`).all(s.id)
      };
    })
    .filter((s) => s.balance > 0);
}

export function debtPayments({ saleId = null, limit = 200 } = {}) {
  const d = DB.get();
  return saleId
    ? d.prepare('SELECT * FROM debt_payments WHERE sale_id = ? ORDER BY at').all(saleId)
    : d.prepare('SELECT * FROM debt_payments ORDER BY at DESC LIMIT ?').all(limit);
}

export function balanceOf(d, saleId) {
  const s = d.prepare('SELECT total, voided FROM sales WHERE id = ?').get(saleId);
  if (!s) throw fail('no such sale', 'not_found');
  if (s.voided) throw fail('that sale was voided', 'voided');
  const paid = d.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS n FROM debt_payments WHERE sale_id = ?'
  ).get(saleId).n;
  return Math.max(0, s.total - paid);
}

export function payDebt({ saleId, amount, method = 'cash', note = null,
                          currency = null, opId = null, userId = null }) {
  if (!(amount > 0)) throw fail('a payment has to be more than nothing', 'bad_request');

  return DB.tx(() => {
    const d = DB.get();
    const base = checkCurrency(d, currency);

    /* The same applied_ops table a sale uses. A till that loses wifi mid
       request does not know whether the payment landed; replaying the same
       opId returns what was recorded rather than taking the money twice. */
    if (opId) {
      const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
      if (seen) return JSON.parse(seen.result);
    }

    /* Recomputed inside the transaction. Checked on screen it is only a
       courtesy — two devices settling the same debt both pass that check. */
    const balance = balanceOf(d, saleId);
    if (balance <= 0) throw fail('that debt is already settled', 'already_settled');
    if (amount > balance) {
      throw fail(`only ${balance} is still owed on that sale`, 'overpaid');
    }

    const open = currentShift(d);
    const info = d.prepare(
      `INSERT INTO debt_payments (sale_id, at, amount, currency, method, shift_id, note, user_id)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(saleId, nowIso(), Math.round(amount), base, method,
          open ? open.id : null, note, userId);

    const out = {
      id: Number(info.lastInsertRowid),
      saleId, amount: Math.round(amount), method,
      balance: balance - Math.round(amount)
    };
    if (opId) {
      d.prepare('INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?,?,?,?,?)')
        .run(opId, nowIso(), userId, 'debt_payment', JSON.stringify(out));
    }

    DB.logChange('debt_payments', out.id, 'insert', userId, null);
    return out;
  });
}

/* Called by Sales.void before it voids. A credit sale the customer has
   already part-paid cannot simply be undone: the cash is in the box, and
   voiding would erase the debt it was paid against while leaving the money
   unexplained. */
export function paymentsAgainst(d, saleId) {
  return d.prepare('SELECT COUNT(*) AS n FROM debt_payments WHERE sale_id = ?').get(saleId).n;
}

/* ------------------------------------------------------------ the bundle */

export function all() {
  const d = DB.get();
  const open = currentShift(d);
  return {
    shifts: shifts({ limit: 60 }),
    currentShift: open ? shift(open.id) : null,
    expenses: expenses({ limit: 200 }),
    debtPayments: debtPayments({ limit: 200 }),
    creditSales: openDebts(),
    categories: categories(d)
  };
}
