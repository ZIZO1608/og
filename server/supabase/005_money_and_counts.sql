-- =============================================================================
--  Mirror schema for the drawer and the count sheet.
--  Run this in the Supabase SQL editor, like 003 and 004.
-- -----------------------------------------------------------------------------
--  Matches server/migrations/017_money_and_counts.sql column for column.
--
--  The ALTER at the bottom matters more than it looks. sales is pushed OUTSIDE
--  the guarded block, so the moment shift_id exists locally, SELECT * picks it
--  up and PostgREST rejects the whole sales batch on any project where this
--  file has not been run — a shop's entire day of sales would stop mirroring
--  over an optional table. The sync retries without the column and says to run
--  this; that fallback is a safety net, not a reason to skip the ALTER.
-- =============================================================================

CREATE TABLE IF NOT EXISTS shifts (
  id           TEXT PRIMARY KEY,
  user_id      BIGINT,
  user_name    TEXT,
  wh_id        TEXT REFERENCES warehouses(id),
  currency     TEXT NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  float_amount BIGINT NOT NULL DEFAULT 0,
  opened_at    TIMESTAMPTZ NOT NULL,
  closed_at    TIMESTAMPTZ,
  counted      BIGINT,
  expected     BIGINT,
  note         TEXT,
  created_by   BIGINT
);

CREATE TABLE IF NOT EXISTS expenses (
  id         TEXT PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL,
  category   TEXT NOT NULL,
  amount     BIGINT NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  method     TEXT NOT NULL DEFAULT 'cash',
  note       TEXT,
  shift_id   TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by BIGINT
);

CREATE TABLE IF NOT EXISTS debt_payments (
  id       BIGINT PRIMARY KEY,
  sale_id  TEXT NOT NULL REFERENCES sales(id),
  at       TIMESTAMPTZ NOT NULL,
  amount   BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  method   TEXT NOT NULL DEFAULT 'cash',
  shift_id TEXT,
  note     TEXT,
  user_id  BIGINT
);

CREATE TABLE IF NOT EXISTS stock_counts (
  id         TEXT PRIMARY KEY,
  wh_id      TEXT NOT NULL REFERENCES warehouses(id),
  scope      TEXT NOT NULL DEFAULT 'all',
  status     TEXT NOT NULL DEFAULT 'open'
             CHECK (status IN ('open','posted','cancelled')),
  started_at TIMESTAMPTZ NOT NULL,
  posted_at  TIMESTAMPTZ,
  note       TEXT,
  user_id    BIGINT,
  user_name  TEXT
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id         BIGINT PRIMARY KEY,
  count_id   TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  sku        TEXT NOT NULL REFERENCES variants(sku),
  counted    INTEGER NOT NULL,
  system_qty INTEGER,
  UNIQUE (count_id, sku)
);

--  No foreign key, matching cashier_id and stock_movements.ref_id. A real FK
--  would make a restore refuse the entire sales table whenever the mirror has
--  no shifts rows.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS shift_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_shift    ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_expenses_shift ON expenses(shift_id);
CREATE INDEX IF NOT EXISTS idx_debt_sale      ON debt_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_count_lines    ON stock_count_lines(count_id);

ALTER TABLE shifts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_count_lines ENABLE ROW LEVEL SECURITY;
