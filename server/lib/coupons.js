/* ==========================================================================
   COUPONS — codes a customer gives at the till, in the order desk, or on the
   website, and how each one has been used                  (migration 068)
   --------------------------------------------------------------------------
   The owner asked (28 Sep 2026) for a page of his own where coupon codes are
   made, and where every code says how many people have used it.

   THREE RULES, and they are why this is on the server:

   1. A CODE IS CHECKED WHERE THE SALE IS WRITTEN. evaluate() runs inside
      Sales.record's transaction, against the basket the SERVER priced, so a
      browser cannot name its own cut any more than it can name its own
      price. The till's preview (check()) asks the same function, so what the
      cashier is shown is what the sale will do.

   2. A USE EXISTS EXACTLY WHEN ITS SALE DOES. recordUse() writes the row in
      the sale's transaction. Voiding the sale does not touch the row — a use
      is counted only while its sale is not voided (a join, never a stored
      number), so a void gives the code its use back by itself. One code per
      sale, and the unique index on sale_id means a replayed sale (the same
      opId) cannot count twice.

   3. A COUPON IS NOT THE CASHIER'S DISCOUNT. sale.max_discount_pct (10) caps
      what a person at the counter gives away; a coupon is a rule the owner
      set on purpose, so the ceiling is applied to the manual part only. The
      two together still cannot take more than the basket.

   Money: prices are dollars (067) and so is a fixed-amount coupon and the
   minimum basket — USD cents — converted at the SALE's frozen rate, the one
   written into the sale row. The cut itself is in the sale's currency.
   ========================================================================== */

import { randomBytes } from 'node:crypto';
import { get, nowIso, tx, logChange } from './db.js';
import { minorExp, convert, currentRate } from './sales.js';

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;

function fail(message, code, status = 409, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

export function normCode(code) {
  return String(code == null ? '' : code).trim().toUpperCase()
    /* An Arabic keyboard, a phone's autocorrect: spaces and the Arabic dash
       are not part of any code. */
    .replace(/[\sـ]+/g, '');
}

const iso = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};

const usd = (cents) => '$' + (cents / 100).toFixed(cents % 100 ? 2 : 0);

/* ------------------------------------------------------------- the check */

/* How many times a code has been used — on sales that still stand. */
function usesOf(d, couponId) {
  return d.prepare(
    `SELECT COUNT(*) AS n FROM coupon_uses u JOIN sales s ON s.id = u.sale_id
      WHERE u.coupon_id = ? AND s.voided = 0`
  ).get(couponId).n;
}

/* The coupon this code names, and what it takes off THIS basket — or a
   refusal that says why, in words and with a code the browser translates.

   `subtotal` is in minor units of `currency`; `rate` is USD → `currency`,
   the rate the sale freezes. */
export function evaluate(d, { code, subtotal, currency, rate, customerId = null, customerName = null, at = nowIso() }) {
  const c = normCode(code);
  if (!c) return null;
  const row = d.prepare('SELECT * FROM coupons WHERE code = ?').get(c);
  if (!row) throw fail(`There is no coupon ${c}.`, 'coupon_unknown', 409, { coupon: c });
  if (!row.active) throw fail(`${c} is switched off.`, 'coupon_off', 409, { coupon: c });
  if (row.starts_at && at < row.starts_at) {
    throw fail(`${c} starts on ${row.starts_at.slice(0, 10)}.`, 'coupon_not_yet', 409, { coupon: c, startsAt: row.starts_at });
  }
  if (row.expires_at && at > row.expires_at) {
    throw fail(`${c} ended on ${row.expires_at.slice(0, 10)}.`, 'coupon_expired', 409, { coupon: c, expiresAt: row.expires_at });
  }
  if (row.max_uses) {
    const n = usesOf(d, row.id);
    if (n >= row.max_uses) {
      throw fail(`${c} has been used ${n} times — all it was allowed.`, 'coupon_used_up', 409, { coupon: c, uses: n, maxUses: row.max_uses });
    }
  }
  if (row.once_per_customer) {
    if (customerId === null || customerId === undefined || customerId === '') {
      throw fail(`${c} is once per customer — attach the customer to the sale first.`, 'coupon_needs_customer', 409, { coupon: c });
    }
    const had = d.prepare(
      `SELECT u.sale_id FROM coupon_uses u JOIN sales s ON s.id = u.sale_id
        WHERE u.coupon_id = ? AND u.customer_id = ? AND s.voided = 0 LIMIT 1`
    ).get(row.id, Number(customerId));
    if (had) {
      throw fail(`${customerName || 'This customer'} has already used ${c} (${had.sale_id}).`,
        'coupon_used_by_customer', 409, { coupon: c, saleId: had.sale_id });
    }
  }

  const exp = minorExp(currency);
  const r = currency === 'USD' ? 1 : Number(rate);
  if (!(r > 0)) throw fail(`no exchange rate for USD/${currency} — set one in Settings`, 'no_rate', 409);

  if (row.min_basket) {
    /* The basket in USD cents at the sale's rate — the same arithmetic the
       credit limit uses (sales.js). */
    const basketUsd = currency === 'USD' ? subtotal : Math.round(subtotal / Math.pow(10, exp) / r * 100);
    if (basketUsd < row.min_basket) {
      throw fail(`${c} needs a basket of at least ${usd(row.min_basket)}.`, 'coupon_min_basket', 409,
        { coupon: c, minBasket: row.min_basket });
    }
  }

  let cut;
  if (row.kind === 'percent') cut = Math.round(subtotal * row.percent / 100);
  else cut = convert(row.amount, row.currency || 'USD', currency, r);
  cut = Math.max(0, Math.min(subtotal, cut));

  return { coupon: row, code: c, cut };
}

