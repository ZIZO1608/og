/* ==========================================================================
   OG SYSTEM — the delivery office
   --------------------------------------------------------------------------
   Orders taken by phone, Instagram and WhatsApp, sent out five ways: the
   shop's own driver, a transport office, a courier company, abroad, or picked
   up by the customer. Migration 045 is the shape; this file is the rules.

   AN ORDER IS ONE TRANSACTION. The sale (and the stock leaving the shelf),
   the delivery row and whatever was paid up front commit together. At the
   till a delivery is written AFTER the sale on purpose — the money is already
   in the drawer and a failed delivery write must not unwind it. Here nothing
   has changed hands before Save, and a sale with no destination or no record
   of its deposit would be invisible to the board.

   WHAT IS OWED IS DERIVED. Due is the sale's total, plus the shipping fee when
   the shop charges it; paid is the order-currency value of every payment in,
   less every refund. There is no stored balance to fall out of step.

   THREE RULES THE BROWSER ONLY MIRRORS:
     1. A transfer needs its reference.
     2. Nothing is paid twice. The balance is recomputed inside the
        transaction, and an opId makes a retry return what already happened.
     3. OTHER CITIES AND ABROAD ARE PAID BEFORE SENDING. Those companies never
        collect for the shop, so only our own driver or a pickup can be paid
        on receipt, and Deliveries.update refuses to send a parcel to a company
        while anything is owed.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';
import * as Sales from './sales.js';
import { currentShift } from './money.js';
import * as Stock from './stock.js';

export const METHODS = ['driver', 'office', 'courier', 'abroad', 'pickup'];
/* Handed to a company that never collects for the shop. */
export const COMPANY_METHODS = ['office', 'courier', 'abroad'];
/* Where money can still change hands when the parcel arrives. */
export const ON_RECEIPT = ['driver', 'pickup'];

const PLANS = ['full', 'deposit', 'receipt'];
const CHANNELS = ['phone', 'instagram', 'whatsapp', 'web', 'other'];

/* Methods that are the till's own bookkeeping. `order` is what this file
   writes; `credit` is a debt; `cod` counted cash before any existed. */
const NEVER_AT_DESK = ['cod', 'credit', 'order'];

/* Their meaning is code, not a setting: the names may be edited, the flags
   may not. */
const SYSTEM_METHODS = {
  cash:   { ref: false, drawer: true,  till: true,  desk: true,  debt: true,  active: true },
  cod:    { ref: false, drawer: true,  till: false, desk: false, debt: false, active: false },
  credit: { ref: false, drawer: false, till: true,  desk: false, debt: false, active: true },
  order:  { ref: false, drawer: false, till: false, desk: false, debt: false, active: true },
  /* Money the shop is already holding for this customer — a return kept as
     credit, spent on a later order. It moves nothing in any drawer, which is
     the whole point: the cash never left the shop. */
  store_credit: { ref: false, drawer: false, till: false, desk: true, debt: false, active: true }
};

/* Written in code rather than seeded, so every shop that already has 045's
   list gets it without a config migration. */
const STORE_CREDIT = {
  id: 'store_credit', en: 'Shop credit', ar: 'رصيد لدى المحل',
  ...SYSTEM_METHODS.store_credit, system: true
};

const fail = (message, code, extra) => Object.assign(new Error(message), { code }, extra || {});

/* ---------------------------------------------------------------- settings */

function cfg(d, key) {
  const r = d.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return r ? r.value : null;
}

function cfgJson(d, key, fallback) {
  try {
    const v = JSON.parse(cfg(d, key));
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
}

/* Every list the owner edits, parsed, with a fallback for each so one broken
   key never takes the office down. */
export function settings(d = get()) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const accounts = cfgJson(d, 'pay.accounts', {});
  const methods = arr(cfgJson(d, 'pay.methods', []));
  if (!methods.some((m) => m && m.id === STORE_CREDIT.id)) methods.push({ ...STORE_CREDIT });
  return {
    methods,
    accounts: accounts && typeof accounts === 'object' && !Array.isArray(accounts) ? accounts : {},
    companies: arr(cfgJson(d, 'delivery.companies', [])),
    countries: arr(cfgJson(d, 'delivery.countries', [])),
    prices: arr(cfgJson(d, 'delivery.prices', [])),
    wh: cfg(d, 'delivery.wh') || 'store',
    print: cfg(d, 'delivery.print') || 'slip'
  };
}

/* The address a customer's tracking link starts with. The receipt's own
   setting first, then the shop's, then the Cloudflare hostname — which is
   https by construction, the tunnel terminates TLS at Cloudflare's edge. */
export function publicBase(d = get()) {
  const set = cfg(d, 'receipt.public_url') || cfg(d, 'shop.public_url');
  if (set && String(set).trim()) {
    const v = String(set).trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  }
  const h = String(process.env.OG_CF_HOSTNAME || '')
    .trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return h ? `https://${h}` : null;
}

export function drivers() {
  return get().prepare(
    "SELECT id, name FROM users WHERE role = 'delivery' AND active = 1 ORDER BY name"
  ).all();
}

/* What the office needs before it can draw anything, in one request. The
   shop's own transfer accounts ride only with `withAccounts` — they are the
   numbers a customer pays into, and GET /api/config strips them for anyone
   without config.write. */
export function bootstrap({ withAccounts = false, withDrivers = false } = {}) {
  const d = get();
  const s = settings(d);
  const currencies = d.prepare('SELECT * FROM currencies ORDER BY code').all();
  const rates = {};
  for (const c of currencies) rates[c.code] = Sales.currentRate('USD', c.code);
  const maxPct = Number(cfg(d, 'sale.max_discount_pct'));
  return {
    currencies,
    rates,
    base: cfg(d, 'shop.base_currency') || 'SYP',
    settings: { ...s, accounts: withAccounts ? s.accounts : {} },
    drivers: withDrivers ? drivers() : [],
    warehouses: d.prepare('SELECT id, name FROM warehouses ORDER BY sort').all(),
    publicBase: publicBase(d),
    maxDiscountPct: Number.isFinite(maxPct) ? maxPct : 100,
    methods: METHODS,
    companyMethods: COMPANY_METHODS,
    onReceipt: ON_RECEIPT
  };
}

/* ------------------------------------------------------------------- money */

/* USD -> code: the direction every rate in this database is stored in. */
function usdTo(code) {
  const r = Sales.currentRate('USD', code);
  if (!r) throw fail(`no exchange rate for USD/${code} — set one in Settings`, 'no_rate');
  return r;
}

/* An amount in `from` minor units, as `to` minor units, through USD. Rounded
   once at the end, which is Sales.convert's rule. */
export function convertAt(amount, from, to) {
  if (from === to) return amount;
  return Sales.convert(amount, from, to, usdTo(to) / usdTo(from));
}

/* { currency, due, paid, remaining, pending } for one order, in its own
   currency. `pending` is cash a driver collected that has not reached the
   shop. Null for a sale that does not exist. */
