/* ==========================================================================
   OG SYSTEM — deliveries
   --------------------------------------------------------------------------
   A sale that leaves the shop in someone's hands. Phase one is the list: who
   is taking what, where, and did it arrive.

   Two things are decided here and never by the browser:

   1. HOW MUCH HE COLLECTS. Read from the sale, not from the request. A driver
      whose phone can name the figure is a driver who can name a smaller one.
      It is frozen at assignment for the same reason a sale freezes its
      exchange rate: what he was sent out to collect must not change because
      someone edited a price while he was riding across town.

   2. WHOSE RUNS THESE ARE. A driver only ever sees and touches rows with his
      own id on them, filtered in the query rather than trusted from a
      parameter. Ask for someone else's delivery by number and you get a 404,
      not a redacted row — a driver has no business learning that a delivery to
      that address exists at all.

   Status moves one way: waiting -> out -> delivered, or -> failed. Delivered
   and failed are the end. Re-marking a finished delivery is refused rather
   than silently overwriting the time it was actually handed over.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';

/* Who may move a delivery from where. Anything not listed is refused, which
   means a new status cannot accidentally become reachable from everywhere. */
const NEXT = {
  waiting:   ['out', 'failed'],
  out:       ['delivered', 'failed'],
  delivered: [],
  failed:    []
};

/* ------------------------------------------------------------------ reading */

/* A driver is scoped to himself. Everyone else with delivery.read sees the
   board. Scoped by ROLE rather than by permission: giving a manager
   delivery.read should show him the shop, giving a second driver the same
   permission should not show him the first driver's round. */
function scope(user) {
  return user && user.role === 'delivery' ? user.id : null;
}

function shape(r) {
  return {
    id: r.id,
    saleId: r.sale_id,
    driverId: r.driver_id,
    driverName: r.driver_name || null,
    status: r.status,
    address: r.address,
    phone: r.phone,
    note: r.note,
    toCollect: r.to_collect,
    collected: r.collected,
    currency: r.currency,
    customerName: r.customer_name || null,
    items: r.items || [],
    assignedAt: r.assigned_at,
    outAt: r.out_at,
    closedAt: r.closed_at,
    failReason: r.fail_reason
  };
}

const SELECT =
  `SELECT d.*, u.name AS driver_name, s.customer_name
     FROM deliveries d
     LEFT JOIN users u ON u.id = d.driver_id
     LEFT JOIN sales s ON s.id = d.sale_id`;

/* What is in the bag. Enough to check at the door, without the cost columns —
   a driver has no cost.read and this list is built for him. */
function itemsFor(saleId) {
  return get().prepare(
    `SELECT name, size, qty FROM sale_items WHERE sale_id = ? ORDER BY id`
  ).all(saleId);
}

export function list(user, { status, limit = 100 } = {}) {
  const mine = scope(user);
  const where = [];
  const args = [];

  if (mine !== null) { where.push('d.driver_id = ?'); args.push(mine); }
  if (status) { where.push('d.status = ?'); args.push(status); }

  const rows = get().prepare(
    `${SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE d.status WHEN 'out' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,
               d.assigned_at DESC
      LIMIT ?`
  ).all(...args, Math.min(500, Number(limit) || 100));

  return rows.map(r => shape({ ...r, items: itemsFor(r.sale_id) }));
}

/* Null for "no such delivery" AND for "not yours" — deliberately the same
   answer, so the number of rows in the table is not something a driver can
   probe for by counting 404s against 403s. */
export function byId(id, user) {
  const mine = scope(user);
  const r = get().prepare(
    `${SELECT} WHERE d.id = ?${mine !== null ? ' AND d.driver_id = ?' : ''}`
  ).get(...(mine !== null ? [id, mine] : [id]));

  return r ? shape({ ...r, items: itemsFor(r.sale_id) }) : null;
}

/* For the nav badge: how many are still on the road. */
export function openCount(user) {
  const mine = scope(user);
  const r = get().prepare(
    `SELECT COUNT(*) AS n FROM deliveries
      WHERE status IN ('waiting','out')${mine !== null ? ' AND driver_id = ?' : ''}`
  ).get(...(mine !== null ? [mine] : []));
  return r.n;
}

/* ---------------------------------------------------------------- assigning */

/* Send a sale out.

   `toCollect` is NOT a parameter. A sale already paid at the till has nothing
   to collect; one rung up as cash-on-delivery has its full total outstanding.
   Both answers are in the sales table already. */
