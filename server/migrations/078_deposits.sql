-- =============================================================================
--  078 — the deposit (عربون): reservations at the till, and the deposit a
--  website order needs (night shift 28 Oct 2026)
-- -----------------------------------------------------------------------------
--  Decided by the owner:
--    * At the till, a customer pays only a deposit and the pieces are put
--      aside for them: a customer must be attached; the deposit is at least
--      deposit.till_pct (50) of the total — more, never less, unless the owner
--      or the manager agrees a different amount with that customer; held for
--      deposit.hold_days (7). A slip prints; the customer comes back, the slip
--      is scanned, the rest is taken and the goods leave.
--    * Never collected: the bell says so, and the manager releases it — the
--      deposit becomes store credit (a refund is the manager's choice) and the
--      pieces go back on sale. Never automatic.
--    * A website order needs deposit.online_pct (50), changed per order by the
--      admin when accepting it; the website can read it.
--    * Reminders are the in-app bell only.
--
--  A RESERVATION IS A PICKUP ORDER PAID BY DEPOSIT (lib/orders.js), plus this
--  row. The order already does everything else, and the same way the delivery
--  office does it:
--    - the pieces leave stock with the sale (sales.payment = 'order'), so they
--      cannot be sold again, are not "in stock" on the till or the website,
--      and are back through the ordinary movement log when released;
--    - the deposit is an order_payments row (opId-guarded): cash goes into
--      the drawer when it is paid, like every order payment;
--    - what is still owed is DERIVED (Orders.money), never stored;
--    - releasing is Orders.takeBack with outcome credit (or refund): the
--      store-credit ledger, no cash moves for credit.
--  This table adds only what an order cannot say: until when it is held, the
--  minimum the deposit had to be and why. Its status is derived too:
--  collected = the pickup delivered; released = taken back or cancelled;
--  held = neither.
--
--  Cursor shape (an extension updates hold_until). Mirror file:
--  server/supabase/045_reservations.sql.
-- =============================================================================

CREATE TABLE reservations (
  sale_id      TEXT    PRIMARY KEY REFERENCES sales(id),
  customer_id  INTEGER REFERENCES customers(id),
  hold_until   TEXT    NOT NULL,
  -- The least the deposit could be, in the sale's currency and minor units,
  -- frozen when it was taken: deposit.till_pct of the total, or the amount the
  -- owner or the manager agreed with this customer (min_by says who).
  deposit_min  INTEGER NOT NULL CHECK (deposit_min >= 0),
  deposit_pct  INTEGER CHECK (deposit_pct IS NULL OR deposit_pct BETWEEN 0 AND 100),
  min_by       INTEGER REFERENCES users(id),
  extended     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL,
  created_by   INTEGER REFERENCES users(id),
  updated_at   TEXT    NOT NULL
);
CREATE INDEX reservations_until ON reservations(hold_until);

-- The deposit one website order needs, set by the admin when accepting it.
-- NULL = the default (deposit.online_pct). Local only, like the table.
ALTER TABLE web_orders ADD COLUMN deposit_pct      INTEGER;
ALTER TABLE web_orders ADD COLUMN deposit_amount   INTEGER;   -- minor units of deposit_currency
ALTER TABLE web_orders ADD COLUMN deposit_currency TEXT;
ALTER TABLE web_orders ADD COLUMN deposit_by       INTEGER;
ALTER TABLE web_orders ADD COLUMN deposit_at       TEXT;

INSERT OR IGNORE INTO config (key, value, updated_at) VALUES
  ('deposit.till_pct',   '50', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('deposit.online_pct', '50', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('deposit.hold_days',  '7',  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('deposit.chase_days', '3',  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
