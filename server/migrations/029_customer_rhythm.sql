-- =============================================================================
--  The return rhythm: its two numbers, and the index it reads through
-- -----------------------------------------------------------------------------
--  Stage C gave every customer their own idea of "late" -- the median gap
--  between their purchases, rather than one shop-wide day count. Two constants
--  fell out of that and were written into js/data.js, which is the wrong place
--  for a number the shop might disagree with:
--
--    * the multiplier. A regular is not late the day after their usual gap;
--      people have weeks. 1.5 means somebody who comes every 30 days is called
--      quiet at 45.
--    * the floor. Without it, somebody who pops in twice a week (median 3 days)
--      turns amber by Thursday, which is noise rather than news. 21 days is the
--      earliest this screen will call anybody quiet, however often they come.
--
--  Both are stored as INTEGERS in the smallest unit that makes sense, for the
--  same reason money is: 15 tenths, not 1.5. A float in a TEXT config column
--  round-trips through parseFloat on every read and through the shop's own
--  locale on the way in, and "1,5" is a real thing somebody types.
--
--  customer.at_risk_days (028) stays, and stays load-bearing: it is what a
--  customer with fewer than three purchases is measured against, because two
--  points is not a rhythm.
--
--  All three keys are already writable -- CONFIG_WRITABLE in server/index.js
--  opens ^customer\. -- so Settings can reach them with no further change.
-- =============================================================================

INSERT INTO config (key, value, updated_at) VALUES
  ('customer.quiet_multiplier_tenths', '15', '1970-01-01T00:00:00.000Z'),
  ('customer.quiet_floor_days',        '21', '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;


-- -----------------------------------------------------------------------------
--  The index the customer list now depends on
-- -----------------------------------------------------------------------------
--  GET /api/customers walks the sales table twice per call: once for the top
--  sizes per family, once for the gaps between purchases. Both group by
--  customer and both want the rows in date order within a customer, which is
--  exactly this index.
--
--  It is not an optimisation for a shop with thirteen sales -- it is the
--  difference between "two scans of everything, on every page load, by every
--  account" and two index walks once the shop has a year behind it. Written
--  now because adding it later means noticing the slowdown first, and the
--  person who notices is standing at a till.
--
--  (customer_id, at) rather than (customer_id): the ORDER BY inside each
--  customer comes free, so the rhythm's gap arithmetic needs no sort at all.
--  Rows with a NULL customer_id -- every walk-in, which is about half of them
--  -- are still indexed by SQLite, but they are never selected by either query
--  and cost only space.
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS sales_customer_at ON sales (customer_id, at);