export function money(d, saleId) {
  const s = d.prepare('SELECT id, total, currency FROM sales WHERE id = ?').get(saleId);
  if (!s) return null;
  const row = d.prepare('SELECT fee, fee_mode FROM deliveries WHERE sale_id = ?').get(saleId);
  /* What came back off the shelf is no longer owed. Stored on the return at
     the moment it was taken back, never recomputed from today's prices. */
  const back = d.prepare(
    'SELECT COALESCE(SUM(due_minor), 0) AS n FROM order_returns WHERE sale_id = ?'
  ).get(saleId).n;
  const due = Math.max(0, s.total + (row && row.fee_mode === 'invoice' ? row.fee : 0) - back);
  const p = d.prepare(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'in' THEN amount_order ELSE -amount_order END), 0) AS paid,
            COALESCE(SUM(CASE WHEN kind = 'in' AND drawer = 1 AND handed_in_at IS NULL
                              THEN amount_order ELSE 0 END), 0) AS pending
       FROM order_payments WHERE sale_id = ?`
  ).get(saleId);
  return {
    currency: s.currency,
    due,
    returned: back,
    paid: p.paid,
    remaining: Math.max(0, due - p.paid),
    pending: p.pending
  };
}

/* One payment in. Every guard is here, so the three ways money arrives — at
   the office, a later transfer, cash at the door — cannot disagree.

   `handedIn` says the money is physically at the shop. For paper cash that
   stamps the open drawer; no open drawer is a real state (a Friday, nobody
   on the till) and is recorded as exactly that, never refused — the cash
   exists either way. A driver's door cash is not handed in: it is in his
   hand until somebody says it reached the shop. */
function takePayment(d, sale, s, {
  amount, currency, method, txnRef, stage, note, userId,
  receivedBy = null, handedIn = true, atDesk = true
}) {
  const m = s.methods.find((x) => x && x.id === method);
  if (!m || m.active === false) throw fail(`there is no '${method}' payment method`, 'bad_method');
  if (NEVER_AT_DESK.includes(m.id) || (atDesk && !m.desk)) {
    throw fail(`${m.en || m.id} cannot be taken for a delivery order`, 'bad_method');
  }

  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) {
    throw fail('a payment has to be more than nothing', 'bad_request');
  }

  const cur = currency || sale.currency;
  if (!d.prepare('SELECT 1 FROM currencies WHERE code = ?').get(cur)) {
    throw fail(`unknown currency: ${cur}`, 'bad_currency');
  }

  const ref = String(txnRef ?? '').trim().slice(0, 64) || null;
  if (m.ref && !ref) throw fail(`${m.en || m.id} needs its transfer reference`, 'ref_required');

  /* Money the shop is already holding for this person. Checked against the
     ledger here, and spent below in the same transaction — the balance a
     browser was shown is a courtesy, this is the rule. */
  let spender = null;
  if (m.id === STORE_CREDIT.id) {
    const who = d.prepare('SELECT customer_id FROM sales WHERE id = ?').get(sale.id);
    if (!who || !who.customer_id) {
      throw fail('shop credit belongs to a customer — this order has none', 'needs_customer');
    }
    const have = creditIn(d, who.customer_id, cur);
    if (amt > have) {
      throw fail(have > 0
        ? `there is only ${have} ${cur} of credit left`
        : `there is no ${cur} credit for this customer`, 'no_credit', { have, currency: cur });
    }
    spender = who.customer_id;
  }

  const inOrder = convertAt(amt, cur, sale.currency);
  if (inOrder <= 0) {
    throw fail('that amount is too small to count against this order', 'too_small');
  }

  /* Recomputed here. Checked on screen it is a courtesy — two devices both
     see the same amount owed. */
  const now = money(d, sale.id);
  if (now.remaining <= 0) throw fail(`${sale.id} is already paid`, 'already_settled');
  if (inOrder > now.remaining) {
    throw fail(`only ${now.remaining} is still owed on ${sale.id}`, 'overpaid',
               { remaining: now.remaining, currency: sale.currency });
  }

  const at = nowIso();
  const drawer = m.drawer ? 1 : 0;
  const inShop = !!(drawer && handedIn);
  const shift = inShop ? currentShift(d) : null;

  const info = d.prepare(
    `INSERT INTO order_payments
       (sale_id, kind, at, amount, currency, fx_rate, amount_order, method, drawer,
        txn_ref, stage, received_by, shift_id, handed_in_at, handed_in_by, note,
        user_id, created_at)
     VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sale.id, at, amt, cur, usdTo(cur), inOrder, m.id, drawer,
        ref, stage || null, receivedBy ?? userId ?? null,
        shift ? shift.id : null, inShop ? at : null, inShop ? (userId ?? null) : null,
        note ? String(note).trim().slice(0, 300) : null, userId ?? null, at);

  const id = Number(info.lastInsertRowid);
  logChange('order_payments', id, 'insert', userId, `${m.id} ${amt} ${cur} for ${sale.id}`);

  if (spender) {
    creditRow(d, {
      customerId: spender, kind: 'spend', amount: amt, currency: cur,
      saleId: sale.id, note: `spent on ${sale.id}`, userId
    });
  }

  return {
    id, at, amount: amt, currency: cur, amountOrder: inOrder, method: m.id,
    txnRef: ref, drawer: !!drawer, shiftId: shift ? shift.id : null,
    pending: !!drawer && !inShop,
    /* Cash that reached the shop with no drawer open — the screen says so. */
    noShift: inShop && !shift
  };
}

/* Cash that changed hands when the parcel arrived. Called by
   Deliveries.update inside its own transaction. */
export function takeOnReceipt(d, saleId, { travel, amount, userId, receivedBy, handedIn }) {
  const sale = d.prepare('SELECT id, total, currency FROM sales WHERE id = ?').get(saleId);
  return takePayment(d, sale, settings(d), {
    amount, currency: sale.currency, method: 'cash',
    stage: travel === 'pickup' ? 'pickup' : 'door',
    userId, receivedBy, handedIn, atDesk: false
  });
}

/* ------------------------------------------------------------------- fees */

function sameCity(row, city) {
  const c = String(city || '').trim().toLowerCase();
  if (!c) return false;
  return [row.id, row.city_en, row.city_ar]
    .some((v) => String(v || '').trim().toLowerCase() === c);
}

/* The price list's answer for a destination, in `currency`. A row for this
   city beats a row for the whole country; a row for this method beats one
   for every method. Null when the list has nothing to say. */
export function feeFor(s, { country, city, method }, currency) {
  const scored = [];
  for (const r of s.prices) {
    if (!r || r.active === false || r.country !== country) continue;
    if (r.method && r.method !== method) continue;
    const hasCity = !!(r.city_en || r.city_ar);
    if (hasCity && !sameCity(r, city)) continue;
    scored.push({ r, n: (hasCity ? 2 : 0) + (r.method ? 1 : 0) });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.n - a.n);

  const r = scored[0].r;
  const fee = Math.max(0, Math.round(Number(r.fee) || 0));
  return {
    fee: currency && r.currency && r.currency !== currency ? convertAt(fee, r.currency, currency) : fee,
    feeMode: r.fee_mode === 'courier' ? 'courier' : 'invoice',
    rowId: r.id || null
  };
}

/* ------------------------------------------------------------------ create */

