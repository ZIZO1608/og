-- ============================================================================
--  067 — every product is priced in dollars (the owner, 25 Sep 2026)
-- ----------------------------------------------------------------------------
--  The shop sells in lira at whatever the dollar is worth that day, and the
--  rate follows a live feed (lib/fxfeed.js). A product priced in lira did
--  not follow it: its price stood still while the dollar moved. So every
--  price is a dollar price now, and the lira is DERIVED — dollars × the
--  newest rate, rounded to the whole lira — at the till (lib/sales.js
--  convert(), frozen into the sale), in the browser (toBase in js/data.js)
--  and on the website (the feed's `prices.SYP`). No lira price is stored.
--
--  Each lira product is converted ONCE at the newest USD→SYP rate: the price
--  becomes cents, the same money at today's rate. A figure can move by a
--  lira on the way back (4,700 at 135 is $34.81, which is 4,699); that is
--  the rounding of cents, and lib/migration-checks.js refuses anything more.
--
--  A database with no rate (a fresh one) has nothing to convert against and
--  is left alone; the server refuses a lira price from here on either way.
--
--  One change_log row per converted product, written BEFORE the update so
--  the rows can still be told apart by their currency: without it the price
--  changes here and the mirror goes on showing the lira one for ever.
-- ============================================================================

INSERT INTO change_log (at, tbl, row_id, op, user_id, note)
SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'products', CAST(p.id AS TEXT), 'update', NULL,
       'priced in dollars (067)'
  FROM products p
 WHERE p.currency = 'SYP'
   AND EXISTS (SELECT 1 FROM fx_rates r WHERE r.base = 'USD' AND r.quote = 'SYP' AND r.rate > 0);

UPDATE products
   SET selling_price = CAST(ROUND(selling_price * 100.0 /
         (SELECT r.rate FROM fx_rates r WHERE r.base = 'USD' AND r.quote = 'SYP' AND r.rate > 0
           ORDER BY r.set_at DESC, r.id DESC LIMIT 1)) AS INTEGER),
       cost_price = CAST(ROUND(cost_price * 100.0 /
         (SELECT r.rate FROM fx_rates r WHERE r.base = 'USD' AND r.quote = 'SYP' AND r.rate > 0
           ORDER BY r.set_at DESC, r.id DESC LIMIT 1)) AS INTEGER),
       currency = 'USD',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE currency = 'SYP'
   AND EXISTS (SELECT 1 FROM fx_rates r WHERE r.base = 'USD' AND r.quote = 'SYP' AND r.rate > 0);
