-- =============================================================================
--  027 — owner and developer, and access per person  (local 059)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, after 026, BEFORE npm run users:mirror.
--  Until it is run the mirror refuses every owner or developer account (the
--  role check), which takes the users push down with it; user_permissions is
--  skipped by name; the boot pull refuses with `drift`.
--
--  The role checks are 001's inline CHECKs, so they are dropped and written
--  again. user_permissions: pushed whole, deletes follow. RLS on, no policies.
-- =============================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN
  ('owner','developer','manager','cashier','warehouse','delivery','partner'));

ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check CHECK (role IN
  ('owner','developer','manager','cashier','warehouse','delivery','partner'));

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm       TEXT NOT NULL,
  allowed    BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by BIGINT,
  PRIMARY KEY (user_id, perm)
);
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

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
  FOREACH t IN ARRAY ARRAY['user_permissions'] LOOP
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
