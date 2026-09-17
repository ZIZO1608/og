-- =============================================================================
--  056 — when a purchase order is due
-- -----------------------------------------------------------------------------
--  The reorder dialog now asks when the goods should arrive. A plain
--  YYYY-MM-DD, the shop's own calendar day, never an instant: "the 20th" does
--  not move when the server's clock is in UTC.
--
--  NULL is an order nobody gave a date — the bell keeps its old rule for it
--  (sent fourteen days ago and nothing arrived). With a date, the order is
--  late the day after it.
--
--  Mirror twin: server/supabase/024_po_due.sql, declared in mirror-lag.js.
-- =============================================================================

ALTER TABLE purchase_orders ADD COLUMN due_date TEXT;
