/* ==========================================================================
   OG SYSTEM — sales
   --------------------------------------------------------------------------
   Recording a sale is the one operation where being nearly right is worse
   than failing, so three things are true of every sale written here:

   1. IT IS ONE TRANSACTION. The invoice, its lines, the stock coming off the
      shelf and the loyalty points all commit together or not at all. A sale
      that took the money but not the stock leaves the shop believing it owns
      a shoe it has already sold.

   2. THE SERVER DECIDES WHETHER THERE IS STOCK. The browser's opinion is a
      guess several seconds old, taken before the other till rang up the same
      pair. Stock.sellLines runs inside this transaction against the running
      total, so the loser is refused rather than taking stock negative.

   3. THE EXCHANGE RATE IS FROZEN INTO THE ROW. Not looked up later. The shop
      prices some goods in dollars and some in lira; if a sale only stored
      "1200 SYP" and the rate moved next week, last month's profit would
      change every time you re-ran the report, and nobody could say which
      number was true.

   Retries are safe. A till that loses the wifi mid-request does not know
   whether the sale landed, so it sends the same op_id again and gets the
   original invoice back instead of selling the shoe twice.
   ========================================================================== */

import { randomBytes } from 'node:crypto';
import { get, nowIso, tx, logChange } from './db.js';
import * as Stock from './stock.js';

/* The address the printed QR points at.

   128 bits from the OS CSPRNG, and deliberately NOT derived from the invoice
   number — anything computable from `INV-2101` is `INV-2101` with extra steps,
   and lets one scanned receipt unlock every other one. */
function publicToken() {
  return randomBytes(16).toString('hex');
}

/* ------------------------------------------------------------------- money */

/* How many minor units make one whole unit. USD 2 -> cents, SYP 0 -> lira. */
export function minorExp(code) {
  const r = get().prepare('SELECT minor_exp FROM currencies WHERE code = ?').get(code);
  if (!r) throw new Error(`unknown currency: ${code}`);
  return r.minor_exp;
}

/* The most recent rate for a pair, or null. */
export function currentRate(base, quote) {
  if (base === quote) return 1;
  const r = get().prepare(
    `SELECT rate FROM fx_rates WHERE base = ? AND quote = ?
      ORDER BY set_at DESC, id DESC LIMIT 1`
  ).get(base, quote);
  return r ? r.rate : null;
}

/* Convert an integer amount between currencies, staying in integers.

   Rounding happens once, at the end, on the minor unit of the target — round
   per line and the invoice total stops matching the sum of its own lines,
   which is the kind of thing a customer notices and you cannot explain. */
export function convert(amount, from, to, rate) {
  if (from === to) return amount;

  const fromExp = minorExp(from);
  const toExp = minorExp(to);

  /* Out of minor units, across the rate, back into the target's minor units. */
  const whole = amount / Math.pow(10, fromExp);
  const converted = whole * rate;
  return Math.round(converted * Math.pow(10, toExp));
}

/* ------------------------------------------------------------------- ids */

export function nextInvoiceId() {
  /* Highest existing number, not a count: a deleted draft or a gap must never
     hand the same invoice number to two sales. */
  const r = get().prepare(
    `SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n
       FROM sales WHERE id LIKE 'INV-%'`
  ).get();
  return 'INV-' + ((r && r.n ? r.n : 2100) + 1);
}

/* ------------------------------------------------------------- the sale */

/* lines: [{ sku, qty }]  — price comes from the product, never the client.
   A browser that can name its own price is a browser that can sell a £200
   pair for nothing. */
