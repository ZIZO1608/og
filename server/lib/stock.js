/* ==========================================================================
   OG SYSTEM — stock
   --------------------------------------------------------------------------
   Every change to how much of something exists goes through here, and every
   one of them writes a movement. There is no other way to alter the `stock`
   table, deliberately: the moment stock can be edited without a movement, the
   trail stops matching reality and nobody can answer "where did those four
   pairs go".

   The rule that makes multi-device safe:

     movement + running total are written in ONE transaction, and the running
     total carries CHECK (qty >= 0).

   So two tills racing for the last pair cannot both win. The loser's
   transaction fails on the constraint and rolls back — including its movement
   — rather than quietly taking stock negative. The browsers cannot see each
   other; the database can.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';

/* Movements that legitimately reduce stock, for readable errors. */
const TYPES = new Set(['received', 'sold', 'damaged', 'returned', 'transfer', 'count']);

/* Thrown when there is not enough to take. Carries the numbers so the till can
   say "only 2 left" rather than "operation failed". */
export class InsufficientStock extends Error {
  constructor(sku, whId, wanted, available) {
    super(`only ${available} of ${sku} at ${whId}, asked for ${wanted}`);
    this.name = 'InsufficientStock';
    this.code = 'insufficient_stock';
    this.sku = sku;
    this.whId = whId;
    this.wanted = wanted;
    this.available = available;
  }
}

/* ------------------------------------------------------------------ reading */

export function qtyAt(sku, whId) {
  const r = get().prepare('SELECT qty FROM stock WHERE sku = ? AND wh_id = ?')
                 .get(sku, whId);
  return r ? r.qty : 0;
}

/* Every place this size exists, as { floor: 3, store: 11 }. Mirrors the shape
   `variant.wh` already has in the browser, so the client can drop it straight
   in without reshaping. */
export function placesFor(sku) {
  const out = {};
  for (const r of get().prepare('SELECT wh_id, qty FROM stock WHERE sku = ?').all(sku)) {
    out[r.wh_id] = r.qty;
  }
  return out;
}

export function totalFor(sku) {
  const r = get().prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM stock WHERE sku = ?')
                 .get(sku);
  return r.n;
}

/* --------------------------------------------------------------- one change
   `delta` is signed: -2 sold, +10 received.

   Must be called inside a transaction the caller owns — a sale moves several
   lines and either all of them happen or none do. `apply` deliberately does
   not open its own, so it cannot be used to half-commit a basket. */
