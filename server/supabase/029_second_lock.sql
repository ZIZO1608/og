-- =============================================================================
--  029 — THE SECOND LOCK, ON EVERY TABLE                         (audit 06)
-- -----------------------------------------------------------------------------
--  No local migration goes with this file: it adds no table and no column, so
--  there is nothing for server/lib/mirror-lag.js to declare and the sync does
--  not change. It only REVOKES.
--
--  THE MIRROR HAS TWO LOCKS against anybody holding the project's PUBLIC
--  (anon / publishable) key, which is printed in og-track's page source:
--
--    1. Row level security ON with NO policy      — every file does this
--    2. nothing GRANTED to anon or authenticated  — 001 does it for its own
--       tables, and 019 / 021–023 / 025–028 do it for theirs
--
--  Files 003 through 018 only ever did the first. On a project whose default
--  privileges grant new tables to anon and authenticated (Supabase's long-time
--  default), that leaves thirty-one tables — customers' credit, debts, the
--  partner's invoices, payroll's employees, the drawer's shifts — held shut by
--  ONE lock: RLS with no policy. That lock holds (audit 06 ran a query AS anon
--  against every table in a real Postgres and read nothing), but one lock is
--  one `ALTER TABLE … DISABLE ROW LEVEL SECURITY` typed into the dashboard
--  while debugging away from publishing the shop's customer list.
--
--  This puts the second lock on EVERY table in the public schema, whichever
--  file made it and whichever is made next: REVOKE ALL from anon and
--  authenticated on tables and on the sequences they own, and RLS switched on
--  for any table that has somehow lost it. The service role is untouched — it
--  is the shop's own key, and it bypasses RLS by design.
--
--  NOT touched: schema `track` (og-track's own door — its functions are
--  SECURITY DEFINER and are MEANT to be called with the public key) and schema
--  `inbox` / `tgbot`, which are not exposed at all.
--
--  Safe to run twice: every statement is a REVOKE or an ENABLE.
--  Found and tested in PGlite by _nightshift/audit06/p2-schema.mjs.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind, c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S')
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON %s public.%I FROM anon',
                     CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.relname);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON %s public.%I FROM authenticated',
                     CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.relname);
    END IF;
    IF r.relkind IN ('r', 'p') AND NOT r.relrowsecurity THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    END IF;
  END LOOP;
END $$;

--  And for whatever is made NEXT in this schema by the role running this file
--  (the SQL editor's): nothing for anon, nothing for authenticated. A new
--  mirror file still ends with its own guarded GRANT … TO service_role block.
DO $$
DECLARE
  who TEXT;
BEGIN
  FOREACH who IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = who) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', who);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', who);
    END IF;
  END LOOP;
END $$;
