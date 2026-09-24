-- =============================================================================
--  UNDO 035 — take night requests out of the cloud again
-- -----------------------------------------------------------------------------
--  Run by hand in Supabase → SQL Editor, ONLY to take night mode's requests
--  away completely. It is not a numbered file on purpose: nothing should ever
--  paste it in sequence.
--
--  BEFORE running it, prefer the switches — they are instant and lose nothing:
--    og-bridge   OG_NIGHT_SUBMIT=off   night mode reads, never writes
--                OG_NIGHT_USERS=[]     nobody can sign in to /night at all
--    laptop      OG_NIGHT_REQUESTS=0   the laptop stops collecting
--
--  WHAT IT DELETES: the four doors, the five private helpers and the table
--  inbox.requests WITH EVERY REQUEST IN IT — including any still waiting for
--  the shop. Look at the first query's answer before running the rest.
--  Orders already made from requests are ordinary orders in the shop and are
--  not touched. og-track's inbox.items, and the schemas inbox and erp, stay.
--
--  Safe to run twice. 035 can be run again afterwards to put it all back
--  (empty).
-- =============================================================================

-- 1. What would be lost: requests not yet decided. Read this first.
SELECT state, count(*) AS requests
  FROM inbox.requests
 GROUP BY state
 ORDER BY state;

-- 2. The doors, then the helpers, then the table.
DROP FUNCTION IF EXISTS erp.request_submit(text, text, jsonb);
DROP FUNCTION IF EXISTS erp.requests_list(text, integer);
DROP FUNCTION IF EXISTS public.requests_take(text, integer);
DROP FUNCTION IF EXISTS public.requests_mark(text, jsonb);
DROP FUNCTION IF EXISTS inbox.req_owner(text);
DROP FUNCTION IF EXISTS inbox.req_no(text, text);
DROP FUNCTION IF EXISTS inbox.req_str(jsonb, text);
DROP FUNCTION IF EXISTS inbox.req_line(text);
DROP FUNCTION IF EXISTS inbox.req_block(text);
DROP TABLE IF EXISTS inbox.requests;

NOTIFY pgrst, 'reload schema';

-- 3. Check: nothing of 035 is left. Expect no rows.
SELECT n.nspname || '.' || p.proname AS left_over
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE (n.nspname = 'erp'    AND p.proname IN ('request_submit', 'requests_list'))
    OR (n.nspname = 'inbox'  AND p.proname LIKE 'req\_%')
    OR (n.nspname = 'public' AND p.proname IN ('requests_take', 'requests_mark'))
UNION ALL
SELECT 'inbox.requests' WHERE to_regclass('inbox.requests') IS NOT NULL;