export function apply(d, { sku, whId, delta, type, note, userId, refType, refId }) {
  if (!TYPES.has(type)) throw new Error(`unknown movement type: ${type}`);
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error('delta must be a non-zero whole number');
  }

  /* The row may not exist yet — a size that has never been at this place. */
  d.prepare(
    'INSERT INTO stock (sku, wh_id, qty) VALUES (?, ?, 0) ON CONFLICT DO NOTHING'
  ).run(sku, whId);

  const before = d.prepare('SELECT qty FROM stock WHERE sku = ? AND wh_id = ?')
                  .get(sku, whId).qty;

  /* Check first so the error names real numbers. The CHECK constraint is still
     the thing that guarantees it — this is for the message, not the safety.
     Between this read and the UPDATE the transaction holds the write lock, so
     nothing can slip in between. */
  if (before + delta < 0) {
    throw new InsufficientStock(sku, whId, -delta, before);
  }

  const after = before + delta;
  d.prepare('UPDATE stock SET qty = ? WHERE sku = ? AND wh_id = ?')
   .run(after, sku, whId);

  const at = nowIso();
  const info = d.prepare(
    `INSERT INTO stock_movements
       (at, sku, wh_id, type, delta, balance, note, user_id, ref_type, ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(at, sku, whId, type, delta, after, note ?? null, userId ?? null,
        refType ?? null, refId ?? null);

  logChange('stock', `${sku}:${whId}`, 'update', userId, null);

  return { sku, whId, before, after, movementId: Number(info.lastInsertRowid) };
}

/* ------------------------------------------------------------- transactions */

/* Take stock in — a delivery, or a customer return. */
export function receive({ sku, whId, qty, note, userId, refType, refId }) {
  if (qty <= 0) throw new Error('qty must be positive');
  return tx((d) => apply(d, {
    sku, whId, delta: qty, type: 'received', note, userId, refType, refId
  }));
}

/* Move between the shop floor and the back. Both legs in one transaction, so
   stock cannot evaporate in the middle: if the destination fails, the source
   is put back. */
export function transfer({ sku, from, to, qty, note, userId }) {
  if (qty <= 0) throw new Error('qty must be positive');
  if (from === to) throw new Error('cannot transfer to the same place');

  return tx((d) => {
    const out = apply(d, {
      sku, whId: from, delta: -qty, type: 'transfer',
      note: note ?? `to ${to}`, userId, refType: 'transfer'
    });
    const into = apply(d, {
      sku, whId: to, delta: qty, type: 'transfer',
      note: note ?? `from ${from}`, userId, refType: 'transfer'
    });
    return { from: out, to: into };
  });
}

/* Write off damaged goods. */
export function writeOff({ sku, whId, qty, note, userId }) {
  if (qty <= 0) throw new Error('qty must be positive');
  return tx((d) => apply(d, {
    sku, whId, delta: -qty, type: 'damaged', note, userId
  }));
}

/* Reconcile a physical count. Records the DIFFERENCE as a movement rather than
   overwriting the number, so "we were four short in March" stays visible
   afterwards. A count that matches writes nothing at all — an audit trail full
   of zero-delta rows is noise that hides the real discrepancies. */
export function reconcile({ sku, whId, counted, note, userId }) {
  if (!Number.isInteger(counted) || counted < 0) {
    throw new Error('counted must be zero or a positive whole number');
  }

  return tx((d) => {
    d.prepare('INSERT INTO stock (sku, wh_id, qty) VALUES (?, ?, 0) ON CONFLICT DO NOTHING')
     .run(sku, whId);
    const before = d.prepare('SELECT qty FROM stock WHERE sku = ? AND wh_id = ?')
                    .get(sku, whId).qty;

    const delta = counted - before;
    if (delta === 0) return { sku, whId, before, after: before, delta: 0, movementId: null };

    return {
      ...apply(d, {
        sku, whId, delta, type: 'count',
        note: note ?? `counted ${counted}, system said ${before}`,
        userId, refType: 'count'
      }),
      delta
    };
  });
}

/* ------------------------------------------------------------------ selling
   The whole basket in one transaction. If any line is short, nothing is sold
   and nothing is written — a half-committed sale would leave the till showing
   a total for goods that were never taken out of stock.

   `lines` is [{ sku, qty }]. Returns what was taken, so the caller can build
   the sale rows against the same transaction. */
export function sellLines(d, { lines, whId, userId, saleId }) {
  const taken = [];

  /* Same sku twice in one basket must consume from the same running total,
     or two lines of 3 against a stock of 4 both pass their own check. */
  const merged = new Map();
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) {
      throw new Error(`line for ${l.sku} must have a positive whole qty`);
    }
    merged.set(l.sku, (merged.get(l.sku) ?? 0) + l.qty);
  }

  for (const [sku, qty] of merged) {
    taken.push(apply(d, {
      sku, whId, delta: -qty, type: 'sold',
      note: saleId ? `sold on ${saleId}` : 'sold',
      userId, refType: 'sale', refId: saleId
    }));
  }

  return taken;
}

/* --------------------------------------------------------------- reporting */

/* The trail for one size, newest first. */
export function movementsFor(sku, limit = 50) {
  return get().prepare(
    `SELECT m.*, u.name AS user_name
       FROM stock_movements m
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.sku = ?
      ORDER BY m.at DESC, m.id DESC
      LIMIT ?`
  ).all(sku, limit);
}

/* The whole shop's movement log, newest first — what the warehouse "Moves"
   tab shows. Joined out to the product here rather than looked up per row in
   the browser: the app renders the product name, the size and who did it on
   every line, and forty round trips to build one table is how a list that
   should be instant becomes a spinner. */
export function recent(limit = 200) {
  return get().prepare(
    `SELECT m.*, v.size, v.product_id, p.name AS product_name,
            u.name AS user_name
       FROM stock_movements m
       LEFT JOIN variants v ON v.sku = m.sku
       LEFT JOIN products p ON p.id = v.product_id
       LEFT JOIN users    u ON u.id = m.user_id
      ORDER BY m.at DESC, m.id DESC
      LIMIT ?`
  ).all(limit);
}

/* Everything at or below a threshold, worst first. Drives the reorder list. */
export function lowStock(whId, threshold) {
  return get().prepare(
    `SELECT s.sku, s.wh_id, s.qty, v.size, v.product_id, p.name, p.type
       FROM stock s
       JOIN variants v ON v.sku = s.sku
       JOIN products p ON p.id = v.product_id
      WHERE s.wh_id = ? AND s.qty <= ? AND p.hidden = 0
      ORDER BY s.qty ASC, p.name ASC`
  ).all(whId, threshold);
}

/* Prove the running totals still match the movement log.

   These cannot disagree unless something wrote to `stock` outside this module
   or the database was damaged — which is exactly why it is worth checking
   rather than assuming. Cheap enough to run after a restore, and the fastest
   way to know whether a backup is genuinely sound. */
export function audit() {
  const rows = get().prepare(
    `SELECT s.sku, s.wh_id, s.qty AS running,
            COALESCE((SELECT SUM(m.delta) FROM stock_movements m
                       WHERE m.sku = s.sku AND m.wh_id = s.wh_id), 0) AS summed
       FROM stock s`
  ).all();

  const drift = rows.filter(r => r.running !== r.summed);
  return { checked: rows.length, drift };
}
