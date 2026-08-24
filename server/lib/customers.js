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
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';

/* Everything the app needs to draw the customer list, in one query.

   totalSpent / lastPurchase / visits are DERIVED, not stored. A stored total
   is a second source of truth for money that has to be kept in step with the
   sales table by hand, and the first time a sale is voided it stops agreeing.
   Voided sales are excluded here for exactly that reason. */
const SELECT = `
  SELECT c.id, c.name, c.phone, c.city, c.source, c.address, c.note,
         c.loyalty_points, c.archived, c.demo, c.created_at, c.updated_at,
         COALESCE(agg.spent,  0) AS total_spent,
         COALESCE(agg.visits, 0) AS visits,
         agg.last_at             AS last_purchase_at
    FROM customers c
    LEFT JOIN (
      SELECT customer_id,
             SUM(total)  AS spent,
             COUNT(*)    AS visits,
             MAX(at)     AS last_at
        FROM sales
       WHERE voided = 0 AND customer_id IS NOT NULL
       GROUP BY customer_id
    ) agg ON agg.customer_id = c.id`;

export function list({ includeArchived = false } = {}) {
  return get().prepare(
    `${SELECT} ${includeArchived ? '' : 'WHERE c.archived = 0'} ORDER BY c.name`
  ).all();
}

export function byId(id) {
  return get().prepare(`${SELECT} WHERE c.id = ?`).get(id) ?? null;
}

/* The invoice ids, newest first. Loaded per customer rather than joined into
   the list above — forty customers with a hundred sales each is a lot of rows
   to build a screen that shows one of them. */
export function historyFor(id, limit = 50) {
  return get().prepare(
    `SELECT id, at, total, currency, payment, voided
       FROM sales
      WHERE customer_id = ?
      ORDER BY at DESC, id DESC
      LIMIT ?`
  ).all(id, limit);
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

export function create(fields, userId, { demo = false } = {}) {
  const f = clean(fields);
  if (!f.name) throw new Error('a customer needs a name');

  return tx((d) => {
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
}

export function update(id, fields, userId) {
  const f = clean(fields);

  /* `archived` is not in FIELDS because it is a flag, not text, and letting it
     through the same path would make an empty string archive somebody. */
  if (fields.archived !== undefined) f.archived = fields.archived ? 1 : 0;

  const keys = Object.keys(f);
  if (!keys.length) throw new Error('nothing to update');
  if (f.name === null) throw new Error('a customer needs a name');

  return tx((d) => {
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
}

export function archive(id, userId) {
  return update(id, { archived: 1 }, userId);
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
