-- =============================================================================
--  023 — paying suppliers and staff  (local 055)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, after 022. Until it is run the sync
--  skips both ledgers BY NAME behind the cash book's guard, pushes employees
--  without pay_day (lib/mirror-lag.js) and names this file every run; the boot
--  pull refuses with `drift`.
--
--  Afterwards: npm run supabase:drift, then npm run supabase:reconcile — the
--  employees already pushed without their pay day need it filled in.
--
--  Both tables are append-only: a mistaken payment is a `reversal` row. RLS
--  on, no policies — this is what the shop paid people.
-- =============================================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_day INTEGER;

CREATE TABLE IF NOT EXISTS supplier_ledger (
  id            BIGINT PRIMARY KEY,
  supplier_id   BIGINT NOT NULL REFERENCES suppliers(id),
  at            TIMESTAMPTZ NOT NULL,
  kind          TEXT NOT NULL,
  amount        BIGINT NOT NULL,
  currency      TEXT NOT NULL REFERENCES currencies(code),
  paid_amount   BIGINT,
  paid_currency TEXT,
  fx_rate       DOUBLE PRECISION NOT NULL,
  place         TEXT,
  reverses_id   BIGINT,
  ref_type      TEXT,
  ref_id        TEXT,
  note          TEXT,
  user_id       BIGINT,
  created_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_who ON supplier_ledger (supplier_id, at);

CREATE TABLE IF NOT EXISTS salary_payments (
  id           BIGINT PRIMARY KEY,
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  month        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  amount       BIGINT NOT NULL,
  currency     TEXT NOT NULL REFERENCES currencies(code),
  fx_rate      DOUBLE PRECISION NOT NULL,
  place        TEXT,
  reverses_id  BIGINT,
  at           TIMESTAMPTZ NOT NULL,
  note         TEXT,
  user_id      BIGINT,
  created_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_salary_payments_who ON salary_payments (employee_id, month);

ALTER TABLE supplier_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_payments ENABLE ROW LEVEL SECURITY;

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
  FOREACH t IN ARRAY ARRAY['supplier_ledger', 'salary_payments'] LOOP
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
