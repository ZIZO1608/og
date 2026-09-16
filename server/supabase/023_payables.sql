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
