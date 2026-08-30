-- =============================================================================
--  Mirror schema for rooms and rack placement.
--  Run this in the Supabase SQL editor, like 002 through 007.
-- -----------------------------------------------------------------------------
--  Matches server/migrations/026_rooms.sql column for column.
--
--  Until it is run, supabase-sync.js pushes sections WITHOUT the three new
--  columns (fallbackDrop) and says so by name, and `rooms` is skipped by the
--  layout guard — a day of sales still mirrors. Afterwards, run
--    npm run supabase:reconcile
--  because the sync's cursor has already moved past any section whose
--  placement was dropped, and no rewind will ever look there again.
-- =============================================================================

CREATE TABLE IF NOT EXISTS rooms (
  --  BIGINT, never BIGSERIAL: a sequence of its own would invent different
  --  ids on the second sync and every sections.room_id would point at the
  --  wrong room. Same rule as sections and shelves in 006.
  id          BIGINT PRIMARY KEY,
  wh_id       TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_index  INTEGER NOT NULL DEFAULT 0,
  width_cm    INTEGER,
  depth_cm    INTEGER,
  height_cm   INTEGER,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);

--  No REFERENCES rooms(id) on sections.room_id, even though SQLite has one:
--  a batch of upserts arrives in one call with no ordering guarantee inside
--  it, and a real foreign key rejects the whole batch when a rack lands
--  before its room. No CHECK either — 006 explains what a constraint on the
--  mirror once cost.
ALTER TABLE sections ADD COLUMN IF NOT EXISTS room_id  BIGINT;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS wall     TEXT;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS wall_pos INTEGER;
CREATE INDEX IF NOT EXISTS idx_sections_room ON sections (room_id);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
