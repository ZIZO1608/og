/* ==========================================================================
   OG SYSTEM — loyalty: the paper stamp cards
   --------------------------------------------------------------------------
   The shop runs two schemes side by side. Points are arithmetic on a balance
   and live in sales.js, where they are earned and spent inside the invoice's
   own transaction. Stamps are a card in somebody's wallet, and they live
   here.

   THE STAMP COUNT IS DERIVED, NEVER STORED. It is the qualifying items a
   customer has bought since their last redemption. Nothing holds a counter,
   so there is nothing to keep in step: voiding a sale takes its stamps back
   on its own, and the number the screen shows is computed from the same
   sale_items the invoices were built from. Same reasoning as Stock's movement
   log and Money's openDebts.

   A FULL CARD IS A STATE, NOT AN EVENT. Nothing fires automatically at ten.
   The customer reaches "card full, reward owed" and the owner decides what it
   is worth — a free pair, a discount, early access to a drop. That removes
   two traps at once: no zero-priced line has to fight the 10% discount cap,
   and nobody can bank ten cheap items and walk out with a 450,000 pair. The
   system keeps count and remembers what was done; the judgement stays with a
   person.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';

/* ---- the rules, read fresh every time ------------------------------------
   Not cached. These change from Settings, and a cached copy would keep a
   shop stamping to a rule the owner has already changed. Reading five rows
   from a table SQLite holds in memory is not the expensive part of anything
   here. */
