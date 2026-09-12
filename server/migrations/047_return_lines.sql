-- =============================================================================
--  047 — which pieces came back, and what that takes off the bill
-- -----------------------------------------------------------------------------
--  This belongs in 046 and is not in it, because 046 had already run on the
--  shop's own database by the time the returns were written. A migration that
--  has been applied is finished: editing the file would leave this machine on
--  one schema and every other on another, with `schema_migrations` claiming
--  they match. So the two things 046 turned out to need are added here, and a
--  fresh database ends up byte for byte where the shop already is.
--
--  WHICH PIECES. A return of one size out of three is the ordinary case — the
--  customer keeps the trainers and sends back the shirt — so "what can still
--  come back" has to be answerable per size. A count on the parent could only
--  ever answer it for the whole order, and would let the same pair come back
--  twice. `name`, `size` and `unit_price` are frozen here for the same reason
--  sale_items freezes them: the shelf price moves, and what came back came
--  back at what it was sold for.
--
--  WHAT IT TAKES OFF THE BILL. `due_minor` is the one number a return must not
--  recompute later: the pieces stop being owed at the price they were SOLD at,
--  plus the shipping unless the shop is keeping it. Money already paid and no
--  longer owed leaves through a refund row — cash, a transfer, or shop credit,
--  which is the same money staying where it is with the customer's name on it
--  — so `paid` falls with `due` and every one of the four outcomes lands the
--  order at nil.
--
--  The CHECK (>= 0) the other three money columns carry cannot be added to an
--  existing table in SQLite without rebuilding it, and rebuilding a table that
--  holds real returns to gain an assertion the server already makes is a worse
--  trade than doing without. Orders.takeBack never writes a negative.
-- =============================================================================

ALTER TABLE order_returns ADD COLUMN due_minor INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS order_return_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id  INTEGER NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
  sku        TEXT    NOT NULL,
  name       TEXT,
  size       TEXT,
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_order_return_lines ON order_return_lines (return_id);
