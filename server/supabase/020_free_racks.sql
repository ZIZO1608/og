-- =============================================================================
--  020 — a rack that stands on the floor
-- -----------------------------------------------------------------------------
--  RUN THIS BY HAND in the Supabase SQL editor, like 002–019 before it.
--  Matches server/migrations/051_free_racks.sql column for column.
--
--  Until it is run, the sync pushes sections WITHOUT these four columns
--  (lib/mirror-lag.js) and names this file on every run — and a free-standing
--  rack restored from that mirror comes back as a rack in its room on NO wall,
--  its place on the floor lost. That is the worst way to find out, which is
--  why this file exists in the same change as the migration. AFTERWARDS run
--    npm run supabase:reconcile
--  because the sync's cursor has already moved past every rack it pushed
--  without them.
--
--  No CHECK constraints — 006 says what a constraint on the mirror once cost.
--  The DEFAULT matches the local one, so every rack already mirrored reads as
--  a wall rack, which is what it is.
-- =============================================================================

ALTER TABLE sections ADD COLUMN IF NOT EXISTS placement TEXT NOT NULL DEFAULT 'wall';
ALTER TABLE sections ADD COLUMN IF NOT EXISTS x_cm    INTEGER;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS y_cm    INTEGER;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS rot_deg INTEGER;
