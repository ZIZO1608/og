-- =============================================================================
--  017 — the delivery office   (local migration 045)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor. Until it is run:
--
--    * lib/mirror-lag.js makes the sync push deliveries WITHOUT the twelve new
--      columns and name this file on every run. deliveries is in the unguarded
--      core loop, so without that fallback every delivery would be refused.
--    * order_payments is skipped by name behind a guard of its own, and the
--      day's sales and deliveries still go up.
--
--  Nothing is lost, only late. Afterwards, in this order:
--    npm run supabase:drift       -- should go green
--    npm run supabase:reconcile   -- REQUIRED: the cursor is already past every
--                                    delivery pushed with the columns dropped,
--                                    and they stay NULL here until it refills
--                                    them
--
--  The local schema carries the CHECK constraints; they are not repeated here,
--  so a sixth delivery method is a local migration and not a rejected batch.
--  `drawer` is SMALLINT (0/1) rather than boolean so the row pushes as it is.
-- =============================================================================

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS method       TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS company_id   TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS country      TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS city         TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS recipient    TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS fee          BIGINT NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS fee_mode     TEXT NOT NULL DEFAULT 'none';
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS fee_source   TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS plan         TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS channel      TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS tracking_no  TEXT;

CREATE INDEX IF NOT EXISTS deliveries_method ON deliveries (method, status);

CREATE TABLE IF NOT EXISTS order_payments (
  id           BIGINT PRIMARY KEY,
  sale_id      TEXT NOT NULL REFERENCES sales(id),
  kind         TEXT NOT NULL DEFAULT 'in',
  at           TIMESTAMPTZ NOT NULL,
  amount       BIGINT NOT NULL,
  currency     TEXT NOT NULL REFERENCES currencies(code),
  fx_rate      DOUBLE PRECISION NOT NULL,
  amount_order BIGINT NOT NULL,
  method       TEXT NOT NULL,
  drawer       SMALLINT NOT NULL DEFAULT 0,
  txn_ref      TEXT,
  stage        TEXT,
  received_by  BIGINT,
  shift_id     TEXT,
  handed_in_at TIMESTAMPTZ,
  handed_in_by BIGINT,
  note         TEXT,
  user_id      BIGINT,
  created_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_pay_sale  ON order_payments (sale_id);
CREATE INDEX IF NOT EXISTS idx_order_pay_shift ON order_payments (shift_id);

--  On, with no policies: the service key still works and nothing else can.
--  This table is who paid the shop how much, and by which transfer.
ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;
