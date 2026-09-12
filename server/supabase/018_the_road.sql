-- =============================================================================
--  018 — the road: handovers, returns, customer credit  (local 046 and 047)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, after 017. Until it is run the four
--  tables are skipped by name behind the delivery office's own guarded block
--  and everything else still mirrors; `deliveries.handover_id` is dropped by
--  lib/mirror-lag.js and this file is named on every run.
--
--  Afterwards: npm run supabase:drift, then npm run supabase:reconcile — the
--  cursor is already past every delivery pushed without its handover.
--
--  The local schema carries the CHECK constraints. RLS on, no policies: the
--  service key works and nothing else does, which is the whole security model
--  of the mirror.
-- =============================================================================

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS handover_id TEXT;
CREATE INDEX IF NOT EXISTS idx_deliveries_ho ON deliveries (handover_id);

CREATE TABLE IF NOT EXISTS handovers (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  driver_id    BIGINT,
  company_id   TEXT,
  company_name TEXT,
  status       TEXT NOT NULL DEFAULT 'open',
  opened_at    TIMESTAMPTZ NOT NULL,
  handed_at    TIMESTAMPTZ,
  note         TEXT,
  user_id      BIGINT,
  user_name    TEXT
);

CREATE TABLE IF NOT EXISTS handover_lines (
  id          BIGINT PRIMARY KEY,
  handover_id TEXT NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  delivery_id BIGINT NOT NULL REFERENCES deliveries(id),
  sale_id     TEXT NOT NULL REFERENCES sales(id),
  to_collect  BIGINT NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL REFERENCES currencies(code),
  at          TIMESTAMPTZ NOT NULL,
  UNIQUE (handover_id, delivery_id)
);

CREATE TABLE IF NOT EXISTS order_returns (
  id           BIGINT PRIMARY KEY,
  sale_id      TEXT NOT NULL REFERENCES sales(id),
  delivery_id  BIGINT,
  at           TIMESTAMPTZ NOT NULL,
  outcome      TEXT NOT NULL,
  reason       TEXT,
  restocked    INTEGER NOT NULL DEFAULT 0,
  wh_id        TEXT REFERENCES warehouses(id),
  due_minor    BIGINT NOT NULL DEFAULT 0,
  refund_minor BIGINT NOT NULL DEFAULT 0,
  kept_minor   BIGINT NOT NULL DEFAULT 0,
  credit_minor BIGINT NOT NULL DEFAULT 0,
  new_sale_id  TEXT,
  user_id      BIGINT,
  note         TEXT
);

CREATE TABLE IF NOT EXISTS order_return_lines (
  id         BIGINT PRIMARY KEY,
  return_id  BIGINT NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
  sku        TEXT NOT NULL,
  name       TEXT,
  size       TEXT,
  qty        INTEGER NOT NULL,
  unit_price BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_credit (
  id          BIGINT PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  at          TIMESTAMPTZ NOT NULL,
  kind        TEXT NOT NULL,
  amount      BIGINT NOT NULL,
  currency    TEXT NOT NULL REFERENCES currencies(code),
  sale_id     TEXT,
  note        TEXT,
  user_id     BIGINT,
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_handover_lines_ho  ON handover_lines (handover_id);
CREATE INDEX IF NOT EXISTS idx_order_returns_sale ON order_returns (sale_id);
CREATE INDEX IF NOT EXISTS idx_customer_credit_who ON customer_credit (customer_id, currency);
CREATE INDEX IF NOT EXISTS idx_order_return_lines ON order_return_lines (return_id);

ALTER TABLE handovers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE handover_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_returns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_return_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credit ENABLE ROW LEVEL SECURITY;
