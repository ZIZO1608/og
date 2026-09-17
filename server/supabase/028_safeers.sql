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
  FOREACH t IN ARRAY ARRAY['errands'] LOOP
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
