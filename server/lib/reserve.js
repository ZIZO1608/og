/* ==========================================================================
   OG SYSTEM — the deposit (عربون): reservations at the till, and the deposit a
   website order needs (migration 078, night shift 28 Oct 2026)
   --------------------------------------------------------------------------
   A RESERVATION IS A PICKUP ORDER PAID BY DEPOSIT (lib/orders.js) plus one
   row in `reservations`. Everything that touches stock and money is the
   order's, done the way the delivery office does it:

     - the pieces leave stock with the sale, so they cannot be sold to anyone
       else and are not "in stock" on the till or the website (held);
     - the deposit is an order payment with an opId — cash goes into the
       drawer when it is paid; a retry cannot take it twice;
     - what is still owed is derived (Orders.money), never stored;
     - collecting is Orders.pay for the rest, then the pickup marked
       delivered (Deliveries.update);
     - releasing is Orders.takeBack: the pieces back on the shelf through the
       movement log, and the deposit as store credit (the customer_credit
       ledger — no cash moves) or, the manager's choice, refunded.

   The reservation's own STATUS IS DERIVED, never stored: released when the
   order was taken back (or the sale cancelled), collected when the pickup is
   delivered, held otherwise — and expired when held past hold_until. So a
   half-finished collect (paid, not yet marked) can simply be finished again.

   Who may do what (existing permission names, server/lib/auth.js):
     sell                — take a reservation, collect it, extend it;
     discount.unlimited  — agree a smaller deposit with one customer (owner,
                           manager: a smaller deposit is a concession, like a
                           discount past the limit);
     void                — release one (manager: "the manager confirms");
     void + money.move   — release it as a REFUND rather than credit.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';
import * as Orders from './orders.js';
import * as Deliveries from './deliveries.js';

function fail(message, code, status = 400, extra) {
  return Object.assign(new Error(message), { code, status }, extra || {});
}

function cfgNum(d, key, fallback) {
  const r = d.prepare('SELECT value FROM config WHERE key = ?').get(key);
  const n = r ? Number(r.value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
export function settings(d = get()) {
  return {
    tillPct: cfgNum(d, 'deposit.till_pct', 50),
    onlinePct: cfgNum(d, 'deposit.online_pct', 50),
    holdDays: cfgNum(d, 'deposit.hold_days', 7),
    chaseDays: cfgNum(d, 'deposit.chase_days', 3)
  };
}

/* The least a deposit may be: `pct` of the total, rounded UP to the minor
   unit (half of 4,701 lira is 2,351, never 2,350). */
export function minFor(total, pct) {
  return Math.ceil((Number(total) || 0) * Math.max(0, Math.min(100, pct)) / 100);
}

function daysFrom(iso, days) {
  return new Date(new Date(iso).getTime() + days * 86400000).toISOString();
}

/* ---------------------------------------------------------------- take one */

/* `deposit` is { amount, currency, method, txnRef } — what the customer paid
   now. `agreed` (minor units of the sale's currency) is a smaller minimum
   the owner or the manager agreed with this customer; it needs `canAgree`. */
