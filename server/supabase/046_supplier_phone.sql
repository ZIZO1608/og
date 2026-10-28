-- =============================================================================
--  046 — a supplier's phone and notes (local migration 079, night shift
--  28 Oct 2026). Run in the Supabase SQL editor; safe to run twice. Then
--  `npm run supabase:reconcile` on the VPS, or suppliers edited before this
--  was run keep the two columns empty here.
--  Also appended to CATCH-UP.sql.
-- =============================================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;
