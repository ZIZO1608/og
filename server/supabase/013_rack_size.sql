-- =============================================================================
--  013 — how big a rack is, and where on its wall it stands, in centimetres
-- -----------------------------------------------------------------------------
--  RUN THIS BY HAND in the Supabase SQL editor, like 002–012 before it.
--  Matches server/migrations/036_rack_size.sql column for column.
--
--  Until it is run, the sync pushes sections WITHOUT these four columns
--  (lib/mirror-lag.js) and says so by name on every run — a day of sales still
--  mirrors. AFTERWARDS run
--    npm run supabase:reconcile
--  because the sync's cursor has already moved past every rack it pushed
--  without its size, and no rewind will ever look there again. A restore from
--  a mirror missing them hands back racks of the standard size standing at
--  bay-count positions, which is a layout somebody has to walk and fix.
--
--  No CHECK constraints — 006 says what a constraint on the mirror once cost.
--  NULL in any of the first three means the shop's standard rack.
-- =============================================================================

ALTER TABLE sections ADD COLUMN IF NOT EXISTS bay_cm   INTEGER;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS level_cm INTEGER;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS depth_cm INTEGER;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS wall_cm  INTEGER;