export function create({
  lines, whId = null, customerId, currency = null, discount = 0, channel = null, note = null,
  dest = {}, method, companyId = null, driverId = null, trackingNo = null,
  feeMode = null, fee = null, plan, payments = [],
  userId, unlimitedDiscount = false, opId = null
}) {
  if (!METHODS.includes(method)) throw fail('how is this order travelling?', 'bad_travel');
  if (!PLANS.includes(plan)) {
    throw fail('say how it is being paid — in full, a deposit, or on receipt', 'bad_plan');
  }
  if (plan === 'receipt' && !ON_RECEIPT.includes(method)) {
    throw fail('other cities and abroad are paid before sending — only our driver or a pickup is paid on receipt',
               'receipt_not_allowed');
  }
  if (!customerId) {
    throw fail('an order needs a customer — somebody to call and send it to', 'needs_customer');
  }
  const address = method === 'pickup' ? '' : String(dest.address || '').trim();
  if (method !== 'pickup' && !address) {
    throw fail('where is it going? an address is needed', 'bad_destination');
  }
  if (!Array.isArray(payments)) throw fail('payments must be a list', 'bad_request');
  if (companyId && driverId) throw fail('a driver or a company, not both', 'bad_request');

  return tx((d) => {
    /* Inside the transaction, where BEGIN IMMEDIATE makes the check hold. */
    if (opId) {
      const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
      if (seen) return { ...JSON.parse(seen.result), replayed: true };
    }

    const s = settings(d);

    const country = method === 'pickup' ? null
      : (String(dest.country || '').trim().toUpperCase() || null);
    if (country && !s.countries.some((c) => c && c.id === country && c.active !== false)) {
      throw fail(`orders do not go to ${country} — add it in Settings`, 'bad_destination');
    }
    const city = method === 'pickup' ? null : (String(dest.city || '').trim().slice(0, 80) || null);

    let company = null;
    if (companyId) {
      if (!COMPANY_METHODS.includes(method)) {
        throw fail('only a transport office, a courier or a shipment abroad has a company', 'method_mismatch');
      }
      company = s.companies.find((c) => c && c.id === companyId && c.active !== false);
      if (!company) throw fail('no such company — add it in Settings', 'bad_company');
    }

    if (driverId) {
      if (method !== 'driver') throw fail('only our own driver takes a run', 'method_mismatch');
      const drv = d.prepare('SELECT id, active, role FROM users WHERE id = ?').get(driverId);
      if (!drv || drv.role !== 'delivery' || !drv.active) throw fail('no such driver', 'bad_driver');
    }

    /* The sale. `order` is never a drawer method, so nothing here is counted
       as cash — the payments below are. */
    const sale = Sales.recordIn(d, {
      lines, whId: whId || s.wh, customerId, payment: 'order', discount, currency, note,
      userId, unlimitedDiscount, opId: null
    });

    /* The shipping fee, in the sale's currency. Typed beats listed; a pickup
       has none. */
    let feeAmt = 0;
    let mode = feeMode === 'courier' ? 'courier' : 'none';
    let source = null;
    if (method !== 'pickup' && feeMode !== 'none') {
      const typed = fee !== null && fee !== undefined && fee !== '';
      if (typed) {
        feeAmt = Math.round(Number(fee));
        if (!Number.isFinite(feeAmt) || feeAmt < 0) throw fail('the shipping fee cannot be negative', 'bad_fee');
        source = 'manual';
        if (feeMode !== 'courier') mode = 'invoice';
      } else {
        const listed = feeFor(s, { country, city, method }, sale.currency);
        if (listed) {
          feeAmt = listed.fee;
          source = 'list';
          if (feeMode !== 'courier') mode = listed.feeMode;
        }
      }
      if (!feeAmt && mode === 'invoice') mode = 'none';
    }

    const at = sale.at;
    const info = d.prepare(
      `INSERT INTO deliveries
         (sale_id, driver_id, status, address, phone, note, to_collect, collected, currency,
          assigned_at, assigned_by, method, company_id, company_name, country, city, recipient,
          fee, fee_mode, fee_source, plan, channel, tracking_no)
       VALUES (?, ?, 'waiting', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sale.id, driverId || null, address,
          String(dest.phone || '').trim().slice(0, 40) || null,
          note ? String(note).trim().slice(0, 500) : null,
          sale.currency, at, userId ?? null, method,
          company ? company.id : null,
          /* Frozen, like sales.customer_name. */
          company ? (company.en || company.ar || company.id) : null,
          country, city,
          String(dest.recipient || '').trim().slice(0, 80) || null,
          feeAmt, mode, source, plan,
          CHANNELS.includes(channel) ? channel : null,
          String(trackingNo || '').trim().slice(0, 64) || null);
    const deliveryId = Number(info.lastInsertRowid);

    /* What came in with the order. */
    const taken = [];
    for (const p of payments) {
      if (!p) continue;
      taken.push(takePayment(d, sale, s, {
        amount: p.amount, currency: p.currency, method: p.method, txnRef: p.txnRef,
        stage: plan === 'full' ? 'full' : 'deposit', note: p.note,
        userId, handedIn: true
      }));
    }

    const m = money(d, sale.id);
    if (plan === 'full' && m.remaining > 0) {
      throw fail(`"Paid in full", but ${m.remaining} is still owed — take the rest or choose a deposit`,
                 'plan_full_unpaid', { remaining: m.remaining, currency: m.currency });
    }
    if (plan === 'deposit' && !taken.length) {
      throw fail('a deposit plan needs the deposit', 'plan_deposit_empty');
    }

    /* What our driver, or the counter at a pickup, still has to take. Never
       from the request. Companies collect nothing. */
    if (ON_RECEIPT.includes(method) && m.remaining > 0) {
      d.prepare('UPDATE deliveries SET to_collect = ? WHERE id = ?').run(m.remaining, deliveryId);
    }

    /* Remember where it went, on a customer who had no address — never over
       one somebody typed deliberately. */
    if (address) {
      const touched = d.prepare(
        `UPDATE customers
            SET address = ?, city = COALESCE(NULLIF(city, ''), ?), updated_at = ?
          WHERE id = ? AND (address IS NULL OR address = '')`
      ).run(address, city, at, customerId);
      if (touched.changes > 0) {
        logChange('customers', String(customerId), 'update', userId, `address from ${sale.id}`);
      }
    }

    logChange('deliveries', String(deliveryId), 'insert', userId, `order ${sale.id}`);

    const result = { sale, deliveryId, money: m, payments: taken };
    if (opId) {
      d.prepare(
        `INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?, ?, ?, 'order', ?)`
      ).run(opId, at, userId ?? null, JSON.stringify(result));
    }
    return result;
  });
}

/* ---------------------------------------------------------- later payments */

function orderSale(d, saleId) {
  const sale = d.prepare('SELECT id, total, currency, payment, voided FROM sales WHERE id = ?').get(saleId);
  if (!sale || sale.payment !== 'order') throw fail('no such order', 'not_found');
  if (sale.voided) throw fail(`${saleId} was cancelled`, 'voided');
  return sale;
}

/* The rest of a deposit, a transfer that arrived the next morning. */
export function pay(saleId, { amount, currency, method, txnRef, stage, note, opId = null }, user) {
  return tx((d) => {
    if (opId) {
      const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
      if (seen) return { ...JSON.parse(seen.result), replayed: true };
    }

    const sale = orderSale(d, saleId);
    const taken = takePayment(d, sale, settings(d), {
      amount, currency, method, txnRef, stage: stage || 'rest', note,
      userId: user.id, handedIn: true
    });
    const m = money(d, saleId);

    /* A transfer while the driver is on his way lowers what he collects. It
       can only ever go down: the balance cannot rise after a payment. */
    const row = d.prepare('SELECT id, method, status FROM deliveries WHERE sale_id = ?').get(saleId);
    if (row && ON_RECEIPT.includes(row.method) && ['waiting', 'out'].includes(row.status)) {
      d.prepare('UPDATE deliveries SET to_collect = ? WHERE id = ?').run(m.remaining, row.id);
      logChange('deliveries', String(row.id), 'update', user.id, `to collect ${m.remaining} after a payment`);
    }

    const out = { saleId, payment: taken, money: m };
    if (opId) {
      d.prepare(
        `INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?, ?, ?, 'order_payment', ?)`
      ).run(opId, nowIso(), user.id, JSON.stringify(out));
    }
    return out;
  });
}

/* The driver is back and the cash is on the counter. Stamps every piece of
   door cash on this order still in somebody's hand with the open drawer. */
export function handIn(saleId, user, opId = null) {
  return tx((d) => {
    if (opId) {
      const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
      if (seen) return { ...JSON.parse(seen.result), replayed: true };
    }

    orderSale(d, saleId);
    const pending = d.prepare(
      `SELECT id FROM order_payments
        WHERE sale_id = ? AND kind = 'in' AND drawer = 1 AND handed_in_at IS NULL`
    ).all(saleId);
    if (!pending.length) {
      throw fail('nothing from this order is waiting to be handed in', 'nothing_pending');
    }

    const shift = currentShift(d);
    const at = nowIso();
    const stamp = d.prepare(
      'UPDATE order_payments SET handed_in_at = ?, handed_in_by = ?, shift_id = ? WHERE id = ?'
    );
    for (const p of pending) {
      stamp.run(at, user.id, shift ? shift.id : null, p.id);
      logChange('order_payments', p.id, 'update', user.id, 'handed in');
    }

    const out = {
      saleId, handedIn: pending.length, shiftId: shift ? shift.id : null,
      noShift: !shift, money: money(d, saleId)
    };
    if (opId) {
      d.prepare(
        `INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?, ?, ?, 'order_handin', ?)`
      ).run(opId, at, user.id, JSON.stringify(out));
    }
    return out;
  });
}

/* Where this customer's last order went, for "use last address". */
export function lastDestination(customerId) {
  const r = get().prepare(
    `SELECT d.method, d.company_id, d.country, d.city, d.address, d.recipient, d.phone
       FROM deliveries d JOIN sales s ON s.id = d.sale_id
      WHERE s.customer_id = ? AND d.address <> ''
      ORDER BY d.assigned_at DESC, d.id DESC LIMIT 1`
  ).get(customerId);
  return r ? {
    method: r.method, companyId: r.company_id, country: r.country, city: r.city,
    address: r.address, recipient: r.recipient, phone: r.phone
  } : null;
}

/* ============================================================= the handover
   The driver or the courier is standing at the counter with an armful of
   bags. The office scans each slip onto a sheet, prints it, they sign it, and
   every parcel on it leaves in ONE transaction — through exactly the guards a
   single parcel goes through from the board.

   IT IS ALL OR NOTHING, and that is the kind thing. A parcel that cannot go
   (a company sheet with money still owed on it) is named BEFORE anything
   moves, so the person takes it off the pile and the rest leave together.
   Handing over half a sheet and telling somebody afterwards which half is how
   a parcel gets carried to Damascus unpaid. */

function nextHandoverId(d) {
  const top = d.prepare(
    "SELECT MAX(CAST(SUBSTR(id, 4) AS INTEGER)) AS m FROM handovers WHERE id GLOB 'HO-[0-9]*'"
  ).get().m;
  return 'HO-' + String((top || 0) + 1).padStart(4, '0');
}

const HANDOVER_SELECT =
  `SELECT h.*, u.name AS driver_name,
          (SELECT COUNT(*) FROM handover_lines l WHERE l.handover_id = h.id) AS parcels
     FROM handovers h LEFT JOIN users u ON u.id = h.driver_id`;

function handoverLines(d, id) {
  return d.prepare(
    `SELECT l.id, l.delivery_id, l.sale_id, l.to_collect, l.currency, l.at,
            d.status, d.method, d.city, d.country, d.address, d.phone, d.company_name,
            s.customer_name, s.voided,
            (s.total + CASE WHEN d.fee_mode = 'invoice' THEN d.fee ELSE 0 END) AS due,
            COALESCE((SELECT SUM(CASE WHEN kind = 'in' THEN amount_order ELSE -amount_order END)
                        FROM order_payments WHERE sale_id = d.sale_id), 0) AS paid
       FROM handover_lines l
       JOIN deliveries d ON d.id = l.delivery_id
       JOIN sales s ON s.id = l.sale_id
      WHERE l.handover_id = ?
      ORDER BY l.id`
  ).all(id).map((r) => ({
    ...r,
    voided: !!r.voided,
    remaining: r.voided ? 0 : Math.max(0, r.due - r.paid)
  }));
}

export function handover(id, d = get()) {
  const h = d.prepare(`${HANDOVER_SELECT} WHERE h.id = ?`).get(id);
  if (!h) return null;
  const lines = handoverLines(d, id);
  /* What the carrier is signing for, per currency — never one number across
     two of them. */
  const collect = {};
  for (const l of lines) {
    if (!l.remaining) continue;
    collect[l.currency] = (collect[l.currency] || 0) + (h.status === 'handed' ? l.to_collect : l.remaining);
  }
  return { ...h, lines, collect, blocked: lines.filter((l) => blockedReason(h, l)).map((l) => ({
    saleId: l.sale_id, why: blockedReason(h, l), remaining: l.remaining, currency: l.currency
  })) };
}

/* Why this parcel cannot leave on this sheet — the same three rules
   Deliveries.update enforces, asked before anybody signs anything. */
function blockedReason(h, line) {
  if (line.voided) return 'voided';
  if (line.status !== 'waiting') return 'already_' + line.status;
  if (h.kind === 'company' && line.remaining > 0) return 'unpaid_before_send';
  return null;
}

export function handoverList({ status = null, limit = 20 } = {}) {
  const d = get();
  const where = status && status !== 'all' ? ' WHERE h.status = ?' : '';
  const rows = d.prepare(
    `${HANDOVER_SELECT}${where} ORDER BY h.opened_at DESC LIMIT ?`
  ).all(...(where ? [status] : []), Math.max(1, Math.min(100, Number(limit) || 20)));
  return rows;
}

export function openHandover({ kind, driverId = null, companyId = null, userId, userName }) {
  if (kind !== 'driver' && kind !== 'company') throw fail('a driver or a company', 'bad_request');
  return tx((d) => {
    /* One open sheet per carrier: two half-filled sheets for the same driver
       is how a parcel ends up on neither. */
    const open = d.prepare(
      `SELECT id FROM handovers WHERE status = 'open' AND kind = ?
        AND ((driver_id IS NOT NULL AND driver_id = ?) OR (company_id IS NOT NULL AND company_id = ?))`
    ).get(kind, driverId, companyId);
    if (open) return handover(open.id, d);

    let company = null;
    if (kind === 'company') {
      company = settings(d).companies.find((c) => c && c.id === companyId && c.active !== false);
      if (!company) throw fail('no such company — add it in Settings', 'bad_company');
    } else {
      const drv = d.prepare('SELECT id, name, active, role FROM users WHERE id = ?').get(driverId);
      if (!drv || drv.role !== 'delivery' || !drv.active) throw fail('no such driver', 'bad_driver');
    }

    const id = nextHandoverId(d);
    const at = nowIso();
    d.prepare(
      `INSERT INTO handovers (id, kind, driver_id, company_id, company_name, status,
                              opened_at, user_id, user_name)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`
    ).run(id, kind, kind === 'driver' ? driverId : null,
          company ? company.id : null, company ? (company.en || company.ar || company.id) : null,
          at, userId ?? null, userName ?? null);
    logChange('handovers', id, 'insert', userId, `${kind} handover opened`);
    return handover(id, d);
  });
}

/* Scanning a slip onto the sheet. The code may be an invoice number or a
   delivery id; both end at one parcel. */
export function addToHandover(id, saleId, user) {
  return tx((d) => {
    const h = d.prepare('SELECT * FROM handovers WHERE id = ?').get(id);
    if (!h) throw fail('no such handover', 'not_found');
    if (h.status !== 'open') throw fail('that sheet has already been handed over', 'bad_status');

    const row = d.prepare(
      `SELECT d.id, d.sale_id, d.status, d.method, d.currency, d.fee, d.fee_mode, s.total, s.voided
         FROM deliveries d JOIN sales s ON s.id = d.sale_id
        WHERE d.sale_id = ?`
    ).get(saleId);
    if (!row) throw fail(`nothing to hand over for ${saleId}`, 'not_found');
    if (row.voided) throw fail(`${saleId} was cancelled`, 'voided');
    if (row.method === 'pickup') throw fail('a pickup is collected from the shop — it goes on no sheet', 'method_mismatch');
    if (row.status !== 'waiting') throw fail(`${saleId} is already ${row.status}`, 'bad_status');

    const already = d.prepare(
      'SELECT handover_id FROM handover_lines WHERE delivery_id = ?').get(row.id);
    if (already && already.handover_id === id) return handover(id, d);   /* a double tap */
    if (already) throw fail(`${saleId} is already on sheet ${already.handover_id}`, 'on_another_sheet');

    const m = money(d, row.sale_id);
    d.prepare(
      `INSERT INTO handover_lines (handover_id, delivery_id, sale_id, to_collect, currency, at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, row.id, row.sale_id,
          /* What this carrier would collect: a company collects nothing. */
          h.kind === 'company' ? 0 : m.remaining, row.currency, nowIso());
    const lineId = d.prepare('SELECT last_insert_rowid() AS id').get().id;
    logChange('handover_lines', lineId, 'insert', user ? user.id : null, `${row.sale_id} on ${id}`);
    logChange('handovers', id, 'update', user ? user.id : null, null);
    return handover(id, d);
  });
}

