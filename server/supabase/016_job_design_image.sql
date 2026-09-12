-- =============================================================================
--  016 — print_jobs.design_image_url   (local migration 044)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor. Until it is run, lib/mirror-lag.js
--  makes the sync push print_jobs WITHOUT this column and name this file on
--  every run — nothing is lost, only late. Afterwards run
--  `npm run supabase:reconcile`, or the column exists here and stays NULL for
--  every job pushed in the meantime, and a restore hands back a queue with no
--  designs on it.
--
--  RLS is already on for print_jobs from 003; a column needs no policy.
-- =============================================================================

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS design_image_url text;
