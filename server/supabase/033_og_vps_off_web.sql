-- =============================================================================
--  033 — take og_vps off the website's tables            (audit, 23 Sep 2026)
-- -----------------------------------------------------------------------------
--  Run by hand in Supabase → SQL Editor, AFTER 030. No local migration goes
--  with it: no table and no column changes, so nothing for mirror-lag.js and no
--  drift.
--
--  WHY. 030's loop granted SELECT on every table in `public` except `users` and
--  `sync_state`, and this Postgres project also holds the WEBSITE's fifteen
--  `web_*` tables — cart, wishlist, profiles, contact messages, order
--  requests, and the rest. They are not the shop's mirror. So a login that
--  lives on the VPS could read the website's customers, and og-bridge has
--  never asked for one of those rows (`vps/og-bridge/src/snapshot-queries.js`
--  is the whole list). Measured on 23 Sep 2026: og_vps could read 73 tables,
--  58 mirror + 15 website.
--
--  030 no longer grants them. This file is what takes them back on a project
--  where the older 030 already ran.
--
--  SAFE TO RUN TWICE: REVOKE on a table with nothing granted changes nothing,
--  and DROP POLICY IF EXISTS is the same. It touches no row of data and no
--  other role — anon and authenticated keep their own grants and policies on
--  those tables, which is how the website reads them.
-- =============================================================================

-- 1. Off every web_* table: the grant and the read policy 030 left behind.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND c.relname LIKE 'web\_%'
     ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM og_vps', t);
    EXECUTE format('DROP POLICY IF EXISTS og_vps_read ON public.%I', t);
  END LOOP;
END $$;

-- 2. The count, which is the whole check. EXPECT 58 — the mirror and nothing
--    else. 73 means step 1 did not run; anything under 58 means a mirror table
--    lost its grant and og-bridge's snapshot will be short a figure.
SELECT count(*) FILTER (WHERE has_table_privilege('og_vps', c.oid, 'SELECT')) AS og_vps_can_read,
       count(*) FILTER (WHERE has_table_privilege('og_vps', c.oid, 'SELECT') AND c.relname LIKE 'web\_%') AS website_tables_left
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

-- 3. And that nothing else moved: og_vps may still write nowhere at all.
--    EXPECT no rows.
SELECT n.nspname || '.' || c.relname AS rel
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND (has_table_privilege('og_vps', c.oid, 'INSERT') OR has_table_privilege('og_vps', c.oid, 'UPDATE')
     OR has_table_privilege('og_vps', c.oid, 'DELETE') OR has_table_privilege('og_vps', c.oid, 'TRUNCATE'))
 ORDER BY 1;
