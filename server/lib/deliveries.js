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

   THE DELIVERY OFFICE (045) made this the board for every order that leaves
   the shop, not only a driver's run. A row now says how it travels — our
   driver, a transport office, a courier, abroad, or picked up — where to,
   what the shipping costs, and, through lib/orders.js, how much has been
   paid. Three more rules:

   3. A PARCEL GOES TO A COMPANY PAID. Transport offices, couriers and
      shipments abroad never collect for the shop, so `out` is refused while
      an order still owes anything.

   4. A PICKUP NEVER LEAVES. It waits, and is delivered when the customer
      collects it.

   5. A CANCELLED SALE HAS NOTHING TO DELIVER. Its row stays on the board,
      marked, and cannot be moved.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';
import * as Orders from './orders.js';

/* Who may move a delivery from where. Anything not listed is refused, which
   means a new status cannot accidentally become reachable from everywhere. */
const NEXT = {
  waiting:   ['out', 'failed'],
  out:       ['delivered', 'failed'],
  delivered: [],
  failed:    []
};

function nextFor(row) {
  if (row.method === 'pickup') return row.status === 'waiting' ? ['delivered', 'failed'] : [];
  return NEXT[row.status] || [];
}

const fail = (message, code, extra) => Object.assign(new Error(message), { code }, extra || {});

/* ------------------------------------------------------------------ reading */

/* A driver is scoped to himself. Everyone else with delivery.read sees the
   board. Scoped by ROLE rather than by permission: giving a manager
   delivery.read should show him the shop, giving a second driver the same
   permission should not show him the first driver's round. */
function scope(user) {
  return user && user.role === 'delivery' ? user.id : null;
}

/* What a delivery is worth and what has come in, written as SQL so the board
   can FILTER on money rather than fetching a window and sorting it in the
   browser.

   An office order owes its total plus any fee the shop charges, less its
   payments. A cash-on-delivery sale from the till owes what the driver was
   sent to collect, less what he brought back. Anything else was paid at the
   till. */
const DUE = `(CASE WHEN s.payment = 'order'
                   THEN MAX(0, s.total + CASE WHEN d.fee_mode = 'invoice' THEN d.fee ELSE 0 END
                                - COALESCE(rt.back, 0))
                   WHEN s.payment = 'cod' THEN d.to_collect
                   ELSE s.total END)`;
const PAID = `(CASE WHEN s.payment = 'order' THEN COALESCE(op.paid, 0)
                    WHEN s.payment = 'cod' THEN d.collected
                    ELSE s.total END)`;

const COLS =
  `SELECT d.*, u.name AS driver_name, s.customer_name, s.customer_id,
          s.total AS sale_total, s.payment AS sale_payment, s.voided AS sale_voided,
          s.public_token, s.at AS sale_at,
          ${DUE} AS due, ${PAID} AS paid, COALESCE(op.pending, 0) AS pending,
          COALESCE(rt.back, 0) AS returned, rt.outcome AS return_outcome,
          COALESCE(rt.n, 0) AS return_count,
          h.status AS handover_status, h.kind AS handover_kind`;

const FROM =
  `FROM deliveries d
     LEFT JOIN users u ON u.id = d.driver_id
     LEFT JOIN sales s ON s.id = d.sale_id
     LEFT JOIN (SELECT sale_id,
                       SUM(CASE WHEN kind = 'in' THEN amount_order ELSE -amount_order END) AS paid,
                       SUM(CASE WHEN kind = 'in' AND drawer = 1 AND handed_in_at IS NULL
                                THEN amount_order ELSE 0 END) AS pending
                  FROM order_payments GROUP BY sale_id) op ON op.sale_id = d.sale_id
     /* MAX(id) is there so 'outcome' is the LAST return's, which is SQLite's
        documented rule for a bare column beside MAX() — not alphabetical
        luck. Two returns on one order is ordinary: a size back today, the
        other next week. */
     LEFT JOIN (SELECT sale_id, SUM(due_minor) AS back, COUNT(*) AS n,
                       MAX(id) AS last_id, outcome
                  FROM order_returns GROUP BY sale_id) rt ON rt.sale_id = d.sale_id
     LEFT JOIN handovers h ON h.id = d.handover_id`;

