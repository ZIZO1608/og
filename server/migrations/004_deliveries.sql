-- =============================================================================
--  Deliveries, and a ceiling on discounts
-- -----------------------------------------------------------------------------
--  The shop already sells on 'cod' -- cash on delivery -- and has a delivery
--  role with a person in it. What it did not have was anywhere to record that a
--  sale is going out, where to, or whether the money came back. Talal's job
--  lived entirely on paper and in his head.
--
--  PHASE ONE IS THE LIST. Assign a sale to a driver, he sees his runs, he marks
--  each one delivered or not. The end-of-day cash settle-up is deliberately not
--  built yet -- but `to_collect` and `collected` are recorded from the first
--  delivery, so adding it later is a screen, not a migration and a backfill.
--
--  Money here follows the same two rules as everywhere else in this database:
--  integer minor units, never floats, and the currency stored beside the
--  amount. A delivery's `to_collect` is frozen at assignment for the same
--  reason a sale's fx_rate is -- what he was sent out to collect must not
--  change underneath him because someone edited a price at lunchtime.
-- =============================================================================

-- --------------------------------------------------------------- an address
--  On the customer, and nullable, because most customers never have anything
--  delivered. It is only ever the DEFAULT offered at the till: the real address
--  lives on the delivery row, since the same person has a parcel sent to their
--  shop one week and their flat the next, and overwriting the customer record
--  each time would quietly lose both.
ALTER TABLE customers ADD COLUMN address TEXT;


-- --------------------------------------------------------------- deliveries
CREATE TABLE deliveries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     TEXT NOT NULL REFERENCES sales(id),
  driver_id   INTEGER REFERENCES users(id),

  -- waiting   : assigned to nobody yet, or assigned but still in the shop
  -- out       : the driver has it and has left
  -- delivered : handed over
  -- failed    : came back undelivered, with a reason
  status      TEXT NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting','out','delivered','failed')),

  -- Copied, not joined. A delivery note is a record of what he was told that
  -- morning; editing the customer later must not rewrite where he was sent.
  address     TEXT NOT NULL,
  phone       TEXT,
  note        TEXT,

  -- What he must come back with. Zero for an order already paid in the shop.
  to_collect  INTEGER NOT NULL DEFAULT 0,
  collected   INTEGER NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL REFERENCES currencies(code),

  assigned_at TEXT NOT NULL,
  assigned_by INTEGER REFERENCES users(id),
  out_at      TEXT,
  closed_at   TEXT,
  fail_reason TEXT,

  -- A sale goes out once. Two delivery rows for one invoice means two drivers
  -- turning up at the same door, or the same money counted twice at the close.
  UNIQUE (sale_id)
);

CREATE INDEX deliveries_driver ON deliveries (driver_id, status);
CREATE INDEX deliveries_status ON deliveries (status, assigned_at);


-- ------------------------------------------------------------ discount cap
--  A number in the database rather than in code, so the shop can move it
--  without a deploy. The permission below is what lets someone exceed it.
INSERT INTO config (key, value, updated_at) VALUES
  ('sale.max_discount_pct', '10', '1970-01-01T00:00:00.000Z');


-- ----------------------------------------------------------- new permissions
--  Seeded for every role so the Settings grid has a complete matrix. A role
--  missing a row would render as an empty cell rather than an unticked box.
--
--  delivery.read      see the delivery list. A driver is scoped to his OWN
--                     runs in code -- this permission does not widen that.
--  delivery.write     assign a delivery, and mark one out/delivered/failed.
--  discount.unlimited exceed sale.max_discount_pct. Manager only by default.
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('manager',  'delivery.read',      1, '1970-01-01T00:00:00.000Z'),
  ('manager',  'delivery.write',     1, '1970-01-01T00:00:00.000Z'),
  ('manager',  'discount.unlimited', 1, '1970-01-01T00:00:00.000Z'),

  -- She can flag a sale for delivery at the till, which needs the write.
  -- Seeing the board is the manager's job, so she does not get the read.
  ('cashier',  'delivery.read',      0, '1970-01-01T00:00:00.000Z'),
  ('cashier',  'delivery.write',     1, '1970-01-01T00:00:00.000Z'),
  ('cashier',  'discount.unlimited', 0, '1970-01-01T00:00:00.000Z'),

  ('warehouse','delivery.read',      0, '1970-01-01T00:00:00.000Z'),
  ('warehouse','delivery.write',     0, '1970-01-01T00:00:00.000Z'),
  ('warehouse','discount.unlimited', 0, '1970-01-01T00:00:00.000Z'),

  ('delivery', 'delivery.read',      1, '1970-01-01T00:00:00.000Z'),
  ('delivery', 'delivery.write',     1, '1970-01-01T00:00:00.000Z'),
  ('delivery', 'discount.unlimited', 0, '1970-01-01T00:00:00.000Z'),

  ('partner',  'delivery.read',      0, '1970-01-01T00:00:00.000Z'),
  ('partner',  'delivery.write',     0, '1970-01-01T00:00:00.000Z'),
  ('partner',  'discount.unlimited', 0, '1970-01-01T00:00:00.000Z');


-- ------------------------------------------------- what the driver stops seeing
--  Talal was given stock.read and print.read when the roles were first written,
--  before anyone had asked what he actually does. He does not touch stock and
--  he does not run the printer: he takes orders out, brings money back, and
--  looks up a price while he is standing in someone's doorway.
--
--  product.read and customer.read stay -- that is the price lookup and the
--  person he is delivering to. A manager can turn these back on in Settings if
--  the shop turns out to work differently.
UPDATE role_permissions
   SET allowed = 0, updated_at = '1970-01-01T00:00:00.000Z'
 WHERE role = 'delivery' AND perm IN ('stock.read', 'print.read');