/* Called by Sales.record after the sale row exists (the foreign key). */
export function recordUse(d, { coupon, saleId, customerId = null, currency, cut, channel = 'till', userId = null, at = nowIso() }) {
  const ch = ['till', 'desk', 'web'].includes(channel) ? channel : 'till';
  const r = d.prepare(
    `INSERT INTO coupon_uses (coupon_id, code, sale_id, customer_id, currency, discount, channel, at, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(coupon.id, coupon.code, saleId, customerId ?? null, currency, cut, ch, at, userId ?? null);
  return Number(r.lastInsertRowid);
}

/* The till's and the desk's preview: the same evaluate(), outside a
   transaction, at the rate of the moment. Nothing is written. */
export function check({ code, subtotal, currency, customerId = null }) {
  const d = get();
  const cur = currency || d.prepare("SELECT value FROM config WHERE key = 'shop.base_currency'").get().value;
  const rate = currentRate('USD', cur);
  let name = null;
  if (customerId) {
    const cu = d.prepare('SELECT name FROM customers WHERE id = ?').get(Number(customerId));
    name = cu ? cu.name : null;
  }
  const r = evaluate(d, { code, subtotal: Math.max(0, Math.round(Number(subtotal) || 0)), currency: cur,
    rate, customerId, customerName: name });
  if (!r) throw fail('Type a code.', 'coupon_unknown', 400);
  return { code: r.code, cut: r.cut, currency: cur, coupon: publicRow(r.coupon) };
}

/* ----------------------------------------------------------------- reading */

function publicRow(c) {
  return {
    id: c.id, code: c.code, note: c.note || '', kind: c.kind,
    percent: c.percent, amount: c.amount, currency: c.currency || 'USD',
    minBasket: c.min_basket, maxUses: c.max_uses, oncePerCustomer: !!c.once_per_customer,
    startsAt: c.starts_at, expiresAt: c.expires_at, active: !!c.active,
    createdAt: c.created_at, updatedAt: c.updated_at
  };
}

/* Every code with what has happened to it. Money per currency, never added
   across currencies: a $5 cut and a 700-lira cut are not 705 of anything. */
export function list() {
  const d = get();
  const rows = d.prepare('SELECT * FROM coupons ORDER BY active DESC, created_at DESC, id DESC').all();
  const stats = new Map(d.prepare(
    `SELECT u.coupon_id AS id, COUNT(*) AS uses, COUNT(DISTINCT u.customer_id) AS people,
            SUM(CASE WHEN u.customer_id IS NULL THEN 1 ELSE 0 END) AS walkins,
            MAX(u.at) AS last_at
       FROM coupon_uses u JOIN sales s ON s.id = u.sale_id
      WHERE s.voided = 0 GROUP BY u.coupon_id`
  ).all().map((r) => [r.id, r]));
  const given = d.prepare(
    `SELECT u.coupon_id AS id, u.currency, SUM(u.discount) AS amount
       FROM coupon_uses u JOIN sales s ON s.id = u.sale_id
      WHERE s.voided = 0 GROUP BY u.coupon_id, u.currency`
  ).all();
  const channels = d.prepare(
    `SELECT u.coupon_id AS id, u.channel, COUNT(*) AS n
       FROM coupon_uses u JOIN sales s ON s.id = u.sale_id
      WHERE s.voided = 0 GROUP BY u.coupon_id, u.channel`
  ).all();
  return rows.map((c) => {
    const s = stats.get(c.id) || { uses: 0, people: 0, walkins: 0, last_at: null };
    return {
      ...publicRow(c),
      uses: s.uses, people: s.people, walkins: s.walkins, lastUsedAt: s.last_at,
      given: given.filter((g) => g.id === c.id).map((g) => ({ currency: g.currency, amount: g.amount })),
      channels: Object.fromEntries(channels.filter((x) => x.id === c.id).map((x) => [x.channel, x.n]))
    };
  });
}

/* One code and every sale it went on, newest first (the last 200, said). */
export function byId(id) {
  const d = get();
  const c = d.prepare('SELECT * FROM coupons WHERE id = ?').get(Number(id));
  if (!c) return null;
  const all = list().find((x) => x.id === c.id);
  const total = d.prepare('SELECT COUNT(*) AS n FROM coupon_uses WHERE coupon_id = ?').get(c.id).n;
  const uses = d.prepare(
    `SELECT u.id, u.sale_id, u.customer_id, u.currency, u.discount, u.channel, u.at,
            s.voided, s.total, s.currency AS sale_currency, s.customer_name,
            cu.name AS customer_now, us.name AS cashier
       FROM coupon_uses u
       JOIN sales s ON s.id = u.sale_id
       LEFT JOIN customers cu ON cu.id = u.customer_id
       LEFT JOIN users us ON us.id = u.user_id
      WHERE u.coupon_id = ?
      ORDER BY u.at DESC, u.id DESC LIMIT 200`
  ).all(c.id).map((u) => ({
    id: u.id, saleId: u.sale_id, customerId: u.customer_id,
    customerName: u.customer_name || u.customer_now || null,
    currency: u.currency, discount: u.discount, channel: u.channel, at: u.at,
    voided: !!u.voided, saleTotal: u.total, saleCurrency: u.sale_currency, cashier: u.cashier || null
  }));
  return { coupon: all, uses, shown: uses.length, total, capped: total > uses.length };
}

/* The code on a sale, for the receipt and the invoice. */
export function forSale(saleId) {
  try {
    return get().prepare('SELECT code, discount, currency FROM coupon_uses WHERE sale_id = ?').get(String(saleId)) || null;
  } catch { return null; }   // a database before 068
}

/* ----------------------------------------------------------------- writing */

/* A code nobody has to invent: OG- and five characters with no 0/O or 1/I,
   so it can be read out over the phone. */
export function suggest() {
  const d = get();
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 20; i++) {
    const b = randomBytes(5);
    let s = 'OG-';
    for (let j = 0; j < 5; j++) s += A[b[j] % A.length];
    if (!d.prepare('SELECT 1 FROM coupons WHERE code = ?').get(s)) return s;
  }
  return 'OG-' + Date.now().toString(36).toUpperCase().slice(-6);
}

function int(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

/* Every rule a code must meet, for a new one and for an edit alike. Answers
   the columns to write. */
function clean(b, was = null) {
  const code = normCode(b.code !== undefined ? b.code : was && was.code);
  if (!CODE_RE.test(code)) {
    throw fail('A code is 3 to 24 letters, digits or dashes.', 'coupon_bad_code', 400, { field: 'code' });
  }
  const kind = b.kind !== undefined ? b.kind : was && was.kind;
  if (kind !== 'percent' && kind !== 'amount') throw fail('Percent or an amount?', 'coupon_bad_kind', 400, { field: 'kind' });

  let percent = null, amount = null;
  if (kind === 'percent') {
    percent = int(b.percent !== undefined ? b.percent : was && was.percent);
    if (!(percent >= 1 && percent <= 100)) throw fail('A percent is between 1 and 100.', 'coupon_bad_percent', 400, { field: 'percent' });
  } else {
    amount = int(b.amount !== undefined ? b.amount : was && was.amount);
    if (!(amount > 0)) throw fail('Say how much it takes off.', 'coupon_bad_amount', 400, { field: 'amount' });
  }

  const pick = (k, col) => (b[k] !== undefined ? b[k] : was ? was[col] : null);
  const minBasket = int(pick('minBasket', 'min_basket'));
  if (minBasket !== null && !(minBasket > 0)) throw fail('The minimum basket must be above zero.', 'coupon_bad_min', 400, { field: 'minBasket' });
  const maxUses = int(pick('maxUses', 'max_uses'));
  if (maxUses !== null && !(maxUses > 0 && maxUses <= 1000000)) throw fail('How many times, as a whole number.', 'coupon_bad_max', 400, { field: 'maxUses' });

  const startsAt = iso(pick('startsAt', 'starts_at'));
  const expiresAt = iso(pick('expiresAt', 'expires_at'));
  if (startsAt === undefined) throw fail('That start date is not a date.', 'coupon_bad_date', 400, { field: 'startsAt' });
  if (expiresAt === undefined) throw fail('That end date is not a date.', 'coupon_bad_date', 400, { field: 'expiresAt' });
  if (startsAt && expiresAt && expiresAt <= startsAt) {
    throw fail('It has to end after it starts.', 'coupon_bad_dates', 400, { field: 'expiresAt' });
  }

  const note = String(pick('note', 'note') || '').trim().slice(0, 80) || null;
  const once = b.oncePerCustomer !== undefined ? (b.oncePerCustomer ? 1 : 0) : (was ? was.once_per_customer : 0);
  const active = b.active !== undefined ? (b.active ? 1 : 0) : (was ? was.active : 1);

  return { code, note, kind, percent, amount, currency: 'USD', min_basket: minBasket, max_uses: maxUses,
           once_per_customer: once, starts_at: startsAt, expires_at: expiresAt, active };
}

export function create(b, userId) {
  return tx((d) => {
    const v = clean(b || {});
    if (d.prepare('SELECT 1 FROM coupons WHERE code = ?').get(v.code)) {
      throw fail(`${v.code} already exists.`, 'coupon_exists', 409, { field: 'code' });
    }
    const at = nowIso();
    const r = d.prepare(
      `INSERT INTO coupons (code, note, kind, percent, amount, currency, min_basket, max_uses,
                            once_per_customer, starts_at, expires_at, active, created_at, created_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(v.code, v.note, v.kind, v.percent, v.amount, v.currency, v.min_basket, v.max_uses,
          v.once_per_customer, v.starts_at, v.expires_at, v.active, at, userId ?? null, at);
    const id = Number(r.lastInsertRowid);
    logChange('coupons', id, 'insert', userId, `coupon ${v.code}`);
    return publicRow(d.prepare('SELECT * FROM coupons WHERE id = ?').get(id));
  });
}