export function removeFromHandover(id, deliveryId, user) {
  return tx((d) => {
    const h = d.prepare('SELECT status FROM handovers WHERE id = ?').get(id);
    if (!h) throw fail('no such handover', 'not_found');
    if (h.status !== 'open') throw fail('that sheet has already been handed over', 'bad_status');
    const line = d.prepare(
      'SELECT id FROM handover_lines WHERE handover_id = ? AND delivery_id = ?').get(id, deliveryId);
    if (!line) throw fail('that parcel is not on this sheet', 'not_found');
    d.prepare('DELETE FROM handover_lines WHERE id = ?').run(line.id);
    logChange('handover_lines', line.id, 'delete', user ? user.id : null, null);
    logChange('handovers', id, 'update', user ? user.id : null, null);
    return handover(id, d);
  });
}

/* They signed. Everything on the sheet leaves together. */
export function handOver(id, user, opId = null) {
  return tx((d) => {
    if (opId) {
      const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
      if (seen) return { ...JSON.parse(seen.result), replayed: true };
    }

    const h = d.prepare('SELECT * FROM handovers WHERE id = ?').get(id);
    if (!h) throw fail('no such handover', 'not_found');
    if (h.status !== 'open') throw fail('that sheet has already been handed over', 'bad_status');

    const lines = handoverLines(d, id);
    if (!lines.length) throw fail('there is nothing on this sheet', 'empty');

    const blocked = lines.map((l) => ({ line: l, why: blockedReason(h, l) })).filter((x) => x.why);
    if (blocked.length) {
      throw fail(
        `${blocked.length} parcel(s) cannot go: ` +
        blocked.map((b) => `${b.line.sale_id} (${b.why})`).join(', '),
        'handover_blocked',
        { blocked: blocked.map((b) => ({ saleId: b.line.sale_id, why: b.why, remaining: b.line.remaining })) });
    }

    const at = nowIso();
    const setOut = d.prepare(
      `UPDATE deliveries
          SET status = 'out', out_at = ?, handover_id = ?, to_collect = ?,
              driver_id = ?, company_id = COALESCE(?, company_id),
              company_name = COALESCE(?, company_name),
              method = CASE WHEN ? IS NULL THEN method ELSE ? END
        WHERE id = ?`
    );
    const kind = h.kind === 'company'
      ? (settings(d).companies.find((c) => c && c.id === h.company_id) || {}).kind || 'courier'
      : null;

    for (const l of lines) {
      /* Frozen as it leaves — the sheet is a receipt for a person carrying
         money, and a payment tomorrow must not rewrite what they signed. */
      const toCollect = h.kind === 'company' ? 0 : l.remaining;
      setOut.run(at, id, toCollect,
                 h.kind === 'driver' ? h.driver_id : null,
                 h.kind === 'company' ? h.company_id : null,
                 h.kind === 'company' ? h.company_name : null,
                 kind, kind, l.delivery_id);
      d.prepare('UPDATE handover_lines SET to_collect = ? WHERE handover_id = ? AND delivery_id = ?')
        .run(toCollect, id, l.delivery_id);
      logChange('deliveries', String(l.delivery_id), 'update', user ? user.id : null, `out on ${id}`);
    }

    d.prepare("UPDATE handovers SET status = 'handed', handed_at = ? WHERE id = ?").run(at, id);
    logChange('handovers', id, 'update', user ? user.id : null, 'handed over');

    const out = { id, parcels: lines.length, at };
    if (opId) {
      d.prepare(
        `INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?, ?, ?, 'handover', ?)`
      ).run(opId, at, user ? user.id : null, JSON.stringify(out));
    }
    return { ...out, handover: handover(id, d) };
  });
}

