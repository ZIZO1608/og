-- =============================================================================
--  019 — delivery reviews  (local 049)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, after 018. Until it is run the table is
--  skipped by name behind the delivery office's own guarded block and
--  everything else still mirrors; the sync names this file on every run.
--
--  Afterwards: npm run supabase:drift, then npm run supabase:reconcile — any
--  review written before this was run has its log entry behind the cursor.
--
--  The local schema carries the CHECK constraints. `allow_web` / `on_web` are
--  INTEGER 0/1 here as they are locally, so nothing converts a boolean on the
--  way. RLS on, no policies: the service key works and nothing else does.
-- =============================================================================

CREATE TABLE IF NOT EXISTS order_reviews (
  sale_id    TEXT PRIMARY KEY REFERENCES sales(id),
  rating     INTEGER NOT NULL,
  tags       TEXT,
  comment    TEXT,
  allow_web  INTEGER NOT NULL DEFAULT 0,
  on_web     INTEGER NOT NULL DEFAULT 0,
  show_name  TEXT,
  city       TEXT,
  method     TEXT,
  lang       TEXT,
  at         TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  web_by     BIGINT,
  web_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_order_reviews_at ON order_reviews (at);

ALTER TABLE order_reviews ENABLE ROW LEVEL SECURITY;
