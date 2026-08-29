/* ============================================================================
   PURCHASE ORDERS                                             [purchasing.js]
   ----------------------------------------------------------------------------
   What the shop has asked its suppliers for, and what actually turned up.

   This was the last screen in the warehouse writing to nothing: the browser
   held an array, so an order raised on Sunday was gone on Monday and the
   supplier balance it should have moved never moved.

   Two rules worth stating:

     - Receiving books stock through the same movement log everything else
       uses, at the INTAKE warehouse. A delivery arrives at the back door in
       boxes; somebody still has to carry it out front, and that carry is a
       transfer the system should see rather than stock teleporting onto the
       shelf.

     - A short delivery is normal. Eight of the ten you ordered is not
       "received" — the line records what came, the order stays open, and the
       two that are missing are still owed.
   ========================================================================== */

import * as DB from './db.js';
import * as Stock from './stock.js';

const nowIso = () => new Date().toISOString();
const fail = (msg, code) => Object.assign(new Error(msg), { code });

/* Derived from the highest that exists, not a stored counter — a counter can
   fall behind its own data and hand out a number somebody is already using. */
export function nextId(d = DB.get()) {
  const top = d.prepare(
    `SELECT MAX(CAST(SUBSTR(id, 4) AS INTEGER)) AS m
       FROM purchase_orders WHERE id GLOB 'PO-[0-9]*'`
  ).get().m;
  return 'PO-' + String((top || 0) + 1).padStart(4, '0');
}

export function list({ status = null, limit = 100 } = {}) {
  const d = DB.get();
  const orders = status
    ? d.prepare('SELECT * FROM purchase_orders WHERE status = ? ORDER BY created_at DESC LIMIT ?')
        .all(status, limit)
    : d.prepare('SELECT * FROM purchase_orders ORDER BY created_at DESC LIMIT ?').all(limit);
  if (!orders.length) return [];

  const lines = d.prepare(
    `SELECT l.*, v.size, v.product_id, p.name AS product_name
       FROM purchase_order_lines l
       JOIN variants v ON v.sku = l.sku
       JOIN products p ON p.id = v.product_id
      ORDER BY l.id`
  ).all();

  return orders.map((o) => shape(o, lines.filter((l) => l.po_id === o.id)));
}

function shape(o, lines) {
  return {
    ...o,
    lines,
    /* Derived, never stored: a total and its lines cannot disagree. */
    total: lines.reduce((a, l) => a + l.qty * l.unit_cost, 0),
    pieces: lines.reduce((a, l) => a + l.qty, 0),
    receivedPieces: lines.reduce((a, l) => a + l.received_qty, 0)
  };
}

export function get(id) {
  const d = DB.get();
  const o = d.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (!o) return null;
  return shape(o, d.prepare(
    `SELECT l.*, v.size, v.product_id, p.name AS product_name
       FROM purchase_order_lines l
       JOIN variants v ON v.sku = l.sku
       JOIN products p ON p.id = v.product_id
      WHERE l.po_id = ? ORDER BY l.id`
  ).all(id));
}

export function create({ supplierId = null, lines = [], note = null, whId = null,
                         currency = 'SYP', userId = null }) {
  if (!lines.length) throw fail('an order needs at least one line', 'bad_request');

  return DB.tx(() => {
    const d = DB.get();
    const id = nextId(d);
    const at = nowIso();
    const sup = supplierId
      ? d.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplierId)
      : null;

    d.prepare(
      `INSERT INTO purchase_orders
         (id, supplier_id, supplier_name, status, currency, wh_id, note,
          created_at, updated_at, created_by)
       VALUES (?,?,?,'draft',?,?,?,?,?,?)`
    ).run(id, supplierId, sup ? sup.name : null, currency, whId, note, at, at, userId);

    const ins = d.prepare(
      'INSERT INTO purchase_order_lines (po_id, sku, qty, unit_cost) VALUES (?,?,?,?)'
    );
    for (const l of lines) {
      if (!l.sku) throw fail('every line needs a sku', 'bad_request');
      if (!(l.qty > 0)) throw fail('every line needs a quantity', 'bad_request');
      ins.run(id, l.sku, l.qty, l.unitCost || 0);
    }

    DB.logChange('purchase_orders', id, 'insert', userId, null);
    return get(id);
  });
}

export function send(id, userId = null) {
  return DB.tx(() => {
    const d = DB.get();
    const o = d.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id);
    if (!o) throw fail('no such order', 'not_found');
    if (o.status !== 'draft') throw fail('only a draft can be sent', 'bad_status');

    const at = nowIso();
    d.prepare("UPDATE purchase_orders SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?")
      .run(at, at, id);
    DB.logChange('purchase_orders', id, 'update', userId, null);
    return get(id);
  });
}

/* `received` is [{ sku, qty }] — what actually turned up, which is not always
   what was ordered. Omit it and the whole order is taken as delivered. */
export function receive(id, received = null, userId = null) {
  return DB.tx(() => {
    const d = DB.get();
    const o = d.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
    if (!o) throw fail('no such order', 'not_found');
    if (o.status === 'received') throw fail('already received', 'bad_status');
    if (o.status === 'cancelled') throw fail('that order was cancelled', 'bad_status');

    const lines = d.prepare('SELECT * FROM purchase_order_lines WHERE po_id = ?').all(id);
    const want = new Map((received || []).map((r) => [r.sku, Number(r.qty) || 0]));
    const wh = o.wh_id || 'store';
    const at = nowIso();

    let value = 0;
    for (const l of lines) {
      const qty = received ? (want.get(l.sku) || 0) : (l.qty - l.received_qty);
      if (qty <= 0) continue;

      /* Stock.apply rather than Stock.receive: receive() opens its own
         transaction and DB.tx refuses to nest, deliberately — SQLite has no
         nested transactions and a half-applied delivery is worse than a
         refused one. apply() is the same booking without the wrapper, so the
         whole delivery still lands or none of it does. */
      Stock.apply(d, {
        sku: l.sku, whId: wh, delta: qty, type: 'received',
        note: 'Received on ' + id, userId, refType: 'po', refId: id
      });
      d.prepare('UPDATE purchase_order_lines SET received_qty = received_qty + ? WHERE id = ?')
        .run(qty, l.id);
      value += qty * l.unit_cost;
    }

    const after = d.prepare('SELECT qty, received_qty FROM purchase_order_lines WHERE po_id = ?').all(id);
    const complete = after.every((l) => l.received_qty >= l.qty);

    d.prepare('UPDATE purchase_orders SET status = ?, received_at = ?, updated_at = ? WHERE id = ?')
      .run(complete ? 'received' : 'sent', complete ? at : null, at, id);

    /* The shop owes for what ARRIVED, not for what it hoped would. Adding
       the order total on the first partial delivery would book the shop for
       ten pairs when eight came. */
    if (o.supplier_id && value) {
      d.prepare('UPDATE suppliers SET outstanding = outstanding + ?, updated_at = ? WHERE id = ?')
        .run(value, at, o.supplier_id);
      DB.logChange('suppliers', o.supplier_id, 'update', userId, null);
    }

    DB.logChange('purchase_orders', id, 'update', userId, null);
    return get(id);
  });
}

export function cancel(id, userId = null) {
  return DB.tx(() => {
    const d = DB.get();
    const o = d.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id);
    if (!o) throw fail('no such order', 'not_found');
    if (o.status === 'received') throw fail('that order already arrived', 'bad_status');

    d.prepare("UPDATE purchase_orders SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .run(nowIso(), id);
    DB.logChange('purchase_orders', id, 'update', userId, null);
    return get(id);
  });
}
