-- =============================================================================
--  The new Syrian pound
-- -----------------------------------------------------------------------------
--  Syria redenominated: two zeros came off, so 1 new pound = 100 old lira. The
--  shop prices and takes payment in the new pound, and this database was built
--  entirely in the old one. Left alone, every figure in the system reads 100x
--  too high and the first receipt handed to a customer would be nonsense.
--
--  THIS MIGRATION IS NOT REVERSIBLE BY RE-RUNNING IT. Dividing twice gives
--  10,000x. It is recorded in schema_migrations like every other one, so it
--  runs exactly once -- but if you are restoring from a backup, check whether
--  that backup is pre- or post-redenomination before pointing the server at it.
--  `npm run backup` before deploying this.
--
--  WHY fx_rate MOVES TOO. Every sale froze the rate it was settled at, so that
--  re-running last month's profit gives the same answer forever. If the totals
--  were divided and the rate was not, every historic invoice would suddenly be
--  worth 100x fewer dollars. Both sides of the ratio move together, so the
--  dollar value of every past sale comes out of this migration unchanged --
--  which is the entire point of having frozen it.
--
--  ONLY SYP IS TOUCHED. The shop prices some goods in dollars; those rows are
--  already in cents and dividing them would be a second, worse bug.
--
--  002_reference_data.sql STILL SAYS 13,000 AND IS LEFT ALONE ON PURPOSE. An
--  already-applied migration must never be edited: two databases would then
--  report the same schema_migrations rows while holding different data, which
--  is the worst kind of bug to be handed. It costs nothing here -- on a fresh
--  install 002 writes the old rate at 1970, this file writes 130.0 at 2026, and
--  currentRate() orders by set_at DESC and picks the new one. A brand-new
--  database and a migrated one end up identical.
-- =============================================================================

-- ------------------------------------------------------------------ products
UPDATE products
   SET selling_price = selling_price / 100,
       cost_price    = cost_price / 100
 WHERE currency = 'SYP';


-- --------------------------------------------------------------------- sales
--  Integer division is deliberate. These are minor units of a currency whose
--  minor_exp is 0, so a whole new pound is the smallest real amount -- there is
--  nothing below it to round to. Old prices were set in round hundreds anyway.
UPDATE sales
   SET subtotal = subtotal / 100,
       discount = discount / 100,
       total    = total / 100,
       fx_rate  = fx_rate / 100.0
 WHERE currency = 'SYP';

--  unit_price and unit_cost are denominated in the SALE's settle currency, so
--  they follow the sale, not the product they came from.
UPDATE sale_items
   SET unit_price = unit_price / 100,
       unit_cost  = unit_cost / 100
 WHERE sale_id IN (SELECT id FROM sales WHERE currency = 'SYP');

--  src_unit_price is what the product cost in ITS OWN currency, which is why
--  this one is filtered on the item and not on the sale.
UPDATE sale_items
   SET src_unit_price = src_unit_price / 100
 WHERE src_currency = 'SYP';


-- ---------------------------------------------------------------- deliveries
UPDATE deliveries
   SET to_collect = to_collect / 100,
       collected  = collected / 100
 WHERE currency = 'SYP';


-- --------------------------------------------------------------- the rate now
--  A new row rather than an edit: fx_rates is a history, and the old 13,000 is
--  a true fact about the day it was set. Reports that look back through it must
--  still find it there.
INSERT INTO fx_rates (base, quote, rate, set_at, set_by) VALUES
  ('USD', 'SYP', 130.0, '2026-08-24T00:00:00.000Z', NULL);


-- -------------------------------------------------------------------- loyalty
--  Points are not money and were NOT divided -- so if the earn rule stayed as
--  it was, the same real spend would earn 100x fewer points and every customer
--  would slide to Bronze and never climb out. Making earning 100x denser keeps
--  the scheme exactly where it was: still 5% back, and the tier thresholds
--  below did not have to move at all.
UPDATE config SET value = '100', updated_at = '2026-08-24T00:00:00.000Z'
 WHERE key = 'loyalty.points_per_1000';

UPDATE config SET value = '0.5', updated_at = '2026-08-24T00:00:00.000Z'
 WHERE key = 'loyalty.point_value';
