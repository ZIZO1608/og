-- =============================================================================
--  028 — the delivery team's errands  (local 060)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, after 027. Until it is run the sync
--  skips `errands` by name behind the road's guard and names this file every
--  run; the boot pull refuses with `drift`. Cursor shape — no reconcile is
--  needed for a table that did not exist.  RLS on, no policies.
-- =============================================================================

CREATE TABLE IF NOT EXISTS errands (
  id          BIGINT PRIMARY KEY,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'other',
  from_place  TEXT,
  to_area     TEXT,
  notes       TEXT,
  due_date    TEXT,
  sale_id     TEXT REFERENCES sales(id),
  safeer_id   BIGINT,
  assigned_by BIGINT,
  status      TEXT NOT NULL DEFAULT 'waiting',
  fail_reason TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  out_at      TIMESTAMPTZ,
  closed_at   TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS errands_safeer ON errands (safeer_id, status);
ALTER TABLE errands ENABLE ROW LEVEL SECURITY;