export function update(id, b, userId) {
  return tx((d) => {
    const was = d.prepare('SELECT * FROM coupons WHERE id = ?').get(Number(id));
    if (!was) throw fail('No such coupon.', 'not_found', 404);
    const v = clean(b || {}, was);
    if (v.code !== was.code) {
      /* A code on paper, in a message, on a receipt: once one sale carries
         it, it keeps its name. Make a new one instead. */
      const used = d.prepare('SELECT 1 FROM coupon_uses WHERE coupon_id = ? LIMIT 1').get(was.id);
      if (used) throw fail(`${was.code} has been used — its code cannot change. Make a new code instead.`, 'coupon_rename_used', 409, { field: 'code' });
      if (d.prepare('SELECT 1 FROM coupons WHERE code = ? AND id <> ?').get(v.code, was.id)) {
        throw fail(`${v.code} already exists.`, 'coupon_exists', 409, { field: 'code' });
      }
    }
    d.prepare(
      `UPDATE coupons SET code = ?, note = ?, kind = ?, percent = ?, amount = ?, currency = ?,
              min_basket = ?, max_uses = ?, once_per_customer = ?, starts_at = ?, expires_at = ?,
              active = ?, updated_at = ?
        WHERE id = ?`
    ).run(v.code, v.note, v.kind, v.percent, v.amount, v.currency, v.min_basket, v.max_uses,
          v.once_per_customer, v.starts_at, v.expires_at, v.active, nowIso(), was.id);
    logChange('coupons', was.id, 'update', userId,
      v.active !== was.active ? `coupon ${v.code} ${v.active ? 'on' : 'off'}` : `coupon ${v.code} edited`);
    return publicRow(d.prepare('SELECT * FROM coupons WHERE id = ?').get(was.id));
  });
}
