-- =============================================================================
--  030 — og_vps, a login that can only READ the mirror          (night shift 04)
-- -----------------------------------------------------------------------------
--  Run by hand in Supabase → SQL Editor. No local migration goes with it: no
--  table and no column change, so nothing for mirror-lag.js and no drift.
--
--  WHO USES IT: og-bridge on the VPS (vps/og-bridge/), for the owner's
--  snapshot at shop.ogsports1.com/snapshot — the last figures the cloud copy
--  received, shown when the shop's internet is down. It never writes.
--
--  WHAT IT MAY READ: SELECT on every table in public EXCEPT
--    sync_state   the mirror's bookmarks and its owner — og-bridge reads the
--                 two facts it needs through erp.till_status() (031) instead;
--    users        except (id, name): a sale names its cashier by id, and the
--                 snapshot prints the name. No username, no password material
--                 (pw_hash, pw_salt, pw_enc), no phone, no role.
--    web_*        THE WEBSITE'S OWN TABLES, which share this Postgres project
--                 and are not the shop's mirror at all (web_profiles,
--                 web_contact_messages, web_order_requests and twelve more,
--                 owner postgres, their own RLS policies, anon reads them and
--                 inserts into most). The first version of this loop said
--                 "every table but the two" and swept all fifteen in, so a
--                 credential that lives on the VPS could read the website's
--                 customers — found by the audit of 23 Sep 2026. og-bridge
--                 never asks for them; the grant was simply wider than the
--                 job. 033 takes them back off a project where this already
--                 ran.
--
--  WHY A POLICY AS WELL AS A GRANT. Every mirrored table has row level
--  security ON with NO policy (001's first lock). A role that is not the
--  table's owner then reads ZERO rows however much it is granted, so each
--  table gets one policy: SELECT, for og_vps, every row. It names og_vps and
--  nobody else, so anon and authenticated — 029's second lock — are untouched.
--
--  Safe to run twice: the role, every grant and every policy are made only
--  when missing. A table created LATER is not covered: run this file again
--  after any new mirror file that creates a table.
-- =============================================================================

-- 1. The role. LOGIN with NO PASSWORD: a role nobody can sign in as until the
--    line under it is run. Forgetting that edit leaves a locked door, not a
--    door with a published key in it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'og_vps') THEN
    CREATE ROLE og_vps LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 5;
  END IF;
END $$;

--    Run this ONE line on its own, with a long random password of your own
--    (e.g. `openssl rand -hex 24`), and put the same in og-bridge's
--    OG_MIRROR_URL. Never commit it.
-- ALTER ROLE og_vps PASSWORD 'CHANGE-ME';

--    Belt and braces: even a mistaken grant cannot make it write.
ALTER ROLE og_vps SET default_transaction_read_only = on;
ALTER ROLE og_vps SET statement_timeout = '15s';

GRANT USAGE ON SCHEMA public TO og_vps;

-- 2. Every mirror table, with its read policy. Not users, not sync_state, and
--    not the website's web_* tables (see the header).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND c.relname NOT IN ('users', 'sync_state')
       AND c.relname NOT LIKE 'web\_%'
     ORDER BY c.relname
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO og_vps', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'og_vps_read') THEN
      EXECUTE format('CREATE POLICY og_vps_read ON public.%I FOR SELECT TO og_vps USING (true)', t);
    END IF;
  END LOOP;
END $$;

-- 3. users: the name and the id, nothing else.
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    REVOKE ALL ON public.users FROM og_vps;
    GRANT SELECT (id, name) ON public.users TO og_vps;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'og_vps_read') THEN
      CREATE POLICY og_vps_read ON public.users FOR SELECT TO og_vps USING (true);
    END IF;
  END IF;
  IF to_regclass('public.sync_state') IS NOT NULL THEN
    REVOKE ALL ON public.sync_state FROM og_vps;
  END IF;
END $$;

-- 4. What it can read now — check this list before anything else.
SELECT table_name, string_agg(DISTINCT privilege_type, ', ') AS privileges
  FROM information_schema.role_table_grants
 WHERE grantee = 'og_vps'
 GROUP BY table_name
 ORDER BY table_name;