export function cancelHandover(id, user) {
  return tx((d) => {
    const h = d.prepare('SELECT status FROM handovers WHERE id = ?').get(id);
    if (!h) throw fail('no such handover', 'not_found');
    if (h.status !== 'open') throw fail('that sheet has already been handed over', 'bad_status');
    d.prepare("UPDATE handovers SET status = 'cancelled' WHERE id = ?").run(id);
    logChange('handovers', id, 'update', user ? user.id : null, 'cancelled');
    return handover(id, d);
  });
}

/* ======================================================== the driver's cash
   At the end of the day the driver empties his pockets. Every payment he took
   at a door is sitting with `handed_in_at` NULL — the shop's way of saying
   the money is real and not here yet — and this is where it arrives.

   Per currency, never one number: a driver carrying 400,000 lira and $60 is
   carrying two things, and adding them at today's rate would make a count on
   a counter disagree with the screen. */

export function driverCash(driverId = null) {
  const d = get();
  const where = driverId ? 'AND p.received_by = ?' : '';
  const args = driverId ? [driverId] : [];
  const totals = d.prepare(
    `SELECT p.received_by AS driverId, u.name AS driverName, p.currency,
            SUM(p.amount) AS amount, COUNT(*) AS parcels, MIN(p.at) AS since
       FROM order_payments p LEFT JOIN users u ON u.id = p.received_by
      WHERE p.kind = 'in' AND p.drawer = 1 AND p.handed_in_at IS NULL ${where}
      GROUP BY p.received_by, p.currency
      ORDER BY u.name, p.currency`
  ).all(...args);

  const rows = d.prepare(
    `SELECT p.id, p.sale_id AS saleId, p.at, p.amount, p.currency, p.method,
            p.received_by AS driverId, u.name AS driverName,
            s.customer_name AS customer, dl.city, dl.address, dl.status
       FROM order_payments p
       LEFT JOIN users u ON u.id = p.received_by
       JOIN sales s ON s.id = p.sale_id
       LEFT JOIN deliveries dl ON dl.sale_id = p.sale_id
      WHERE p.kind = 'in' AND p.drawer = 1 AND p.handed_in_at IS NULL ${where}
      ORDER BY p.at LIMIT 200`
  ).all(...args);

  return { totals, rows, shift: currentShift(d) || null };
}

/* The whole pile at once. `saleIds` narrows it to the parcels actually on the
   counter — a driver may hand in this morning's and keep this afternoon's. */
