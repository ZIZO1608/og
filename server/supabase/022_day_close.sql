-- =============================================================================
--  022 — closing the day  (local 054)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, after 021. Until it is run the sync
--  skips day_closes BY NAME behind the cash book's guard and everything else
--  still mirrors; the boot pull refuses with `drift` until it exists.
--
--  Afterwards: npm run supabase:drift. No reconcile is needed for this file on
--  its own — no existing table gained a column.
--
--  A close is UPDATED when the owner confirms it, so it is pushed by cursor,
--  and its lines are replaced whole with it, like a sale's items. The local
--  schema carries the CHECKs. RLS on, no policies: this is what the owner took
--  home each night.
-- =============================================================================

CREATE TABLE IF NOT EXISTS day_closes (
  id             TEXT PRIMARY KEY,
  day            TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'counted',
  counted_by     BIGINT,
  counted_name   TEXT,
  counted_at     TIMESTAMPTZ NOT NULL,
  note           TEXT,
  confirmed_by   BIGINT,
  confirmed_name TEXT,
  confirmed_at   TIMESTAMPTZ,
  owner_note     TEXT,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS day_close_lines (
  close_id  TEXT   NOT NULL REFERENCES day_closes(id) ON DELETE CASCADE,
  currency  TEXT   NOT NULL REFERENCES currencies(code),
  counted   BIGINT NOT NULL,
  expected  BIGINT NOT NULL,
  taken     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (close_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_day_closes_day ON day_closes (day);

ALTER TABLE day_closes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_close_lines ENABLE ROW LEVEL SECURITY;