function shape(r, driver = false) {
  const order = r.sale_payment === 'order';
  /* Nothing more is owed on a cancelled sale, or on a till delivery that came
     back — that sale is still there for somebody to void or chase. */
  const settled = !!r.sale_voided || (!order && r.status === 'failed');
  const due = r.due ?? r.to_collect;
  const paid = r.paid ?? 0;
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
    /* The LINK to the person, so the board can open them. The NAME above is
       the sale's frozen copy and stays the name that was written that day. */
    customerId: r.customer_id || null,
    items: r.items || [],
    assignedAt: r.assigned_at,
    outAt: r.out_at,
    closedAt: r.closed_at,
    failReason: r.fail_reason,

    /* 045. A delivery raised at the till has no method, and travels with
       our driver. */
    method: r.method || 'driver',
    fromTill: !r.method,
    order,
    companyId: r.company_id || null,
    companyName: r.company_name || null,
    country: r.country || null,
    city: r.city || null,
    recipient: r.recipient || null,
    fee: r.fee || 0,
    feeMode: r.fee_mode || 'none',
    feeSource: r.fee_source || null,
    plan: r.plan || null,
    channel: r.channel || null,
    trackingNo: r.tracking_no || null,
    voided: !!r.sale_voided,
    saleAt: r.sale_at || null,
    due,
    paid,
    remaining: settled ? 0 : Math.max(0, due - paid),
    /* Door cash a driver is still holding, in the order's currency. */
    pending: r.pending || 0,

    /* 046. What came back, the sheet it left on. */
    returned: r.returned || 0,
    returns: r.return_count || 0,
    returnOutcome: r.return_outcome || null,
    handoverId: r.handover_id || null,
    handoverKind: r.handover_kind || null,
    handoverStatus: r.handover_status || null,
    /* The customer's link to their own receipt. Not the driver's to hand out. */
    publicToken: driver ? null : (r.public_token || null)
  };
}

/* What is in the bag. Enough to check at the door, without the cost columns —
   a driver has no cost.read and this list is built for him. One query for
   every row on the board, not one per row. */
