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

-- ---- grants (night shift 01 fix) ----
--  Supabase gives a table made in the SQL editor NO privileges for the
--  service_role on this project, so the shop's key was refused with
--  "permission denied for table …" and the whole mirror run stopped. The
--  shop's key needs to read and write each new table; anon and authenticated
--  are kept out, as 001 does for its own tables. A sequence owned by one of
--  these tables (none today — the ids come from the shop) gets USAGE and
--  SELECT. Every statement is a GRANT or a REVOKE: running this twice
--  changes nothing. A table that does not exist yet is skipped.
DO $$
DECLARE
  t TEXT;
  s RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_reviews'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
      FOR s IN
        SELECT seq.relname
          FROM pg_class seq
          JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
          JOIN pg_class tab ON tab.oid = dep.refobjid
         WHERE seq.relkind = 'S' AND tab.oid = ('public.' || t)::regclass
      LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', s.relname);
      END LOOP;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
