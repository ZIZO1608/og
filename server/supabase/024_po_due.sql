-- =============================================================================
--  024 — when a purchase order is due  (local 056)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, after 023. Until it is run the sync
--  pushes purchase orders without due_date (lib/mirror-lag.js) and names this
--  file every run. Afterwards: npm run supabase:drift, then
--  npm run supabase:reconcile to fill in the dates already pushed without it.
-- =============================================================================

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS due_date TEXT;
