-- =============================================================================
--  045 — reservations (local migration 078, night shift 28 Oct 2026)
-- -----------------------------------------------------------------------------
--  Run in the Supabase SQL editor, after 044. Safe to run twice. Then run
--  verify_045_reservations.sql, then 030_erp_access.sql again, then
--  `npm run supabase:reconcile` on the VPS.
--
--  A till reservation is a pickup order paid by deposit: its sale, its
--  delivery, its payments and its stock movements are already mirrored by the
--  tables that hold them. This is only the row that says until when it is
--  held, and the least its deposit could be. Cursor shape; keyed by the sale.
--  No foreign keys in the mirror, on purpose: rows arrive one table at a time.
--  RLS on with no policies, and the grant block (17 Sep 2026).
-- =============================================================================

CREATE TABLE IF NOT EXISTS reservations (
  sale_id      TEXT    PRIMARY KEY,
  customer_id  BIGINT,
  hold_until   TIMESTAMPTZ NOT NULL,
  deposit_min  BIGINT  NOT NULL,
  deposit_pct  INTEGER,
  min_by       BIGINT,
  extended     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL,
  created_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL
);
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.reservations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservations TO service_role';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.reservations FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.reservations FROM authenticated';
    END IF;
  END IF;
END $$;
