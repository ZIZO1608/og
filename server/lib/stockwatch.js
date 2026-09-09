/* ==========================================================================
   OG SYSTEM — the four questions about stock nobody was asking
   --------------------------------------------------------------------------
   The bell answers "what is at zero" and "what is nearly out". These are the
   four a shopkeeper actually asks on the floor, and until now two of them
   lived ONLY IN THE BROWSER — `DB.floorOuts()` and `DB.reorderSuggestions()`
   in js/data.js, computed over `DB.liveVariants()`, which is whatever the last
   hydrate happened to load. That is the last-200 problem in miniature: a
   number that looks like the shop and is really a window onto it. In SQL, over
   every row, they can be asked by a scheduler at nine in the morning.

   FOUR RULES THAT APPLY TO EVERY QUERY HERE:

     1. `p.hidden = 0`. An archived line is not stock — it is a decision to
        stop selling, and counting it is the mistake this codebase has made
        most often (see "Archived is not deleted, and not stock either").
     2. Every query is capped and ordered, so a shop with four hundred dead
        SKUs sends a sentence rather than a spreadsheet.
     3. Money stays minor units plus a currency code, and the two currencies
        are never added. `dead_stock` reports a pair.
     4. The shop's own history decides what "normal" is. Which sizes matter is
        read from what this shop has actually sold, never from a list of sizes
        somebody thought was standard.

   The two warehouses are `floor` and `store` (002_reference_data.sql), and
   that is what makes the first question askable at all.
   ========================================================================== */

import * as DB from './db.js';

const FLOOR = 'floor';
const STORE = 'store';