export function record({
  lines, whId, customerId, payment, discount = 0,
  /* Points the customer is spending on this sale. Sent as a COUNT, never as
     an amount — the till does not get to decide what a point is worth any
     more than it gets to decide what a shoe costs. */
  pointsUsed = 0,
  currency, userId, opId, note,
  /* Set by the route from the caller's permissions. Passed in rather than
     looked up here so this module stays free of the auth tables — but it
     defaults to false, so a new caller that forgets it gets the cap, not a
     hole. Failing closed is the whole point of a default. */
  unlimitedDiscount = false
}) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('a sale needs at least one line');
  if (!whId) throw new Error('a sale must say which place it came out of');

  /* Already done? Hand back exactly what was returned the first time. This is
     what makes a retry after a dropped connection safe. */
  if (opId) {
    const seen = get().prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
    if (seen) return { ...JSON.parse(seen.result), replayed: true };
  }

  return tx((d) => {
    const at = nowIso();
    const saleId = nextInvoiceId();

    /* The currency the receipt is denominated in. */
    const settle = currency || d.prepare(
      "SELECT value FROM config WHERE key = 'shop.base_currency'"
    ).get().value;

    /* One rate for the whole sale, read once and written into the row. */
    const base = 'USD';
    const rate = currentRate(base, settle);
    if (rate === null) {
      throw new Error(`no exchange rate for ${base}/${settle} — set one in Settings`);
    }

    /* ---- who is buying ----------------------------------------------------
       Read here, before anything is priced, for two reasons. Points can pay
       for part of this sale, so the balance has to be known before the total
       is. And an id that matches nobody has to STOP the sale.

       It used to be looked up after the fact and quietly ignored when it
       missed: the cashier attached a customer, the sale recorded without one,
       the points were never earned, and nothing anywhere said so. A sale that
       refuses is a sale someone can fix. */
    let cust = null;
    if (customerId !== null && customerId !== undefined && customerId !== '') {
      cust = d.prepare(
        'SELECT id, name, loyalty_points, archived FROM customers WHERE id = ?'
      ).get(customerId);

      if (!cust) {
        const e = new Error(`No customer with id ${customerId}.`);
        e.code = 'unknown_customer';
        throw e;
      }
      if (cust.archived) {
        const e = new Error(`${cust.name} is archived. Restore them first.`);
        e.code = 'unknown_customer';
        throw e;
      }
    }

    /* ---- price the basket ------------------------------------------------ */
    const priced = [];
    let subtotal = 0;

    for (const l of lines) {
      const v = d.prepare(
        `SELECT v.sku, v.size, v.product_id, p.name, p.currency,
                p.selling_price, p.cost_price
           FROM variants v JOIN products p ON p.id = v.product_id
          WHERE v.sku = ?`
      ).get(l.sku);

      if (!v) throw new Error(`unknown item: ${l.sku}`);

      const qty = Number(l.qty);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error(`${l.sku}: quantity must be a positive whole number`);
      }

      /* Converted into the settle currency at the frozen rate, so a basket
         mixing dollar and lira goods still adds up to one number. */
      const unitPrice = convert(v.selling_price, v.currency, settle, rate);
      const unitCost = convert(v.cost_price, v.currency, settle, rate);

      priced.push({
        sku: v.sku, productId: v.product_id, name: v.name, size: v.size,
        qty, unitPrice, unitCost,
        srcCurrency: v.currency, srcUnitPrice: v.selling_price
      });

      subtotal += unitPrice * qty;
    }

    const disc = Math.max(0, Math.round(Number(discount) || 0));
    if (disc > subtotal) throw new Error('the discount is larger than the sale');

    /* ---- points spent -----------------------------------------------------
       This used to happen entirely in the browser: pos.js multiplied the
       points by their value, folded the result into `discount`, and nothing
       ever came off anyone's balance. The same 500 points bought something on
       every visit, forever. Points are money the shop already owes, so they
       are counted here, against the stored balance, inside this transaction.

       Valued as the exact inverse of how they are earned below — per whole
       unit of the settle currency — so redeeming what a purchase earned is
       worth what it was worth. */
    const wantPoints = Math.max(0, Math.round(Number(pointsUsed) || 0));
    let pointsValue = 0;

    if (wantPoints > 0) {
      if (!cust) throw new Error('points can only be redeemed against a customer');

      if (wantPoints > cust.loyalty_points) {
        const e = new Error(
          `${cust.name} has ${cust.loyalty_points} points, not ${wantPoints}.`);
        e.code = 'not_enough_points';
        e.available = cust.loyalty_points;
        throw e;
      }

      const pointValue = Number(d.prepare(
        "SELECT value FROM config WHERE key = 'loyalty.point_value'"
      ).get()?.value ?? 0);

      pointsValue = Math.round(
        wantPoints * pointValue * Math.pow(10, minorExp(settle)));
    }

    /* ---- the ceiling ------------------------------------------------------
       Checked here, not only at the till. A cap that lives in the browser is
       a suggestion: the request can be sent by hand, and the whole reason
       prices are read from the product table above is that the client's
       numbers are not trusted. The discount is one of the client's numbers. */
    if (!unlimitedDiscount && disc > 0) {
      const maxPct = Number(d.prepare(
        "SELECT value FROM config WHERE key = 'sale.max_discount_pct'"
      ).get()?.value ?? 100);

      /* Compared as amounts rather than a rounded percentage, so a discount
         one lira over the line is over the line. */
      const ceiling = Math.floor(subtotal * maxPct / 100);
      if (disc > ceiling) {
        const e = new Error(
          `Discounts above ${maxPct}% need a manager. The most you can take off ` +
          `this sale is ${ceiling} (you asked for ${disc}).`);
        e.code = 'discount_too_big';
        e.maxPct = maxPct;
        e.ceiling = ceiling;
        throw e;
      }
    }

    /* The cap above governs the DISCOUNT — margin a cashier is giving away.
       Redeemed points are not that: they are a debt the shop took on when it
       issued them, and paying a debt is not a favour that needs a manager. So
       the points ride on top of the ceiling, and only the one limit that is
       arithmetic rather than policy applies to the pair. */
    if (disc + pointsValue > subtotal) {
      const room = subtotal - disc;
      const e = new Error(
        `Those points are worth more than what is left to pay. ` +
        `The most that can come off this sale is ${room}.`);
      e.code = 'points_exceed_total';
      e.room = room;
      throw e;
    }

    const total = subtotal - disc - pointsValue;

    /* ---- take the stock -------------------------------------------------- */
    /* Before writing the invoice: if this throws InsufficientStock the whole
       transaction unwinds and no half-sale exists. */
    Stock.sellLines(d, { lines, whId, userId, saleId });

    /* ---- write the invoice ----------------------------------------------- */
    const token = publicToken();

    /* Points earned have to be known before the row is written — the INSERT
       below needs the number, and it is computed from `cust` further down.
       Priced here so both the row and the response agree with each other. */
    let earnedForRow = 0;
    if (cust) {
      const per1000ForRow = Number(d.prepare(
        "SELECT value FROM config WHERE key = 'loyalty.points_per_1000'"
      ).get().value);
      const wholeForRow = total / Math.pow(10, minorExp(settle));
      earnedForRow = Math.round(wholeForRow / 1000 * per1000ForRow);
    }

    d.prepare(
      `INSERT INTO sales
         (id, at, customer_id, customer_name, cashier_id, wh_id, payment,
          currency, subtotal, discount, total, fx_rate, fx_base, created_at,
          public_token, points_used, points_earned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(saleId, at, cust ? cust.id : null, cust ? cust.name : null,
          userId ?? null, whId, payment || 'cash',
          settle, subtotal, disc, total, rate, base, at, token, wantPoints,
          earnedForRow);

    const insLine = d.prepare(
      `INSERT INTO sale_items
         (sale_id, sku, product_id, name, size, qty,
          unit_price, unit_cost, src_currency, src_unit_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of priced) {
      insLine.run(saleId, p.sku, p.productId, p.name, p.size, p.qty,
                  p.unitPrice, p.unitCost, p.srcCurrency, p.srcUnitPrice);
    }

    /* ---- loyalty ----------------------------------------------------------
       Earned is `earnedForRow`, computed above so it could be written into
       the invoice itself; reused here rather than recomputed so the row and
       the customer's balance can never disagree about what this sale paid
       out. */
    const earned = earnedForRow;
    if (cust) {
      /* Spend and earn in one statement, in the same transaction as the
         invoice that caused both. Two updates could interleave with another
         till serving the same customer and lose one of them. */
      d.prepare(
        `UPDATE customers
            SET loyalty_points = loyalty_points - ? + ?, updated_at = ?
          WHERE id = ?`
      ).run(wantPoints, earned, at, cust.id);
      logChange('customers', cust.id, 'update', userId, null);
    }

    logChange('sales', saleId, 'insert', userId, null);

    const result = {
      id: saleId, at, currency: settle, subtotal, discount: disc, total,
      fxRate: rate, fxBase: base, whId,
      customerId: cust ? cust.id : null,
      customerName: cust ? cust.name : null,
      payment: payment || 'cash',
      pointsEarned: earned,
      pointsUsed: wantPoints,
      /* What the redeemed points were actually worth, so the receipt can print
         the line without re-deriving it from a point value that may have been
         changed in Settings since. */
      pointsValue: pointsValue,
      items: priced,
      note: note ?? null,
      /* The till needs this to draw the QR on the receipt it is about to
         print. It is not a secret from the person who just made the sale. */
      publicToken: token
    };

    if (opId) {
      d.prepare(
        `INSERT INTO applied_ops (op_id, at, user_id, kind, result)
         VALUES (?, ?, ?, 'sale', ?)`
      ).run(opId, at, userId ?? null, JSON.stringify(result));
    }

    return result;
  });
}

