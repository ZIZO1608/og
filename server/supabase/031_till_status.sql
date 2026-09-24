-- =============================================================================
--  031 — erp.till_status(): whose mirror this is, and when it last heard
--                                                               (night shift 04)
-- -----------------------------------------------------------------------------
--  Run by hand in Supabase → SQL Editor, AFTER 030 (it grants to og_vps).
--
--  og_vps may not read sync_state (the mirror's bookmarks), but og-bridge
--  needs two facts from it, exactly as server/lib/lineage.js and
--  server/lib/sync-worker.js write them:
--
--    lineage_id  the FIRST WORD of sync_state row 'lineage' (its note is
--                "<id> <hostname>", lineage.js claim()) — compared with what
--                the till answers on /api/vps/health, so a dev copy wired to
--                the tunnel by mistake is never taken for the shop;
--    beat_at     sync_state row 'shop' last_push_at — stamped by every push
--                that landed, every full run, and since night shift 04 by the
--                two-minute beat whenever nothing is waiting. How old the
--                snapshot is, and whether the shop is online at all.
--
--  SECURITY DEFINER so it reads sync_state as its owner; search_path is empty
--  so nothing can be slipped in ahead of public.sync_state; executable by
--  og_vps ONLY. The erp schema is not in PostgREST's exposed list, so the
--  public API cannot reach it either. Safe to run twice.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS erp;
REVOKE ALL ON SCHEMA erp FROM PUBLIC;
GRANT USAGE ON SCHEMA erp TO og_vps;

CREATE OR REPLACE FUNCTION erp.till_status()
RETURNS TABLE (lineage_id text, beat_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT NULLIF(split_part(s.note, ' ', 1), '') FROM public.sync_state s WHERE s.id = 'lineage'),
    (SELECT s.last_push_at FROM public.sync_state s WHERE s.id = 'shop');
$$;

REVOKE ALL ON FUNCTION erp.till_status() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION erp.till_status() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION erp.till_status() FROM authenticated;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION erp.till_status() TO og_vps;

-- What og-bridge will see:
SELECT * FROM erp.till_status();