function attachItems(rows) {
  if (!rows.length) return rows;
  const ids = [...new Set(rows.map((r) => r.sale_id))];
  const items = get().prepare(
    `SELECT sale_id, name, size, qty FROM sale_items
      WHERE sale_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
  ).all(...ids);
  const bySale = new Map(ids.map((id) => [id, []]));
  for (const it of items) bySale.get(it.sale_id)?.push({ name: it.name, size: it.size, qty: it.qty });
  for (const r of rows) r.items = bySale.get(r.sale_id) || [];
  return rows;
}

/* The board: every filter answered by the database, capped, and saying so.
   status  open | waiting | out | delivered | failed | cancelled | all
   method  driver | office | courier | abroad | pickup
   money   owes | paid | with_driver
   q       an invoice, a name, a phone, a city, a tracking number */
export function board(user, { status = null, method = null, money = null, q = null, limit = 100 } = {}) {
  const mine = scope(user);
  const where = [];
  const args = [];

  if (mine !== null) { where.push('d.driver_id = ?', 's.voided = 0'); args.push(mine); }

  if (status === 'cancelled') where.push('s.voided = 1');
  else if (status === 'open') where.push("d.status IN ('waiting','out')", 's.voided = 0');
  else if (status && NEXT[status]) { where.push('d.status = ?', 's.voided = 0'); args.push(status); }

  if (method === 'driver') where.push("(d.method = 'driver' OR d.method IS NULL)");
  else if (method && Orders.METHODS.includes(method)) { where.push('d.method = ?'); args.push(method); }

  if (money === 'owes') where.push(`${DUE} - ${PAID} > 0`, "d.status <> 'failed'", 's.voided = 0');
  else if (money === 'paid') where.push(`${DUE} - ${PAID} <= 0`, 's.voided = 0');
  else if (money === 'with_driver') where.push('COALESCE(op.pending, 0) > 0');

  const term = String(q || '').replace(/[%_]/g, '').trim().slice(0, 60);
  if (term) {
    where.push(`(d.sale_id LIKE ? OR s.customer_name LIKE ? OR d.phone LIKE ? OR d.city LIKE ?
                 OR d.tracking_no LIKE ? OR d.company_name LIKE ? OR d.recipient LIKE ?)`);
    for (let i = 0; i < 7; i++) args.push(`%${term}%`);
  }

  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const lim = Math.max(1, Math.min(500, Math.floor(Number(limit)) || 100));

  const rows = get().prepare(
    `${COLS} ${FROM}${clause}
      ORDER BY CASE WHEN s.voided = 1 THEN 3 WHEN d.status = 'out' THEN 0
                    WHEN d.status = 'waiting' THEN 1 ELSE 2 END,
               d.assigned_at DESC, d.id DESC
      LIMIT ?`
  ).all(...args, lim);
  /* The count repeats the reader's own scoping and filters. A driver's board
     is his run, and a total over the whole table would be a number about
     somebody else's work. */
  const total = get().prepare(`SELECT COUNT(*) AS n ${FROM}${clause}`).get(...args).n;

  return {
    rows: attachItems(rows).map((r) => shape(r, mine !== null)),
    shown: rows.length,
    total,
    capped: total > rows.length
  };
}

export function list(user, { status, limit = 100 } = {}) {
  return board(user, { status, limit }).rows;
}

/* Null for "no such delivery" AND for "not yours" — deliberately the same
   answer, so the number of rows in the table is not something a driver can
   probe for by counting 404s against 403s. */
export function byId(id, user) {
  const mine = scope(user);
  const r = get().prepare(
    `${COLS} ${FROM} WHERE d.id = ?${mine !== null ? ' AND d.driver_id = ?' : ''}`
  ).get(...(mine !== null ? [id, mine] : [id]));

  return r ? shape(attachItems([r])[0], mine !== null) : null;
}

/* Everything about one order, by its invoice number — what a scanned slip
   opens. The same scoping as byId: another driver's order does not exist. */
export function bySale(saleId, user) {
  const d = get();
  const mine = scope(user);
  const driver = mine !== null;
  const r = d.prepare(
    `${COLS} ${FROM} WHERE d.sale_id = ?${driver ? ' AND d.driver_id = ?' : ''}`
  ).get(...(driver ? [saleId, mine] : [saleId]));
  if (!r) return null;

  const sale = d.prepare(
    `SELECT s.id, s.at, s.customer_id, s.customer_name, s.currency, s.subtotal, s.discount,
            s.total, s.voided, s.payment, s.wh_id, s.public_token, c.minor_exp
       FROM sales s JOIN currencies c ON c.code = s.currency
      WHERE s.id = ?`
  ).get(saleId);

  const items = d.prepare(
    'SELECT sku, name, size, qty, unit_price FROM sale_items WHERE sale_id = ? ORDER BY id'
  ).all(saleId).map((it) => driver
    ? { name: it.name, size: it.size, qty: it.qty }
    : { sku: it.sku, name: it.name, size: it.size, qty: it.qty, unitPrice: it.unit_price });

  const payments = sale.payment !== 'order' ? [] : d.prepare(
    `SELECT p.id, p.kind, p.at, p.amount, p.currency, p.amount_order, p.method, p.drawer,
            p.txn_ref, p.stage, p.shift_id, p.handed_in_at, u.name AS received_by_name
       FROM order_payments p LEFT JOIN users u ON u.id = p.received_by
      WHERE p.sale_id = ? ORDER BY p.at, p.id`
  ).all(saleId).map((p) => ({
    id: p.id, kind: p.kind, at: p.at, amount: p.amount, currency: p.currency,
    amountOrder: p.amount_order, method: p.method, drawer: !!p.drawer,
    /* A transfer reference is the shop's bookkeeping, not the driver's. */
    txnRef: driver ? null : p.txn_ref,
    stage: p.stage, shiftId: p.shift_id, handedInAt: p.handed_in_at,
    receivedBy: p.received_by_name || null
  }));

  const customer = sale.customer_id
    ? d.prepare('SELECT id, name, phone, address, city FROM customers WHERE id = ?').get(sale.customer_id) || null
    : null;

  return {
    sale: {
      id: sale.id, at: sale.at, customerId: sale.customer_id, customerName: sale.customer_name,
      currency: sale.currency, minorExp: sale.minor_exp, subtotal: sale.subtotal,
      discount: sale.discount, total: sale.total, voided: !!sale.voided, payment: sale.payment,
      whId: sale.wh_id, publicToken: driver ? null : sale.public_token
    },
    items,
    delivery: shape(attachItems([r])[0], driver),
    payments,
    customer
  };
}

/* For the nav badge: how many are still on the road. */
export function openCount(user) {
  const mine = scope(user);
  const r = get().prepare(
    `SELECT COUNT(*) AS n FROM deliveries d JOIN sales s ON s.id = d.sale_id
      WHERE d.status IN ('waiting','out') AND s.voided = 0${mine !== null ? ' AND d.driver_id = ?' : ''}`
  ).get(...(mine !== null ? [mine] : []));
  return r.n;
}

/* ---------------------------------------------------------------- assigning */

/* Send a sale out — the till's tick box. The delivery office writes its own
   rows through lib/orders.js, with the sale, in one transaction.

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

/* `handedIn` is the manager marking a driver's run delivered with the cash
   already in HIS hand — the payment is stamped into the open drawer on the
   spot. A driver marking his own run never sets it: the cash is his to hand
   in. */
export function update(id, {
  status, collected, reason, driverId, companyId, trackingNo, address, phone, handedIn
}, user) {
  return tx((d) => {
    const mine = scope(user);
    const row = d.prepare(
      `SELECT d.*, s.payment AS sale_payment, s.voided AS sale_voided
         FROM deliveries d JOIN sales s ON s.id = d.sale_id
        WHERE d.id = ?${mine !== null ? ' AND d.driver_id = ?' : ''}`
    ).get(...(mine !== null ? [id, mine] : [id]));

    if (!row) throw fail('no such delivery', 'not_found');
    if (row.sale_voided) {
      throw fail(`${row.sale_id} was cancelled — there is nothing to deliver`, 'voided');
    }

    const order = row.sale_payment === 'order';
    const at = nowIso();
    const sets = [];
    const args = [];
    /* The row as it will be once this lands, for the checks further down. */
    const will = { method: row.method, driver_id: row.driver_id, company_id: row.company_id };

    /* -- who takes it, before it leaves ------------------------------------- */
    if (driverId !== undefined || companyId !== undefined) {
      if (mine !== null) throw fail('a driver cannot hand his round to someone else', 'forbidden');
      if (driverId && companyId) throw fail('a driver or a company, not both', 'bad_request');
      if (row.status !== 'waiting') {
        throw fail('it has already left — it cannot be given to someone else now', 'bad_status');
      }
      if (row.method === 'pickup' && (driverId || companyId)) {
        throw fail('a pickup is collected from the shop — nobody takes it anywhere', 'method_mismatch');
      }
    }

    if (driverId !== undefined) {
      if (driverId !== null) {
        const drv = d.prepare('SELECT id, active, role FROM users WHERE id = ?').get(driverId);
        if (!drv || drv.role !== 'delivery') throw fail('no such driver', 'bad_driver');
        if (!drv.active) throw fail('that account is switched off', 'bad_driver');
      }
      sets.push('driver_id = ?'); args.push(driverId);
      will.driver_id = driverId;
      /* Our own driver taking a parcel that was going with a company changes
         how it travels, and the company is no longer part of it. */
      if (driverId !== null && row.method && row.method !== 'driver') {
        sets.push("method = 'driver'", 'company_id = NULL', 'company_name = NULL');
        will.method = 'driver';
        will.company_id = null;
      }
    }

    if (companyId !== undefined) {
      if (companyId === null) {
        sets.push('company_id = NULL', 'company_name = NULL');
        will.company_id = null;
      } else {
        const co = Orders.settings(d).companies
          .find((c) => c && c.id === companyId && c.active !== false);
        if (!co) throw fail('no such company — add it in Settings', 'bad_company');
        sets.push('company_id = ?', 'company_name = ?', 'method = ?', 'driver_id = NULL');
        args.push(co.id, co.en || co.ar || co.id, co.kind);
        will.company_id = co.id;
        will.method = co.kind;
        will.driver_id = null;
      }
    }

    if (trackingNo !== undefined) {
      if (mine !== null) throw fail('a driver cannot change the tracking number', 'forbidden');
      sets.push('tracking_no = ?'); args.push(String(trackingNo || '').trim().slice(0, 64) || null);
    }

    /* WHERE A PARCEL IS GOING IS NOT THE DRIVER'S TO REWRITE. The tracking
       number was guarded on the line above and these two were not, so a
       driver could change the address and the phone on a run he had already
       failed — the one record that says where it was supposed to go. He
       tells the office; the office changes it. */
    if (address !== undefined) {
      if (mine !== null) throw fail('a driver cannot change the address — tell the office', 'forbidden');
      if (!String(address || '').trim() && row.method !== 'pickup') {
        throw fail('the address cannot be emptied', 'bad_request');
      }
      sets.push('address = ?'); args.push(String(address || '').trim());
    }
    if (phone !== undefined) {
      if (mine !== null) throw fail('a driver cannot change the phone number — tell the office', 'forbidden');
      sets.push('phone = ?'); args.push(phone ? String(phone).trim().slice(0, 40) : null);
    }

    /* -- the status ---------------------------------------------------------- */

    /* Re-sending the status it already has is not "nothing to change" — it is
       almost always a double tap on a phone with a slow connection, and the
       honest answer names what already happened. */
    if (status !== undefined && status === row.status) {
      throw fail(`this delivery is already ${row.status}`, 'bad_status');
    }

    let receipt = null;
    if (status !== undefined) {
      const allowed = nextFor(row);
      if (!allowed.includes(status)) {
        throw fail(
          allowed.length
            ? `a delivery that is "${row.status}" can only become ${allowed.join(' or ')}`
            : `this delivery is already ${row.status} — that cannot be undone here`,
          'bad_status');
      }

      sets.push('status = ?'); args.push(status);

      if (status === 'out') {
        if (!will.driver_id && !will.company_id) {
          throw fail('nobody is taking it — pick a driver or a company first', 'no_carrier');
        }
        if (order) {
          const m = Orders.money(d, row.sale_id);
          const toCompany = Orders.COMPANY_METHODS.includes(will.method);
          if (toCompany && m.remaining > 0) {
            throw fail(`${m.remaining} is still owed — other cities and abroad are paid before the parcel leaves`,
                       'unpaid_before_send', { remaining: m.remaining, currency: m.currency });
          }
          /* Frozen as it leaves: what he is sent out to collect. */
          sets.push('to_collect = ?'); args.push(toCompany ? 0 : m.remaining);
        }
        sets.push('out_at = ?'); args.push(at);
      }

      if (status === 'delivered') {
        if (order) {
          const m = Orders.money(d, row.sale_id);
          const collects = Orders.ON_RECEIPT.includes(will.method);
          /* Default to all of it: the ordinary case is he collected what he was
             sent to collect, and making him retype it invites a typo on a phone
             screen in the street. A short payment is deliberate. */
          const got = collected === undefined ? (collects ? m.remaining : 0)
                                              : Math.round(Number(collected) || 0);
          if (got < 0) throw fail('a collected amount cannot be negative', 'bad_request');
          if (got > 0 && !collects) {
            throw fail('a company never collects for the shop — record the payment instead', 'bad_request');
          }
          if (got > m.remaining) {
            throw fail('that is more than is still owed — check the figure', 'overpaid',
                       { remaining: m.remaining, currency: m.currency });
          }
          if (got > 0) {
            const self = user ? user.id : null;
            receipt = Orders.takeOnReceipt(d, row.sale_id, {
              travel: will.method, amount: got, userId: self,
              /* A pickup is paid over the counter. A driver's cash is in his
                 hand until somebody says it reached the shop. */
              receivedBy: will.method === 'pickup' ? self : (will.driver_id || self),
              handedIn: will.method === 'pickup' || (!!handedIn && mine === null)
            });
          }
          sets.push('collected = ?'); args.push(got);
        } else {
          const got = collected === undefined ? row.to_collect : Math.round(Number(collected) || 0);
          if (got < 0) throw fail('a collected amount cannot be negative', 'bad_request');
          if (got > row.to_collect) {
            throw fail('that is more than the order was worth — check the figure', 'overpaid');
          }
          sets.push('collected = ?'); args.push(got);
        }
        sets.push('closed_at = ?'); args.push(at);
      }

      if (status === 'failed') {
        if (!String(reason || '').trim()) throw fail('say why it did not arrive', 'bad_request');
        sets.push('fail_reason = ?'); args.push(String(reason).trim().slice(0, 300));
        sets.push('closed_at = ?'); args.push(at);
      }
    }

    if (!sets.length) throw fail('nothing to change', 'bad_request');

    d.prepare(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    logChange('deliveries', String(id), 'update', user ? user.id : null, status ? `-> ${status}` : null);

    const after = d.prepare(`${COLS} ${FROM} WHERE d.id = ?`).get(id);
    const out = shape(attachItems([after])[0], mine !== null);
    if (receipt) out.receipt = receipt;
    return out;
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