export function rules() {
  const cfg = {};
  for (const r of get().prepare(
    "SELECT key, value FROM config WHERE key LIKE 'loyalty.%'").all()) {
    cfg[r.key] = r.value;
  }
  const num = (k, d) => {
    const n = Number(cfg[k]);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return {
    /* 'points' | 'stamps' | 'both' | 'off' — what the shop actually runs. */
    mode: cfg['loyalty.mode'] || 'points',
    required: Math.max(1, num('loyalty.stamps.required', 10)),
    /* 'item' — three pairs in one visit is three stamps — or 'visit'. */
    per: cfg['loyalty.stamps.per'] === 'visit' ? 'visit' : 'item',
    /* The smallest sale that earns anything, in minor units. 0 = any. */
    minMinor: num('loyalty.stamps.min_minor', 0),
    redeemBlock: Math.max(0, num('loyalty.redeem_block', 500)),
    voidReversesPoints: cfg['loyalty.void_reverses_points'] !== '0'
  };
}

export function stampsOn(mode) {
  return mode === 'stamps' || mode === 'both';
}
export function pointsOn(mode) {
  return mode === 'points' || mode === 'both';
}

/* ---- counting ------------------------------------------------------------
   EVERYTHING they ever earned, minus everything they have ever cashed in.

   Not "since the last redemption", which is what this said first and is
   wrong: redeeming stamps a timestamp on the record, so every earlier
   purchase falls outside the window and the count drops to zero — which
   silently eats the carry-over the shop promises. Buy fourteen, redeem ten,
   and the customer must have four, not none. Subtracting `stamps_used`
   expresses that directly, and it does not depend on timestamps at all: a
   backdated sale or two redemptions in the same second cannot corrupt it.

   `per = 'item'` sums qty, so three pairs in one visit are three stamps —
   that is what a shop with a rubber stamp actually does. `per = 'visit'`
   counts invoices instead.

   min_minor is tested against the SALE total, not the line: the rule is "a
   purchase worth at least X earns", and a customer buying one cheap pair of
   socks with an expensive shoe should not have the socks disqualified.

   Voided sales are excluded, which is the whole reason this is derived —
   voiding takes its stamps back with no second write anywhere. */
function earnedFor(d, customerId, r) {
  if (r.per === 'visit') {
    return d.prepare(
      `SELECT COUNT(*) AS n FROM sales
        WHERE customer_id = ? AND voided = 0 AND total >= ?`
    ).get(customerId, r.minMinor).n;
  }
  return d.prepare(
    `SELECT COALESCE(SUM(i.qty), 0) AS n
       FROM sale_items i
       JOIN sales s ON s.id = i.sale_id
      WHERE s.customer_id = ? AND s.voided = 0 AND s.total >= ?`
  ).get(customerId, r.minMinor).n;
}

function usedFor(d, customerId) {
  return d.prepare(
    'SELECT COALESCE(SUM(stamps_used), 0) AS n FROM loyalty_redemptions WHERE customer_id = ?'
  ).get(customerId).n;
}

function countFor(d, customerId, r) {
  return earnedFor(d, customerId, r) - usedFor(d, customerId);
}

/* One customer's card.

   `stamps` accumulates PAST the threshold and carries over a redemption —
   buy twelve, redeem ten, keep two. Nobody loses a stamp for buying more at
   once, which is the version of this a customer would call fair.

   Clamped at zero because voiding an old sale after its card was redeemed
   can push the arithmetic negative. The redemption stands: you do not take
   back a reward already handed over. */
export function cardFor(customerId, r = rules()) {
  const d = get();
  const stamps = Math.max(0, countFor(d, customerId, r));
  const last = d.prepare(
    `SELECT id, at, stamps_used, required_then, note
       FROM loyalty_redemptions WHERE customer_id = ?
      ORDER BY at DESC, id DESC LIMIT 1`
  ).get(customerId) || null;

  return {
    stamps,
    required: r.required,
    /* How many more to go. 0 once the card is full. */
    toGo: Math.max(0, r.required - stamps),
    full: stamps >= r.required,
    /* Buy twelve on a card of ten and this is 1, not 0 — the shop owes one
       reward and the customer keeps the two spare stamps. */
    cardsOwed: Math.floor(stamps / r.required),
    per: r.per,
    lastRedemption: last
  };
}

export function redemptionsFor(customerId, limit = 50) {
  const n = Math.max(1, Math.min(500, Math.floor(Number(limit)) || 50));
  return get().prepare(
    `SELECT r.id, r.at, r.stamps_used, r.required_then, r.note, u.name AS user_name
       FROM loyalty_redemptions r
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.customer_id = ?
      ORDER BY r.at DESC, r.id DESC
      LIMIT ?`
  ).all(customerId, n);
}

/* Everybody holding a full card. The list the bell points at and the filter
   the Customers screen offers — "six people have full cards" is something a
   shop can act on in an afternoon.

   One query for the counts rather than cardFor() per customer: this runs on
   every request that builds the bell. */
export function fullCards(r = rules()) {
  const d = get();
  /* Same arithmetic as countFor, done set-wise: everything earned minus
     everything redeemed. The subtraction is in the HAVING, so a customer who
     has cashed in every card they ever filled does not appear. */
  const rows = d.prepare(
    r.per === 'visit'
      ? `SELECT s.customer_id, c.name,
                COUNT(*) - COALESCE(lr.used, 0) AS n
           FROM sales s
           JOIN customers c ON c.id = s.customer_id
           LEFT JOIN (SELECT customer_id, SUM(stamps_used) AS used
                        FROM loyalty_redemptions GROUP BY customer_id) lr
                  ON lr.customer_id = s.customer_id
          WHERE s.voided = 0 AND s.customer_id IS NOT NULL AND c.archived = 0
            AND s.total >= ?
          GROUP BY s.customer_id
         HAVING n >= ?`
      : `SELECT s.customer_id, c.name,
                COALESCE(SUM(i.qty), 0) - COALESCE(lr.used, 0) AS n
           FROM sale_items i
           JOIN sales s ON s.id = i.sale_id
           JOIN customers c ON c.id = s.customer_id
           LEFT JOIN (SELECT customer_id, SUM(stamps_used) AS used
                        FROM loyalty_redemptions GROUP BY customer_id) lr
                  ON lr.customer_id = s.customer_id
          WHERE s.voided = 0 AND s.customer_id IS NOT NULL AND c.archived = 0
            AND s.total >= ?
          GROUP BY s.customer_id
         HAVING n >= ?`
  ).all(r.minMinor, r.required);

  return rows.map((x) => ({
    customerId: x.customer_id,
    name: x.name,
    stamps: x.n,
    required: r.required,
    cardsOwed: Math.floor(x.n / r.required)
  }));
}

/* ---- cashing one in ------------------------------------------------------
   Three guards, the same three every money-adjacent write in this codebase
   carries:

     * an opId through applied_ops, so a till that loses wifi mid-request and
       retries does not redeem the same card twice;
     * the count recomputed INSIDE the transaction rather than trusted from
       the browser, which may have been looking at a stale screen;
     * the rule frozen onto the row.

   `stamps` is what the redemption consumes. It defaults to the rule, but a
   manager may honour a short card deliberately — so it is checked against
   what the customer actually has, not against the rule. */
export function redeem(customerId, { note, userId, opId = null, stamps = null } = {}) {
  return tx((d) => {
    if (opId) {
      const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
      if (seen) return JSON.parse(seen.result);
    }

    const c = d.prepare('SELECT id, name FROM customers WHERE id = ?').get(customerId);
    if (!c) throw new Error('no such customer');

    const r = rules();
    if (!stampsOn(r.mode)) {
      throw Object.assign(new Error('The shop is not running stamp cards.'),
                          { code: 'stamps_off' });
    }

    const have = Math.max(0, countFor(d, customerId, r));
    const use = stamps == null ? r.required : Math.floor(Number(stamps));

    if (!(use > 0)) throw new Error('a redemption takes at least one stamp');
    if (use > have) {
      throw Object.assign(
        new Error(`${c.name} has ${have} stamp${have === 1 ? '' : 's'}, not ${use}.`),
        { code: 'not_enough_stamps', available: have, required: r.required });
    }

    const at = nowIso();
    const info = d.prepare(
      `INSERT INTO loyalty_redemptions
         (customer_id, at, user_id, stamps_used, required_then, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(customerId, at, userId ?? null, use, r.required, note ?? null, at);

    const id = Number(info.lastInsertRowid);
    logChange('loyalty_redemptions', id, 'insert', userId, null);

    /* The card AFTER this redemption, computed the same way every other read
       computes it — so the caller never has to do the subtraction itself. */
    const left = Math.max(0, have - use);
    const out = {
      id, customerId, at, stampsUsed: use, requiredThen: r.required,
      note: note ?? null,
      card: {
        stamps: left, required: r.required,
        toGo: Math.max(0, r.required - left),
        full: left >= r.required,
        cardsOwed: Math.floor(left / r.required),
        per: r.per
      }
    };

    if (opId) {
      d.prepare('INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?,?,?,?,?)')
       .run(opId, at, userId ?? null, 'stamp_redemption', JSON.stringify(out));
    }
    return out;
  });
}