export function assign({ saleId, driverId, address, phone, note, byUserId, opId }) {
  if (!saleId) throw new Error('which sale is going out?');
  if (!address || !String(address).trim()) {
    throw new Error('a delivery needs an address — where is he taking it?');
  }

  if (opId) {
    const seen = get().prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
    if (seen) return { ...JSON.parse(seen.result), replayed: true };
  }

  return tx((d) => {
    const sale = d.prepare(
      'SELECT id, total, currency, payment, voided, customer_id FROM sales WHERE id = ?'
    ).get(saleId);

    if (!sale) throw new Error(`no such sale: ${saleId}`);
    if (sale.voided) throw new Error('that sale was voided — it is not going anywhere');

    const already = d.prepare('SELECT id FROM deliveries WHERE sale_id = ?').get(saleId);
    if (already) throw new Error(`${saleId} is already out for delivery`);

    if (driverId) {
      const drv = d.prepare('SELECT id, active FROM users WHERE id = ?').get(driverId);
      if (!drv) throw new Error('no such driver');
      if (!drv.active) throw new Error('that account is switched off');
    }

    /* Cash on delivery is the only payment type where money is still owed when
       the goods leave. Everything else was settled at the till. */
    const toCollect = sale.payment === 'cod' ? sale.total : 0;

    const at = nowIso();
    const info = d.prepare(
      `INSERT INTO deliveries
         (sale_id, driver_id, status, address, phone, note,
          to_collect, collected, currency, assigned_at, assigned_by)
       VALUES (?, ?, 'waiting', ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(saleId, driverId ?? null, String(address).trim(),
          phone ?? null, note ?? null, toCollect, sale.currency, at, byUserId ?? null);

    const id = Number(info.lastInsertRowid);

    /* Remember it on the customer as the address to offer next time, but only
       when they have none — never overwrite one someone typed deliberately. */
    if (sale.customer_id) {
      const touched = d.prepare(
        `UPDATE customers SET address = ?, updated_at = ?
          WHERE id = ? AND (address IS NULL OR address = '')`
      ).run(String(address).trim(), at, sale.customer_id);

      /* customers is cursor-shape in the mirror, so a write nobody logs never
         leaves this machine. The WHERE is conditional — most of the time the
         customer already has an address and nothing changes — so log only when
         a row actually moved, rather than queueing a no-op push per delivery. */
      if (touched.changes > 0) {
        logChange('customers', String(sale.customer_id), 'update', byUserId, null);
      }
    }

    logChange('deliveries', String(id), 'insert', byUserId, null);

    const result = {
      id, saleId, driverId: driverId ?? null, status: 'waiting',
      address: String(address).trim(), phone: phone ?? null,
      toCollect, collected: 0, currency: sale.currency, assignedAt: at
    };

    if (opId) {
      d.prepare(
        `INSERT INTO applied_ops (op_id, at, user_id, kind, result)
         VALUES (?, ?, ?, 'delivery', ?)`
      ).run(opId, at, byUserId ?? null, JSON.stringify(result));
    }

    return result;
  });
}

/* ---------------------------------------------------------------- moving it */

export function update(id, { status, collected, reason, driverId, address, phone }, user) {
  return tx((d) => {
    const mine = scope(user);
    const row = d.prepare(
      `SELECT * FROM deliveries WHERE id = ?${mine !== null ? ' AND driver_id = ?' : ''}`
    ).get(...(mine !== null ? [id, mine] : [id]));

    if (!row) throw new Error('no such delivery');

    const at = nowIso();
    const sets = [];
    const args = [];

    /* -- reassigning, before it leaves ------------------------------------- */
    if (driverId !== undefined) {
      if (mine !== null) throw new Error('a driver cannot hand his round to someone else');
      if (row.status !== 'waiting') {
        throw new Error('it has already left — it cannot be given to someone else now');
      }
      sets.push('driver_id = ?'); args.push(driverId ?? null);
    }

    if (address !== undefined) {
      if (!String(address).trim()) throw new Error('the address cannot be emptied');
      sets.push('address = ?'); args.push(String(address).trim());
    }
    if (phone !== undefined) { sets.push('phone = ?'); args.push(phone ?? null); }

    /* -- the status ---------------------------------------------------------- */

    /* Re-sending the status it already has is not "nothing to change" — it is
       almost always a double tap on a phone with a slow connection, and the
       honest answer names what already happened. */
    if (status !== undefined && status === row.status) {
      throw new Error(`this delivery is already ${row.status}`);
    }

    if (status !== undefined) {
      const allowed = NEXT[row.status] || [];
      if (!allowed.includes(status)) {
        throw new Error(
          allowed.length
            ? `a delivery that is "${row.status}" can only become ${allowed.join(' or ')}`
            : `this delivery is already ${row.status} — that cannot be undone here`);
      }
      if (status === 'out' && !row.driver_id && driverId === undefined) {
        throw new Error('nobody is taking it — pick a driver first');
      }
      if (status === 'failed' && !String(reason || '').trim()) {
        throw new Error('say why it did not arrive');
      }

      sets.push('status = ?'); args.push(status);

      if (status === 'out') { sets.push('out_at = ?'); args.push(at); }

      if (status === 'delivered') {
        /* Default to the full amount: the ordinary case is he collected what
           he was sent to collect, and making him retype it invites a typo on
           a phone screen in the street. A short payment is deliberate. */
        let got = collected === undefined ? row.to_collect : Math.round(Number(collected) || 0);
        if (got < 0) throw new Error('a collected amount cannot be negative');
        if (got > row.to_collect) {
          throw new Error('that is more than the order was worth — check the figure');
        }
        sets.push('collected = ?'); args.push(got);
        sets.push('closed_at = ?'); args.push(at);
      }

      if (status === 'failed') {
        sets.push('fail_reason = ?'); args.push(String(reason).trim());
        sets.push('closed_at = ?'); args.push(at);
      }
    }

    if (!sets.length) throw new Error('nothing to change');

    d.prepare(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    logChange('deliveries', String(id), 'update', user ? user.id : null, null);

    const after = d.prepare('SELECT * FROM deliveries WHERE id = ?').get(id);
    return shape({ ...after, items: [] });
  });
}

/* ------------------------------------------------------------- the day's end
   Not a screen yet -- the cash settle-up is the next phase -- but the figures
   it will need are already recordable, and having the query here means the
   schema gets checked against its purpose now rather than in six weeks. */
export function driverDay(driverId, dayIso) {
  const day = (dayIso || nowIso()).slice(0, 10);
  const r = get().prepare(
    `SELECT COUNT(*) AS runs,
            SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed,
            SUM(to_collect) AS owed,
            SUM(collected)  AS collected
       FROM deliveries
      WHERE driver_id = ? AND SUBSTR(assigned_at, 1, 10) = ?`
  ).get(driverId, day);

  return {
    day,
    runs: r.runs || 0,
    delivered: r.delivered || 0,
    failed: r.failed || 0,
    owed: r.owed || 0,
    collected: r.collected || 0
  };
}
