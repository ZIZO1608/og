/* ==========================================================================
   OG SYSTEM — the wants list
   --------------------------------------------------------------------------
   "Somebody asked for a 44 and we didn't have it."

   A wants list only works if it gets filled in, and a feature that needs a
   new habit dies in a shop where the person holding the phone is also the
   person holding the box. So nothing here is typed: when a size is looked up
   while it is OUT OF STOCK and a customer is attached to the sale, that IS
   the record. The habit already exists — scanning the box, searching the size
   for somebody standing there — and this keeps the result.

   When the size lands, the list of who wanted it is already written.

   TWO RULES THAT KEEP IT HONEST:

   Only when it is genuinely out. Recording a want for a size that is on the
   shelf would fill the list with noise within a week, and the list is only
   worth opening if every row is somebody who left without one.

   One row per customer per size per day. The same box gets scanned three
   times while a customer decides; that is one want, not three. Deduped on
   read AND on write, because a shop with two tills has two people asking.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';

/* Is this size actually out? Asked here rather than trusted from the caller:
   the till has an opinion, but the shelf is the fact, and a want recorded for
   something in stock is a row somebody will act on for nothing. */
function outOfStock(d, sku) {
  if (!sku) return true;                 /* a size the shop has never carried */
  const row = d.prepare(
    'SELECT COALESCE(SUM(qty), 0) AS n FROM stock WHERE sku = ?').get(sku);
  return (row ? row.n : 0) <= 0;
}

export function record({ customerId, sku = null, productId = null, size = null,
                         source = 'scan', userId = null }) {
  if (!customerId) throw Object.assign(new Error('a want needs a customer'), { code: 'no_customer' });
  const src = ['scan', 'search', 'ask'].includes(source) ? source : 'scan';

  return tx((d) => {
    const cust = d.prepare('SELECT id, archived FROM customers WHERE id = ?').get(customerId);
    if (!cust || cust.archived) {
      throw Object.assign(new Error('no such customer'), { code: 'unknown_customer' });
    }

    /* Fill in whatever the caller did not send, from the variant. */
    let pid = productId, sz = size;
    if (sku) {
      const v = d.prepare('SELECT product_id, size FROM variants WHERE sku = ?').get(sku);
      if (v) { pid = pid ?? v.product_id; sz = sz ?? v.size; }
    }

    if (!outOfStock(d, sku)) {
      /* Not an error — the till did nothing wrong, there is simply nothing
         worth remembering. Saying so lets the caller stay quiet. */
      return { recorded: false, reason: 'in_stock' };
    }

    /* Already asked today? */
    const today = nowIso().slice(0, 10);
    const dupe = d.prepare(
      `SELECT id FROM wants
        WHERE customer_id = ? AND closed_at IS NULL
          AND COALESCE(variant_sku, '') = COALESCE(?, '')
          AND COALESCE(product_id, -1) = COALESCE(?, -1)
          AND COALESCE(size, '') = COALESCE(?, '')
          AND SUBSTR(at, 1, 10) = ?
        LIMIT 1`
    ).get(customerId, sku, pid, sz, today);
    if (dupe) return { recorded: false, reason: 'already_today', id: dupe.id };

    const at = nowIso();
    const info = d.prepare(
      `INSERT INTO wants (customer_id, product_id, variant_sku, size, source, user_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(customerId, pid ?? null, sku, sz ?? null, src, userId, at);

    const id = Number(info.lastInsertRowid);
    logChange('wants', id, 'insert', userId, null);
    return { recorded: true, id, customerId, productId: pid ?? null, sku, size: sz ?? null, at };
  });
}

export function close(id, { note = null, userId = null } = {}) {
  return tx((d) => {
    const row = d.prepare('SELECT id, closed_at FROM wants WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('no such want'), { code: 'not_found' });
    if (row.closed_at) return row;                     /* already answered */
    const at = nowIso();
    d.prepare('UPDATE wants SET closed_at = ?, closed_note = ? WHERE id = ?').run(at, note, id);
    logChange('wants', id, 'update', userId, 'closed');
    return { id, closedAt: at, note };
  });
}

/* Who is still waiting. Filtered to one SKU or one product when the caller
   is asking about a shipment that just landed. */
export function open({ sku = null, productId = null, limit = 200 } = {}) {
  const n = Math.max(1, Math.min(500, Math.floor(Number(limit)) || 200));
  const where = ['w.closed_at IS NULL', 'c.archived = 0'];
  const args = [];
  if (sku) { where.push('w.variant_sku = ?'); args.push(sku); }
  if (productId) { where.push('w.product_id = ?'); args.push(Number(productId)); }
  args.push(n);

  return get().prepare(
    `SELECT w.id, w.customer_id, w.product_id, w.variant_sku, w.size, w.source, w.at,
            c.name AS customer_name, c.phone AS customer_phone,
            p.name AS product_name, u.name AS user_name
       FROM wants w
       JOIN customers c ON c.id = w.customer_id
       LEFT JOIN products p ON p.id = w.product_id
       LEFT JOIN users u ON u.id = w.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY w.at DESC
      LIMIT ?`
  ).all(...args);
}

/* One customer's, for their profile — open and answered alike, because "we
   came back to them" is the half that shows the shop kept its word. */
export function forCustomer(customerId, limit = 50) {
  const n = Math.max(1, Math.min(200, Math.floor(Number(limit)) || 50));
  return get().prepare(
    `SELECT w.id, w.product_id, w.variant_sku, w.size, w.source, w.at,
            w.closed_at, w.closed_note, p.name AS product_name
       FROM wants w
       LEFT JOIN products p ON p.id = w.product_id
      WHERE w.customer_id = ?
      ORDER BY w.at DESC
      LIMIT ?`
  ).all(customerId, n);
}