/* ------------------------------------------------------------------ reading */

export function byId(id) {
  const s = get().prepare(
    `SELECT s.*, u.name AS cashier_name
       FROM sales s LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.id = ?`
  ).get(id);
  if (!s) return null;
  s.items = get().prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(id);
  return s;
}

/* Recent invoices WITH their lines.

   Two queries rather than one join, then stitched: a join repeats every header
   column once per line, and the app wants nested objects anyway. Two hundred
   invoices is a few hundred item rows — small enough that fetching them
   separately per sale, which is what the screens would otherwise do, is the
   only genuinely slow option here. */
export function recent(limit = 50) {
  const sales = get().prepare(
    `SELECT s.*, u.name AS cashier_name
       FROM sales s LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.voided = 0
      ORDER BY s.at DESC LIMIT ?`
  ).all(limit);

  if (!sales.length) return sales;

  const byId = new Map(sales.map(s => [s.id, s]));
  for (const s of sales) s.items = [];

  const marks = sales.map(() => '?').join(',');
  const items = get().prepare(
    `SELECT * FROM sale_items WHERE sale_id IN (${marks}) ORDER BY id`
  ).all(...sales.map(s => s.id));

  for (const it of items) byId.get(it.sale_id)?.items.push(it);

  return sales;
}

/* Void a sale and put the stock back.

   A void is not a delete. The row stays, flagged, and returning the stock
   writes its own movements — so the trail shows a sale happened and was
   reversed, which is exactly what an auditor, or you, needs to see. */
export function voidSale(id, { reason, userId }) {
  return tx((d) => {
    const s = d.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!s) throw new Error('no such sale');
    if (s.voided) throw new Error('that sale is already voided');

    const items = d.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
    for (const it of items) {
      Stock.apply(d, {
        sku: it.sku, whId: s.wh_id, delta: it.qty, type: 'returned',
        note: `voided ${id}${reason ? ': ' + reason : ''}`,
        userId, refType: 'void', refId: id
      });
    }

    d.prepare('UPDATE sales SET voided = 1, void_reason = ? WHERE id = ?')
     .run(reason ?? null, id);
    logChange('sales', id, 'update', userId, null);

    return { id, voided: true, returned: items.length };
  });
}
