-- =============================================================================
--  039 — which shirt a print goes on (local 069)
-- -----------------------------------------------------------------------------
--  Run by hand in the Supabase SQL editor. Until it is run the shop pushes
--  print job lines without `item` (lib/mirror-lag.js) and says so; afterwards
--  run `npm run supabase:reconcile` from server/ to fill it in for the lines
--  already pushed. Running it twice changes nothing.
-- =============================================================================

ALTER TABLE print_job_lines ADD COLUMN IF NOT EXISTS item TEXT;