const cfgNum = (key, dflt) => {
  const r = DB.get().prepare('SELECT value FROM config WHERE key = ?').get(key);
  const n = Number(r && r.value);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

/* --------------------------------------------------------------------------
   1. EMPTY ON THE FLOOR, FULL IN THE BACK
   --------------------------------------------------------------------------
   The most actionable message the shop can send: somebody walks to the back
   and a sale that was about to be lost is not lost. Ordered by how fast that
   size actually sells HERE over the last eight weeks, because a size that
   moves once a year is not worth a trip.

   Deliberately NOT "out of stock": these are sizes the shop owns. The bell's
   stock_out is about buying more; this is about carrying it twenty metres. */
export function floorEmpty({ limit = 3, weeks = 8 } = {}) {
  return DB.get().prepare(
    `SELECT v.sku, v.size, p.name,
            COALESCE(back.qty, 0) AS back,
            COALESCE(sold.n, 0)   AS sold
       FROM variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN stock back  ON back.sku  = v.sku AND back.wh_id  = ?
       LEFT JOIN stock floor ON floor.sku = v.sku AND floor.wh_id = ?
       LEFT JOIN (
            SELECT si.sku, SUM(si.qty) AS n
              FROM sale_items si
              JOIN sales s ON s.id = si.sale_id
             WHERE s.voided = 0 AND s.at >= ?
             GROUP BY si.sku
       ) sold ON sold.sku = v.sku
      WHERE p.hidden = 0
        AND COALESCE(floor.qty, 0) = 0
        AND COALESCE(back.qty, 0)  > 0
      ORDER BY sold DESC, back DESC, p.name
      LIMIT ?`
  ).all(STORE, FLOOR, daysAgo(weeks * 7), limit);
}

export function floorEmptyCount() {
  return DB.get().prepare(
    `SELECT COUNT(*) AS n
       FROM variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN stock back  ON back.sku  = v.sku AND back.wh_id  = ?
       LEFT JOIN stock floor ON floor.sku = v.sku AND floor.wh_id = ?
      WHERE p.hidden = 0 AND COALESCE(floor.qty,0) = 0 AND COALESCE(back.qty,0) > 0`
  ).get(STORE, FLOOR).n;
}

/* --------------------------------------------------------------------------
   2. A BROKEN SIZE RUN
   --------------------------------------------------------------------------
   A shoe whose 42 and 43 are gone while 39 and 46 sit on the shelf reads as
   IN STOCK in every total in the system, and cannot be sold to most of the
   people who walk in. It is the most expensive kind of stock: it occupies a
   shelf, it counts as capital, and it converts at nearly nothing.

   WHICH SIZES MATTER IS READ FROM THIS SHOP'S OWN SALES, not from a list of
   sizes somebody thought was standard. A size is "core" when it is at or above
   the average share for that product's type — so a shop that sells mostly 44s
   is judged on 44s. A size never sold here is not a gap, it is a size this
   shop does not sell.

   Reported only when the core sizes are MOSTLY gone and something is left,
   because a product that is entirely out is `stock_out`'s business and saying
   both would be two messages about one shelf. */
export function brokenRuns({ limit = 2, months = 6, minCore = 3 } = {}) {
  const rows = DB.get().prepare(
    `WITH sold AS (
        SELECT si.product_id, si.size, SUM(si.qty) AS n
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
         WHERE s.voided = 0 AND s.at >= ? AND si.product_id IS NOT NULL AND si.size IS NOT NULL
         GROUP BY si.product_id, si.size
     ),
     tot AS (SELECT product_id, SUM(n) AS all_n, COUNT(*) AS sizes FROM sold GROUP BY product_id)
     SELECT p.id, p.name,
            v.size,
            COALESCE((SELECT SUM(qty) FROM stock st WHERE st.sku = v.sku), 0) AS have,
            COALESCE(sold.n, 0) AS n,
            tot.all_n, tot.sizes
       FROM variants v
       JOIN products p ON p.id = v.product_id
       JOIN tot ON tot.product_id = p.id
       LEFT JOIN sold ON sold.product_id = p.id AND sold.size = v.size
      WHERE p.hidden = 0 AND tot.sizes >= ?
      ORDER BY p.id, v.size`
  ).all(daysAgo(months * 30), minCore);

  /* Grouped in JS rather than in SQL: the "core" test is an average over each
     product's own rows, and expressing that as a window function would be a
     query nobody could read six months from now for no gain — this is a few
     hundred rows on a shop's catalogue. */
  const byProduct = new Map();
  for (const r of rows) {
    if (!byProduct.has(r.id)) byProduct.set(r.id, { id: r.id, name: r.name, rows: [] });
    byProduct.get(r.id).rows.push(r);
  }

  const out = [];
  for (const prod of byProduct.values()) {
    const share = prod.rows[0].all_n / Math.max(1, prod.rows[0].sizes);
    const core = prod.rows.filter((r) => r.n >= share);
    if (core.length < 2) continue;
    const goneCore = core.filter((r) => r.have <= 0);
    const left = prod.rows.reduce((a, r) => a + r.have, 0);
    /* Most of what sells is gone, and there is still stock sitting there. */
    if (goneCore.length < Math.ceil(core.length * 0.6) || left <= 0) continue;
    out.push({
      id: prod.id, name: prod.name,
      gone: goneCore.map((r) => r.size),
      left: prod.rows.filter((r) => r.have > 0).map((r) => r.size),
      pieces: left,
      score: goneCore.reduce((a, r) => a + r.n, 0)
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/* --------------------------------------------------------------------------
   3. WORTH REORDERING
   --------------------------------------------------------------------------
   Below the point where what is left will not last the lead time. The rate is
   this size's own sales over the window, so "two weeks of cover" means two
   weeks at the speed it actually sells here.

   A size that has never sold is left out entirely rather than reported as
   infinite cover or as zero: it is a size the shop has not proved it needs. */
export function reorderDue({ limit = 3, weeks = 8, coverWeeks = 2 } = {}) {
  return DB.get().prepare(
    `SELECT v.sku, v.size, p.name,
            COALESCE((SELECT SUM(qty) FROM stock st WHERE st.sku = v.sku), 0) AS have,
            sold.n AS sold
       FROM variants v
       JOIN products p ON p.id = v.product_id
       JOIN (
            SELECT si.sku, SUM(si.qty) AS n
              FROM sale_items si
              JOIN sales s ON s.id = si.sale_id
             WHERE s.voided = 0 AND s.at >= ?
             GROUP BY si.sku
             HAVING SUM(si.qty) > 0
       ) sold ON sold.sku = v.sku
      WHERE p.hidden = 0
        /* RUNNING LOW, NOT AT ZERO. A size at zero is stock_out's business and
           saying both would be two messages about one shelf — and "0 left,
           0 weeks of cover" is a sentence that tells nobody anything. The two
           rules are kept disjoint so each means exactly one thing. */
        AND COALESCE((SELECT SUM(qty) FROM stock st WHERE st.sku = v.sku), 0) > 0
        AND COALESCE((SELECT SUM(qty) FROM stock st WHERE st.sku = v.sku), 0)
            < (sold.n * 1.0 / ?) * ?
      ORDER BY (sold.n * 1.0 / ?) DESC
      LIMIT ?`
  ).all(daysAgo(weeks * 7), weeks, coverWeeks, weeks, limit)
    .map((r) => Object.assign(r, {
      /* Weeks of cover left, to one decimal — the number that makes the row
         worth acting on rather than merely true. */
      cover: Math.round((r.have / Math.max(0.01, r.sold / weeks)) * 10) / 10
    }));
}

/* --------------------------------------------------------------------------
   4. DEAD STOCK
   --------------------------------------------------------------------------
   The opposite question to reordering, and the one nobody thinks to ask:
   pieces that have not moved at all in N days, and the money standing in them.

   THE MONEY IS A PAIR, never a sum — the shop prices some goods in dollars and
   some in lira, and adding cents to lira is the bug this schema exists to
   prevent. Reported at COST, because that is what the shop is actually out of
   pocket; the row carries both currencies and the template prints whichever
   are non-zero.

   The most expensive scan in the rule table, so the rule that calls it fires
   on one hour of the day rather than on every tick. */
export function deadStock({ limit = 2, days = 90 } = {}) {
  const since = daysAgo(days);
  const rows = DB.get().prepare(
    `SELECT p.id, p.name, p.currency,
            SUM(COALESCE(st.qty, 0)) AS pieces,
            SUM(COALESCE(st.qty, 0) * COALESCE(p.cost_price, 0)) AS capital
       FROM products p
       JOIN variants v ON v.product_id = p.id
       LEFT JOIN stock st ON st.sku = v.sku
      WHERE p.hidden = 0
        AND NOT EXISTS (
            SELECT 1 FROM sale_items si
              JOIN sales s ON s.id = si.sale_id
             WHERE si.product_id = p.id AND s.voided = 0 AND s.at >= ?)
      GROUP BY p.id
     HAVING pieces > 0
      ORDER BY capital DESC
      LIMIT ?`
  ).all(since, limit);

  const total = DB.get().prepare(
    `SELECT COUNT(*) AS n,
            SUM(pieces) AS pieces
       FROM (SELECT p.id, SUM(COALESCE(st.qty,0)) AS pieces
               FROM products p
               JOIN variants v ON v.product_id = p.id
               LEFT JOIN stock st ON st.sku = v.sku
              WHERE p.hidden = 0
                AND NOT EXISTS (
                    SELECT 1 FROM sale_items si
                      JOIN sales s ON s.id = si.sale_id
                     WHERE si.product_id = p.id AND s.voided = 0 AND s.at >= ?)
              GROUP BY p.id HAVING pieces > 0)`
  ).get(since);

  return { rows, n: (total && total.n) || 0, pieces: (total && total.pieces) || 0, days };
}

/* The thresholds, so the rule table and the fold read the same numbers. */
export function settings() {
  return {
    deadDays: cfgNum('reminders.dead_days', 90),
    coverWeeks: cfgNum('reminders.cover_weeks', 2)
  };
}
