-- =============================================================================
--  Mirror schema for purchase orders and the bell's read state.
--  Run this in the Supabase SQL editor, like 003.
-- -----------------------------------------------------------------------------
--  Matches server/migrations/016_purchasing_and_alerts.sql column for column.
--
--  The alerts themselves are NOT here and never will be. An alert is computed
--  from the shop's current state every time it is asked for; storing one would
--  be storing a fact about a state that has already moved on. What is worth
--  keeping is which ones a person has read.
-- =============================================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            TEXT PRIMARY KEY,
  supplier_id   BIGINT REFERENCES suppliers(id),
  supplier_name TEXT,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','sent','received','cancelled')),
  currency      TEXT NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  wh_id         TEXT REFERENCES warehouses(id),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ,
  received_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL,
  created_by    BIGINT
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id           BIGINT PRIMARY KEY,
  po_id        TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL REFERENCES variants(sku),
  qty          INTEGER NOT NULL,
  unit_cost    BIGINT NOT NULL DEFAULT 0,
  received_qty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notification_reads (
  user_id BIGINT NOT NULL,
  key     TEXT   NOT NULL,
  read_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_po_lines_po  ON purchase_order_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_sku ON purchase_order_lines(sku);
CREATE INDEX IF NOT EXISTS idx_po_status    ON purchase_orders(status);

ALTER TABLE purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_reads   ENABLE ROW LEVEL SECURITY;