export function create({
  lines, whId, customerId, currency = null, discount = 0, couponCode = null,
  deposit, agreed = null, canAgree = false, opId = null
}, user) {
  if (!customerId) throw fail('A reservation needs a customer — attach them to the sale first.', 'needs_customer');
  if (!deposit || !(Number(deposit.amount) > 0)) throw fail('Take the deposit first.', 'deposit_missing');
  if (agreed !== null && agreed !== undefined && agreed !== '') {
    if (!canAgree) throw fail('Only the owner or the manager can agree a different deposit.', 'forbidden', 403);
    if (!(Number.isInteger(Number(agreed)) && Number(agreed) >= 0)) throw fail('The agreed deposit is not an amount.', 'bad_request');
  }
  const d0 = get();
  const s = settings(d0);
  const until = daysFrom(nowIso(), s.holdDays);

  return Orders.create({
    lines, whId, customerId, currency, discount, couponCode,
    method: 'pickup', plan: 'deposit', channel: 'other',
    note: 'reservation', payments: [{ amount: deposit.amount, currency: deposit.currency, method: deposit.method, txnRef: deposit.txnRef }],
    userId: user.id, opId,
    within: (d, result) => {
      const m = result.money;
      const byHand = agreed !== null && agreed !== undefined && agreed !== '';
      const min = byHand ? Math.min(Number(agreed), m.due) : minFor(m.due, s.tillPct);
      if (m.paid < min) {
        throw fail(`The deposit has to be at least ${min} ${m.currency} (${byHand ? 'agreed' : s.tillPct + '%'}).`,
                   'deposit_too_small', 400, { min, currency: m.currency, pct: byHand ? null : s.tillPct });
      }
      const at = nowIso();
      d.prepare(
        `INSERT INTO reservations (sale_id, customer_id, hold_until, deposit_min, deposit_pct, min_by,
                                   extended, created_at, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).run(result.sale.id, customerId, until, min, byHand ? null : s.tillPct, byHand ? user.id : null,
            at, user.id, at);
      logChange('reservations', result.sale.id, 'insert', user.id, `held until ${until.slice(0, 10)}`);
      return { saleId: result.sale.id, holdUntil: until, depositMin: min, depositPct: byHand ? null : s.tillPct };
    }
  });
}

/* ------------------------------------------------------------- read them */

const STATUS_SQL = `CASE
    WHEN s.voided = 1 OR EXISTS (SELECT 1 FROM order_returns x WHERE x.sale_id = r.sale_id) THEN 'released'
    WHEN dl.status = 'delivered' THEN 'collected'
    ELSE 'held' END`;

function shape(d, r) {
  const m = Orders.money(d, r.sale_id) || { due: 0, paid: 0, remaining: 0, currency: r.currency };
  const lines = d.prepare(
    `SELECT sku, name, size, qty, colour, colour_ar, product_id FROM sale_items
      WHERE sale_id = ? AND sku NOT LIKE 'SVC-%' ORDER BY id`).all(r.sale_id);
  const ret = d.prepare(
    'SELECT outcome, credit_minor, refund_minor, at FROM order_returns WHERE sale_id = ? ORDER BY id DESC LIMIT 1').get(r.sale_id);
  return {
    saleId: r.sale_id, status: r.status,
    expired: r.status === 'held' && r.hold_until < nowIso(),
    holdUntil: r.hold_until, extended: r.extended,
    customerId: r.customer_id, customer: r.customer_name || null, phone: r.phone || null,
    at: r.at, total: m.due, paid: m.paid, remaining: m.remaining, currency: m.currency,
    depositMin: r.deposit_min, depositPct: r.deposit_pct, agreedBy: r.min_by ? (r.min_by_name || null) : null,
    deliveryId: r.delivery_id,
    lines: lines.map((l) => ({ sku: l.sku, name: l.name, size: l.size, qty: l.qty, colour: l.colour, colourAr: l.colour_ar, productId: l.product_id })),
    released: ret ? { how: ret.outcome === 'refund' ? 'refund' : 'credit', credit: ret.credit_minor, refund: ret.refund_minor, at: ret.at } : null
  };
}

const BASE = `SELECT r.*, s.at, s.currency, s.customer_name, s.voided, c.phone, dl.id AS delivery_id,
                     u.name AS min_by_name, ${STATUS_SQL} AS status
                FROM reservations r
                JOIN sales s ON s.id = r.sale_id
                LEFT JOIN customers c ON c.id = r.customer_id
                LEFT JOIN deliveries dl ON dl.sale_id = r.sale_id
                LEFT JOIN users u ON u.id = r.min_by`;

export function list({ status = 'held', limit = 100 } = {}) {
  const d = get();
  const n = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const want = ['held', 'collected', 'released', 'all'].includes(status) ? status : 'held';
  const rows = d.prepare(`SELECT * FROM (${BASE}) WHERE ? = 'all' OR status = ? ORDER BY hold_until ASC LIMIT ?`).all(want, want, n);
  return rows.map((r) => shape(d, r));
}

export function byId(saleId, d = get()) {
  const r = d.prepare(`${BASE} WHERE r.sale_id = ?`).get(String(saleId));
  return r ? shape(d, r) : null;
}

/* What is held, per SKU — the catalogue bundle carries it, so Products and
   the warehouse can say "2 held for Nour until 3 Nov". */
export function heldBySku() {
  const out = {};
  try {
    const rows = get().prepare(
      `SELECT i.sku, SUM(i.qty) AS qty, r.sale_id, r.hold_until, s.customer_name
         FROM reservations r
         JOIN sales s ON s.id = r.sale_id
         JOIN sale_items i ON i.sale_id = r.sale_id AND i.sku NOT LIKE 'SVC-%'
         LEFT JOIN deliveries dl ON dl.sale_id = r.sale_id
        WHERE s.voided = 0 AND COALESCE(dl.status, 'waiting') = 'waiting'
          AND NOT EXISTS (SELECT 1 FROM order_returns x WHERE x.sale_id = r.sale_id)
        GROUP BY i.sku, r.sale_id`).all();
    for (const r of rows) (out[r.sku] ??= []).push({ saleId: r.sale_id, qty: r.qty, until: r.hold_until, customer: r.customer_name || null });
  } catch { /* before 078 */ }
  return out;
}

function held(saleId) {
  const r = byId(saleId);
  if (!r) throw fail('No such reservation.', 'not_found', 404);
  if (r.status !== 'held') throw fail(`This reservation is already ${r.status}.`, 'not_held', 409, { status: r.status });
  return r;
}

/* ---------------------------------------------- collect, extend, release */

/* The customer is back: take the rest (all of it — the goods leave only
   paid for), then the pickup is delivered. `payment` may be null when
   nothing is owed (a deposit that covered it all, or a collect whose second
   half did not land the first time). */
export function collect(saleId, { payment = null, opId = null } = {}, user) {
  const r = held(saleId);
  if (r.remaining > 0) {
    if (!payment || !(Number(payment.amount) > 0)) {
      throw fail(`${r.remaining} ${r.currency} is still owed — take the rest first.`, 'rest_owed', 400, { remaining: r.remaining, currency: r.currency });
    }
    const inOrder = Orders.convertAt(Math.round(Number(payment.amount)), payment.currency || r.currency, r.currency);
    if (inOrder < r.remaining) {
      throw fail(`Take all of the rest: ${r.remaining} ${r.currency}.`, 'rest_short', 400, { remaining: r.remaining, currency: r.currency });
    }
    Orders.pay(r.saleId, { amount: payment.amount, currency: payment.currency || r.currency, method: payment.method,
                           txnRef: payment.txnRef, stage: 'rest', note: 'reservation collected', opId }, user);
  }
  Deliveries.update(r.deliveryId, { status: 'delivered' }, user);
  return byId(r.saleId);
}

/* Held for longer: hold_days more, from today or from the date it was held
   until, whichever is later. */
export function extend(saleId, user) {
  const r = held(saleId);
  return tx((d) => {
    const s = settings(d);
    const from = r.holdUntil > nowIso() ? r.holdUntil : nowIso();
    const until = daysFrom(from, s.holdDays);
    d.prepare('UPDATE reservations SET hold_until = ?, extended = extended + 1, updated_at = ? WHERE sale_id = ?')
     .run(until, nowIso(), r.saleId);
    logChange('reservations', r.saleId, 'update', user.id, `held until ${until.slice(0, 10)}`);
    return byId(r.saleId, d);
  });
}

/* Never collected: the pieces back on sale, the deposit as store credit (or
   refunded — the manager's choice). Every piece still on the order comes
   back; nothing is kept. */
export function release(saleId, { how = 'credit', method = 'cash', opId = null } = {}, user) {
  const r = held(saleId);
  if (!['credit', 'refund'].includes(how)) throw fail('Credit or a refund.', 'bad_request');
  const lines = Orders.returnable(r.saleId).filter((l) => l.left > 0).map((l) => ({ sku: l.sku, qty: l.left }));
  if (!lines.length) throw fail('Nothing is left on this reservation.', 'not_held', 409);
  Orders.takeBack(r.saleId, {
    outcome: how === 'refund' ? 'refund' : 'credit', lines, reason: 'reservation not collected',
    method, opId
  }, user);
  return byId(r.saleId);
}

/* ------------------------------------------------- website orders (078) */

/* The deposit one website order needs: the admin's figure for it, or the
   default percentage. `amount` is minor units of `currency`. */
export function webDeposit(row, d = get()) {
  const s = settings(d);
  const set = row.deposit_pct !== null && row.deposit_pct !== undefined || row.deposit_amount !== null && row.deposit_amount !== undefined;
  const out = {
    pct: row.deposit_pct ?? (row.deposit_amount != null ? null : s.onlinePct),
    amount: row.deposit_amount ?? null,
    currency: row.deposit_amount != null ? (row.deposit_currency || null) : null,
    source: set ? 'set' : 'default',
    setAt: row.deposit_at || null
  };
  if (row.sale_id) {
    const m = Orders.money(d, row.sale_id);
    if (m) out.order = { total: m.due, paid: m.paid, remaining: m.remaining, currency: m.currency };
  }
  return out;
}

export function setWebDeposit(ref, { pct = null, amount = null, currency = null } = {}, user) {
  return tx((d) => {
    const row = d.prepare('SELECT * FROM web_orders WHERE ref = ?').get(String(ref));
    if (!row) throw fail('No such website order.', 'not_found', 404);
    if (row.state === 'rejected') throw fail('That order was turned down.', 'decided', 409);
    const hasPct = pct !== null && pct !== undefined && pct !== '';
    const hasAmt = amount !== null && amount !== undefined && amount !== '';
    if (hasPct === hasAmt) throw fail('A percentage, or an amount — one of the two.', 'bad_request');
    let p = null, a = null, c = null;
    if (hasPct) {
      p = Number(pct);
      if (!Number.isInteger(p) || p < 0 || p > 100) throw fail('The deposit is a whole percentage from 0 to 100.', 'bad_request');
    } else {
      a = Number(amount);
      if (!Number.isInteger(a) || a < 0) throw fail('The deposit is not an amount.', 'bad_request');
      c = String(currency || '').toUpperCase();
      if (!d.prepare('SELECT 1 FROM currencies WHERE code = ?').get(c)) throw fail(`unknown currency: ${c}`, 'bad_currency');
    }
    d.prepare(`UPDATE web_orders SET deposit_pct = ?, deposit_amount = ?, deposit_currency = ?, deposit_by = ?, deposit_at = ?,
                                     updated_at = ? WHERE ref = ?`)
     .run(p, a, c, user.id, nowIso(), nowIso(), row.ref);
    return webDeposit(d.prepare('SELECT * FROM web_orders WHERE ref = ?').get(row.ref), d);
  });
}

/* ------------------------------------------------------------ the bell */

/* For lib/alerts.js: reservations ending within a day, expired ones, and
   accepted website orders whose deposit came in but the rest has not, past
   deposit.chase_days. Computed, never stored. */
export function alertsData({ wantWeb = false } = {}) {
  const d = get();
  const now = nowIso();
  const soon = new Date(Date.now() + 86400000).toISOString();
  let ending = [], expired = [], chase = [];
  try {
    const held = d.prepare(`SELECT * FROM (${BASE}) WHERE status = 'held' ORDER BY hold_until ASC LIMIT 60`).all();
    expired = held.filter((r) => r.hold_until < now);
    ending = held.filter((r) => r.hold_until >= now && r.hold_until <= soon);
  } catch { /* before 078 */ }
  if (wantWeb) {
    const days = settings(d).chaseDays;
    const before = new Date(Date.now() - days * 86400000).toISOString();
    const rows = d.prepare(
      `SELECT dl.sale_id, s.at, s.customer_name FROM deliveries dl JOIN sales s ON s.id = dl.sale_id
        WHERE dl.channel = 'web' AND s.voided = 0 AND dl.status IN ('waiting', 'out')
          AND s.at < ? ORDER BY s.at ASC LIMIT 40`).all(before);
    for (const r of rows) {
      const m = Orders.money(d, r.sale_id);
      if (m && m.paid > 0 && m.remaining > 0) {
        chase.push({ saleId: r.sale_id, at: r.at, customer: r.customer_name, remaining: m.remaining, currency: m.currency,
                     days: Math.floor((Date.now() - new Date(r.at).getTime()) / 86400000) });
      }
    }
  }
  return { ending, expired, chase };
}
