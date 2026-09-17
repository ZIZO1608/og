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
  FOREACH t IN ARRAY ARRAY['day_closes', 'day_close_lines'] LOOP
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