export function handInFor(driverId, { saleIds = null, opId = null } = {}, user) {
  return tx((d) => {
    if (opId) {
      const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
      if (seen) return { ...JSON.parse(seen.result), replayed: true };
    }

    const ids = Array.isArray(saleIds) && saleIds.length ? saleIds.map(String) : null;
    const marks = ids ? ids.map(() => '?').join(',') : '';
    const pending = d.prepare(
      `SELECT id, sale_id, amount, currency FROM order_payments
        WHERE kind = 'in' AND drawer = 1 AND handed_in_at IS NULL AND received_by = ?
          ${ids ? `AND sale_id IN (${marks})` : ''}`
    ).all(driverId, ...(ids || []));
    if (!pending.length) throw fail('there is no cash waiting from this driver', 'nothing_pending');

    const shift = currentShift(d);
    const at = nowIso();
    const stamp = d.prepare(
      'UPDATE order_payments SET handed_in_at = ?, handed_in_by = ?, shift_id = ? WHERE id = ?'
    );
    const took = {};
    for (const p of pending) {
      stamp.run(at, user.id, shift ? shift.id : null, p.id);
      logChange('order_payments', p.id, 'update', user.id, `handed in by driver ${driverId}`);
      took[p.currency] = (took[p.currency] || 0) + p.amount;
    }

    const out = {
      driverId, payments: pending.length, took,
      orders: [...new Set(pending.map((p) => p.sale_id))],
      shiftId: shift ? shift.id : null, noShift: !shift, at
    };
    if (opId) {
      d.prepare(
        `INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?, ?, ?, 'driver_handin', ?)`
      ).run(opId, at, user.id, JSON.stringify(out));
    }
    return out;
  });
}

/* ====================================================== money the shop owes
   A ledger, never a balance column: a grant when a return is kept as credit,
   a spend when a later order uses it, and what is left is the difference. */

function creditIn(d, customerId, currency) {
  return d.prepare(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'grant' THEN amount ELSE -amount END), 0) AS n
       FROM customer_credit WHERE customer_id = ? AND currency = ?`
  ).get(customerId, currency).n;
}

function creditRow(d, { customerId, kind, amount, currency, saleId, note, userId }) {
  const at = nowIso();
  const info = d.prepare(
    `INSERT INTO customer_credit
       (customer_id, at, kind, amount, currency, sale_id, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(customerId, at, kind, amount, currency, saleId || null,
        note ? String(note).slice(0, 300) : null, userId ?? null, at);
  const id = Number(info.lastInsertRowid);
  logChange('customer_credit', id, 'insert', userId, `${kind} ${amount} ${currency}`);
  return id;
}

/* What this customer has with the shop, and where it came from. */
export function credit(customerId) {
  const d = get();
  const balances = d.prepare(
    `SELECT currency,
            SUM(CASE WHEN kind = 'grant' THEN amount ELSE -amount END) AS amount
       FROM customer_credit WHERE customer_id = ?
      GROUP BY currency HAVING amount <> 0 ORDER BY currency`
  ).all(customerId);
  const rows = d.prepare(
    `SELECT id, at, kind, amount, currency, sale_id AS saleId, note
       FROM customer_credit WHERE customer_id = ? ORDER BY at DESC, id DESC LIMIT 50`
  ).all(customerId);
  return { balances, rows };
}

/* =============================================================== the return
   The parcel came back. Four decisions, and the owner said the shop uses all
   four case by case: send another size, keep the money as credit, refund it,
   or keep the shipping and refund the rest.

   ONE MECHANISM UNDERNEATH ALL FOUR. The pieces go back on the shelf through
   the ordinary movement log, what came back stops being owed (`due_minor`, at
   the price it was SOLD at), and any money the shop is then holding above
   what is still owed leaves through a refund row — as cash, as a transfer, or
   as shop credit, which is the same money staying where it is with the
   customer's name on it. So every outcome lands the order at nil, and the
   four differ only in where the money went and whether the shipping stayed
   owed. */

const OUTCOMES = ['exchange', 'credit', 'refund', 'keep_fee'];

/* Money out. Mirrors takePayment, and the guard is its opposite: a refund can
   never be larger than what the shop is actually holding. */
function refundOut(d, sale, s, { amount, currency, method, txnRef, note, userId, stage }) {
  const m = s.methods.find((x) => x && x.id === method);
  if (!m || m.active === false) throw fail(`there is no '${method}' payment method`, 'bad_method');

  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw fail('a refund has to be more than nothing', 'bad_request');

  const cur = currency || sale.currency;
  if (!d.prepare('SELECT 1 FROM currencies WHERE code = ?').get(cur)) {
    throw fail(`unknown currency: ${cur}`, 'bad_currency');
  }
  const ref = String(txnRef ?? '').trim().slice(0, 64) || null;
  if (m.ref && !ref) throw fail(`${m.en || m.id} needs its transfer reference`, 'ref_required');

  const outOrder = convertAt(amt, cur, sale.currency);
  const held = money(d, sale.id).paid;
  if (outOrder > held) {
    throw fail(`the shop is only holding ${held} on ${sale.id}`, 'refund_too_big',
               { held, currency: sale.currency });
  }

  const at = nowIso();
  const drawer = m.drawer ? 1 : 0;
  const shift = drawer ? currentShift(d) : null;
  const info = d.prepare(
    `INSERT INTO order_payments
       (sale_id, kind, at, amount, currency, fx_rate, amount_order, method, drawer,
        txn_ref, stage, received_by, shift_id, handed_in_at, handed_in_by, note,
        user_id, created_at)
     VALUES (?, 'refund', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sale.id, at, amt, cur, usdTo(cur), outOrder, m.id, drawer,
        ref, stage || 'return', userId ?? null, shift ? shift.id : null,
        drawer ? at : null, drawer ? (userId ?? null) : null,
        note ? String(note).slice(0, 300) : null, userId ?? null, at);
  const id = Number(info.lastInsertRowid);
  logChange('order_payments', id, 'insert', userId, `refund ${amt} ${cur} on ${sale.id}`);

  return {
    id, at, amount: amt, currency: cur, amountOrder: outOrder, method: m.id,
    txnRef: ref, drawer: !!drawer, shiftId: shift ? shift.id : null,
    /* Cash out of a drawer nobody has opened. Real, and said so. */
    noShift: !!drawer && !shift
  };
}

/* What is left to come back, per line: sold minus already returned. */
export function returnable(saleId, d = get()) {
  const items = d.prepare(
    `SELECT sku, name, size, qty, unit_price FROM sale_items WHERE sale_id = ? ORDER BY id`
  ).all(saleId);
  const done = {};
  for (const r of d.prepare(
    'SELECT id FROM order_returns WHERE sale_id = ?').all(saleId)) {
    for (const l of d.prepare(
      'SELECT sku, qty FROM order_return_lines WHERE return_id = ?').all(r.id)) {
      done[l.sku] = (done[l.sku] || 0) + l.qty;
    }
  }
  return items.map((it) => ({
    ...it, returned: done[it.sku] || 0, left: Math.max(0, it.qty - (done[it.sku] || 0))
  }));
}

export function returnsFor(saleId, d = get()) {
  const rows = d.prepare(
    `SELECT r.*, u.name AS user_name FROM order_returns r
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.sale_id = ? ORDER BY r.at`
  ).all(saleId);
  const lines = d.prepare('SELECT * FROM order_return_lines WHERE return_id = ?');
  return rows.map((r) => ({ ...r, lines: lines.all(r.id) }));
}

export function takeBack(saleId, {
  outcome, lines = [], whId = null, reason = null, note = null,
  amount = null, currency = null, method = 'cash', txnRef = null,
  opId = null
}, user) {
  if (!OUTCOMES.includes(outcome)) {
    throw fail('say what happens to the money — exchange, credit, refund, or keep the shipping',
               'bad_outcome');
  }
  if (!Array.isArray(lines) || !lines.length) {
    throw fail('which pieces came back?', 'no_lines');
  }

  return tx((d) => {
    if (opId) {
      const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
      if (seen) return { ...JSON.parse(seen.result), replayed: true };
    }

    const sale = orderSale(d, saleId);
    const s = settings(d);
    const dl = d.prepare(
      'SELECT id, status, method, fee, fee_mode FROM deliveries WHERE sale_id = ?').get(saleId);
    const before = money(d, saleId);

    /* ---- the pieces ---------------------------------------------------- */
    const left = {};
    for (const r of returnable(saleId, d)) left[r.sku] = r;

    /* Back where they came from unless somebody says otherwise: the sale
       knows which place it was picked from, and a configured default would
       quietly move stock between rooms on every return. */
    const from = d.prepare('SELECT wh_id FROM sales WHERE id = ?').get(saleId);
    const place = String(whId || (from && from.wh_id) || s.wh);
    if (!d.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(place)) {
      throw fail('there is no such place to put them back', 'bad_warehouse');
    }

    const back = [];
    let goods = 0;
    for (const l of lines) {
      const sku = String(l && l.sku || '');
      const qty = Math.round(Number(l && l.qty));
      const row = left[sku];
      if (!row) throw fail(`${sku} was not on ${saleId}`, 'not_on_order');
      if (!Number.isInteger(qty) || qty <= 0) throw fail(`how many of ${sku}?`, 'bad_qty');
      if (qty > row.left) {
        throw fail(row.left
          ? `only ${row.left} of ${sku} can still come back`
          : `every ${sku} on ${saleId} has already come back`, 'too_many', { left: row.left });
      }
      back.push({ sku, qty, name: row.name, size: row.size, unitPrice: row.unit_price });
      goods += qty * row.unit_price;
      row.left -= qty;                       /* two lines of the same sku in one return */
    }

    /* The shipping comes off only when the whole order has come back and the
       shop is not keeping it. A courier's fee that the customer paid the
       courier directly was never on this invoice, so there is nothing to
       drop. */
    const allBack = Object.values(left).every((r) => r.left === 0);
    const fee = dl && dl.fee_mode === 'invoice' ? dl.fee : 0;
    const dropFee = allBack && outcome !== 'keep_fee' ? fee : 0;
    const dueDrop = Math.min(before.due, goods + dropFee);

    /* ---- the record ---------------------------------------------------- */
    const at = nowIso();
    const info = d.prepare(
      `INSERT INTO order_returns
         (sale_id, delivery_id, at, outcome, reason, restocked, wh_id,
          due_minor, refund_minor, kept_minor, credit_minor, new_sale_id, user_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, ?, ?)`
    ).run(saleId, dl ? dl.id : null, at, outcome,
          reason ? String(reason).slice(0, 200) : null,
          back.reduce((n, l) => n + l.qty, 0), place, dueDrop,
          user.id, note ? String(note).slice(0, 300) : null);
    const returnId = Number(info.lastInsertRowid);

    const line = d.prepare(
      `INSERT INTO order_return_lines (return_id, sku, name, size, qty, unit_price)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const l of back) {
      const lid = Number(line.run(returnId, l.sku, l.name, l.size, l.qty, l.unitPrice).lastInsertRowid);
      logChange('order_return_lines', lid, 'insert', user.id, null);
      /* Back on the shelf through the ordinary movement log — the same way
         every other piece of stock in this system moves. */
      Stock.apply(d, {
        sku: l.sku, whId: place, delta: l.qty, type: 'returned',
        note: `returned from ${saleId}${reason ? ': ' + reason : ''}`,
        userId: user.id, refType: 'return', refId: saleId
      });
    }

    /* ---- the money ----------------------------------------------------- */
    const after = money(d, saleId);           /* due has already dropped */
    const owed = after.due;
    const holding = after.paid;
    const over = Math.max(0, holding - owed);

    let asked = amount === null || amount === undefined || amount === ''
      ? over
      : Math.round(Number(amount));
    if (!Number.isFinite(asked) || asked < 0) throw fail('that is not an amount', 'bad_request');

    let out = null;
    let credited = 0;
    let refunded = 0;

    if (asked > 0) {
      if (outcome === 'credit' || outcome === 'exchange') {
        /* The cash never moves: it stops being this order's and becomes this
           person's, in the order's own currency. */
        const who = d.prepare('SELECT customer_id FROM sales WHERE id = ?').get(saleId);
        if (!who || !who.customer_id) {
          throw fail('there is no customer to hold the credit for', 'needs_customer');
        }
        out = refundOut(d, sale, s, {
          amount: asked, currency: sale.currency, method: STORE_CREDIT.id,
          note: `kept as credit from ${saleId}`, userId: user.id, stage: 'return'
        });
        creditRow(d, {
          customerId: who.customer_id, kind: 'grant', amount: out.amountOrder,
          currency: sale.currency, saleId,
          note: outcome === 'exchange' ? `exchange on ${saleId}` : `return on ${saleId}`,
          userId: user.id
        });
        credited = out.amountOrder;
      } else {
        out = refundOut(d, sale, s, {
          amount: asked, currency: currency || sale.currency, method, txnRef,
          note: `refund on ${saleId}`, userId: user.id, stage: 'return'
        });
        refunded = out.amountOrder;
      }
    }

    const settled = money(d, saleId);
    d.prepare(
      `UPDATE order_returns SET refund_minor = ?, credit_minor = ?, kept_minor = ? WHERE id = ?`
    ).run(refunded, credited, Math.min(settled.due, settled.paid), returnId);
    logChange('order_returns', returnId, 'insert', user.id, `${outcome} on ${saleId}`);

    /* Nothing is left to collect on a parcel that came back. A delivery still
       marked `out` is closed as failed — it did not arrive, whatever else
       happened to the money. */
    if (dl) {
      const closed = dl.status === 'out' ? 'failed' : dl.status;
      d.prepare(
        `UPDATE deliveries SET to_collect = ?, status = ?,
                closed_at = COALESCE(closed_at, CASE WHEN ? IN ('delivered','failed') THEN ? END)
          WHERE id = ?`
      ).run(allBack ? 0 : settled.remaining, closed, closed, at, dl.id);
      logChange('deliveries', String(dl.id), 'update', user.id, `returned (${outcome})`);
    }

    const result = {
      saleId, returnId, outcome, restocked: back, dueDrop,
      refunded, credited, money: settled, payment: out
    };
    if (opId) {
      d.prepare(
        `INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?, ?, ?, 'order_return', ?)`
      ).run(opId, at, user.id, JSON.stringify(result));
    }
    return result;
  });
}

/* An exchange is a return plus the order that replaces it. The credit the
   return granted is spent on the new one through the ordinary payment path,
   so there is one way money moves and one ledger to read. */
export function linkExchange(returnId, newSaleId, user) {
  return tx((d) => {
    const r = d.prepare('SELECT id, outcome, new_sale_id FROM order_returns WHERE id = ?').get(returnId);
    if (!r) throw fail('no such return', 'not_found');
    if (r.new_sale_id) throw fail('that return already points at an order', 'already_linked');
    if (!d.prepare('SELECT 1 FROM sales WHERE id = ?').get(newSaleId)) {
      throw fail('no such order', 'not_found');
    }
    d.prepare('UPDATE order_returns SET new_sale_id = ? WHERE id = ?').run(newSaleId, returnId);
    logChange('order_returns', returnId, 'update', user ? user.id : null, `exchanged into ${newSaleId}`);
    return { returnId, newSaleId };
  });
}

/* -------------------------------------------------------- saving settings */

const METHOD_ID = /^[a-z][a-z0-9_]{1,23}$/;
const LIST_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const text = (v, max) => String(v ?? '').trim().slice(0, max);

function methodUsed(d, id) {
  const hit = (sql) => !!d.prepare(sql).get(id);
  return hit('SELECT 1 FROM sales WHERE payment = ? LIMIT 1') ||
         hit('SELECT 1 FROM debt_payments WHERE method = ? LIMIT 1') ||
         hit('SELECT 1 FROM expenses WHERE method = ? LIMIT 1') ||
         hit('SELECT 1 FROM order_payments WHERE method = ? LIMIT 1');
}

function cleanMethods(d, list, current, bad) {
  if (!Array.isArray(list)) throw bad('methods', 'the payment methods must be a list');
  const seen = new Set();
  const out = list.map((m, i) => {
    const at = `methods[${i}]`;
    if (!m || typeof m !== 'object') throw bad(at, 'that is not a payment method');
    const id = String(m.id || '');
    if (!METHOD_ID.test(id)) {
      throw bad(`${at}.id`, `"${id}" cannot be an id — lowercase letters, digits and _`);
    }
    if (seen.has(id)) throw bad(`${at}.id`, `${id} is listed twice`);
    seen.add(id);
    const en = text(m.en, 40);
    const ar = text(m.ar, 40);
    if (!en && !ar) throw bad(`${at}.en`, `${id} needs a name`);
    const row = {
      id, en: en || ar, ar: ar || en,
      ref: !!m.ref, drawer: !!m.drawer, till: !!m.till, desk: !!m.desk, debt: !!m.debt,
      active: m.active !== false
    };
    if (SYSTEM_METHODS[id]) Object.assign(row, SYSTEM_METHODS[id], { system: true });
    return row;
  });

  for (const id of Object.keys(SYSTEM_METHODS)) {
    if (current.some((x) => x && x.id === id) && !seen.has(id)) {
      throw bad('methods', `${id} is part of how the till works and cannot be removed`);
    }
  }
  for (const gone of current) {
    if (gone && !seen.has(gone.id) && methodUsed(d, gone.id)) {
      throw bad('methods', `${gone.en || gone.id} is on past payments — switch it off instead of removing it`);
    }
  }
  if (!out.some((m) => m.active && m.desk)) {
    throw bad('methods', 'the delivery office needs at least one way to be paid');
  }
  if (!out.some((m) => m.active && m.till)) {
    throw bad('methods', 'the till needs at least one way to be paid');
  }
  return JSON.stringify(out);
}

function cleanCompanies(d, list, bad) {
  if (!Array.isArray(list)) throw bad('companies', 'the companies must be a list');
  const seen = new Set();
  const out = list.map((c, i) => {
    const at = `companies[${i}]`;
    const id = String((c && c.id) || '');
    if (!LIST_ID.test(id)) throw bad(`${at}.id`, `"${id}" cannot be an id`);
    if (seen.has(id)) throw bad(`${at}.id`, `${id} is listed twice`);
    seen.add(id);
    const en = text(c.en, 60);
    const ar = text(c.ar, 60);
    if (!en && !ar) throw bad(`${at}.en`, 'a company needs a name');
    if (!COMPANY_METHODS.includes(c.kind)) {
      throw bad(`${at}.kind`, 'a company is a transport office, a courier or abroad');
    }
    return { id, en: en || ar, ar: ar || en, kind: c.kind, phone: text(c.phone, 30) || null,
             active: c.active !== false };
  });
  const used = d.prepare(
    'SELECT DISTINCT company_id AS id FROM deliveries WHERE company_id IS NOT NULL'
  ).all();
  for (const u of used) {
    if (!seen.has(u.id)) {
      throw bad('companies', 'a company that has carried parcels cannot be removed — switch it off instead');
    }
  }
  return JSON.stringify(out);
}

function cleanCountries(list, currencies, bad) {
  if (!Array.isArray(list)) throw bad('countries', 'the countries must be a list');
  const seen = new Set();
  return JSON.stringify(list.map((c, i) => {
    const at = `countries[${i}]`;
    const id = String((c && c.id) || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(id)) throw bad(`${at}.id`, 'a country is its two-letter code');
    if (seen.has(id)) throw bad(`${at}.id`, `${id} is listed twice`);
    seen.add(id);
    const en = text(c.en, 40);
    const ar = text(c.ar, 40);
    if (!en && !ar) throw bad(`${at}.en`, `${id} needs a name`);
    if (!currencies.has(c.currency)) throw bad(`${at}.currency`, `the shop has no ${c.currency}`);
    return { id, en: en || ar, ar: ar || en, currency: c.currency,
             dial: String(c.dial || '').replace(/\D/g, '').slice(0, 4), active: c.active !== false };
  }));
}

function cleanPrices(list, countries, currencies, bad) {
  if (!Array.isArray(list)) throw bad('prices', 'the price list must be a list');
  const known = new Set(countries.filter(Boolean).map((c) => c.id));
  const seen = new Set();
  return JSON.stringify(list.map((p, i) => {
    const at = `prices[${i}]`;
    const id = String((p && p.id) || '');
    if (!LIST_ID.test(id)) throw bad(`${at}.id`, `"${id}" cannot be an id`);
    if (seen.has(id)) throw bad(`${at}.id`, `${id} is listed twice`);
    seen.add(id);
    if (!known.has(p.country)) throw bad(`${at}.country`, `orders do not go to ${p.country}`);
    if (p.method && (!METHODS.includes(p.method) || p.method === 'pickup')) {
      throw bad(`${at}.method`, 'a price is for our driver, a transport office, a courier or abroad');
    }
    const fee = Math.round(Number(p.fee));
    if (!Number.isFinite(fee) || fee < 0 || fee > 1e12) throw bad(`${at}.fee`, 'a fee is a number, not below zero');
    if (!currencies.has(p.currency)) throw bad(`${at}.currency`, `the shop has no ${p.currency}`);
    return {
      id, country: p.country, city_en: text(p.city_en, 60), city_ar: text(p.city_ar, 60),
      method: p.method || '', fee, currency: p.currency,
      fee_mode: p.fee_mode === 'courier' ? 'courier' : 'invoice', active: p.active !== false
    };
  }));
}

function cleanAccounts(obj, bad) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw bad('accounts', 'the transfer details must be keyed by payment method');
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!METHOD_ID.test(k)) throw bad(`accounts.${k}`, `"${k}" is not a payment method`);
    const en = text(v && v.en, 300);
    const ar = text(v && v.ar, 300);
    if (en || ar) out[k] = { en, ar };
  }
  return JSON.stringify(out);
}

/* One transaction for whatever the Settings folds sent. A list that fails
   validation writes nothing, so the office never reads half a price list. */
export function saveSettings(patch) {
  if (!patch || typeof patch !== 'object') throw fail('nothing to save', 'bad_settings');
  return tx((d) => {
    const s = settings(d);
    const bad = (path, message) => fail(message, 'bad_settings', { path });
    const currencies = new Set(d.prepare('SELECT code FROM currencies').all().map((r) => r.code));
    const writes = {};

    if (patch.methods !== undefined) writes['pay.methods'] = cleanMethods(d, patch.methods, s.methods, bad);
    if (patch.companies !== undefined) writes['delivery.companies'] = cleanCompanies(d, patch.companies, bad);
    if (patch.countries !== undefined) writes['delivery.countries'] = cleanCountries(patch.countries, currencies, bad);
    const countries = writes['delivery.countries'] ? JSON.parse(writes['delivery.countries']) : s.countries;
    if (patch.prices !== undefined) writes['delivery.prices'] = cleanPrices(patch.prices, countries, currencies, bad);
    if (patch.accounts !== undefined) writes['pay.accounts'] = cleanAccounts(patch.accounts, bad);
    if (patch.wh !== undefined) {
      if (!d.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(String(patch.wh))) {
        throw bad('wh', 'there is no such place');
      }
      writes['delivery.wh'] = String(patch.wh);
    }
    if (patch.print !== undefined) {
      if (!['slip', 'a4', 'both', 'none'].includes(patch.print)) throw bad('print', 'slip, a4, both or none');
      writes['delivery.print'] = patch.print;
    }

    const keys = Object.keys(writes);
    if (!keys.length) throw fail('nothing to save', 'bad_settings');

    const at = nowIso();
    const put = d.prepare(
      `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    for (const k of keys) put.run(k, writes[k], at);
    return settings(d);
  });
}
