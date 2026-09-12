-- =============================================================================
--  046 — the road: handovers, returns, and money the shop owes a customer
-- -----------------------------------------------------------------------------
--  045 built the office. This is what happens after the parcel leaves the
--  counter: it is handed to somebody in a batch, it may come back, and when it
--  comes back the money has to go somewhere.
--
--  A HANDOVER IS THE PIECE OF PAPER SOMEBODY SIGNS. The driver or the courier
--  is standing at the counter with an armful of bags; the office scans each
--  slip, and the sheet that prints lists exactly those parcels and the total
--  cash to bring back. One transaction moves them all to `out` through the
--  same guards a single parcel goes through — a company parcel with money
--  owed is refused there and stays on the counter.
--
--  A RETURN IS FOUR DIFFERENT DECISIONS, and the owner said the shop uses all
--  four: send another size, keep the money as credit, refund it, or keep the
--  shipping and refund the rest. So `outcome` is recorded rather than implied
--  by which columns happen to be filled in, and the stock going back on the
--  shelf is written through the ordinary movement log (Stock.apply) like every
--  other piece of stock that moves.
--
--  CREDIT IS NOT A REFUND. Money kept as credit is money the shop still owes
--  the person, and it is spent on a later order — so it is its own ledger with
--  grants and spends, never a balance column that the first part-spend makes
--  wrong. It is the same reasoning as order_payments, one table down.
-- =============================================================================

-- ------------------------------------------------------------- the handover
CREATE TABLE IF NOT EXISTS handovers (
  id           TEXT PRIMARY KEY,               -- 'HO-0001'
  --  Who is taking them. A driver is a users row; a company is an id and a
  --  name out of config, frozen the way deliveries.company_name is.
  kind         TEXT NOT NULL CHECK (kind IN ('driver','company')),
  driver_id    INTEGER REFERENCES users(id),
  company_id   TEXT,
  company_name TEXT,

  --  open     the office is still scanning parcels onto it
  --  handed   they signed and left; every line is `out`
  --  cancelled  abandoned before anything left the shop
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','handed','cancelled')),
  opened_at    TEXT NOT NULL,
  handed_at    TEXT,
  note         TEXT,
  user_id      INTEGER REFERENCES users(id),
  --  Frozen: who handed the parcels over is an accountability record, and
  --  renaming an account next year must not rewrite it.
  user_name    TEXT
);

CREATE TABLE IF NOT EXISTS handover_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  handover_id TEXT    NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  sale_id     TEXT    NOT NULL REFERENCES sales(id),
  --  What this parcel was worth to collect AT THE MOMENT IT WAS HANDED OVER.
  --  The sheet is a receipt for a person carrying money, and a later payment
  --  must not rewrite what they signed for.
  to_collect  INTEGER NOT NULL DEFAULT 0,
  currency    TEXT    NOT NULL REFERENCES currencies(code),
  at          TEXT    NOT NULL,
  --  Scanning the same slip twice onto one sheet is a double tap, not a
  --  second parcel.
  UNIQUE (handover_id, delivery_id)
);

--  Which sheet a parcel left on. Nullable for every delivery that predates
--  this and for anything handed over one at a time from the board.
ALTER TABLE deliveries ADD COLUMN handover_id TEXT;

CREATE INDEX IF NOT EXISTS idx_handover_lines_ho ON handover_lines (handover_id);
CREATE INDEX IF NOT EXISTS idx_handover_lines_dl ON handover_lines (delivery_id);
CREATE INDEX IF NOT EXISTS idx_handovers_open    ON handovers (status, opened_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_ho     ON deliveries (handover_id);

-- --------------------------------------------------------------- the return
CREATE TABLE IF NOT EXISTS order_returns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     TEXT    NOT NULL REFERENCES sales(id),
  delivery_id INTEGER REFERENCES deliveries(id),
  at          TEXT    NOT NULL,

  --  exchange  another size goes out; what was paid carries over
  --  credit    the money stays with the shop, for the customer's next order
  --  refund    the money goes back
  --  keep_fee  the shipping is kept and the rest refunded
  outcome     TEXT    NOT NULL CHECK (outcome IN ('exchange','credit','refund','keep_fee')),
  reason      TEXT,

  --  How many pieces went back on which shelf. The movement itself is an
  --  ordinary stock movement (type 'returned'), not a number invented here.
  restocked   INTEGER NOT NULL DEFAULT 0,
  wh_id       TEXT    REFERENCES warehouses(id),

  --  All three in the SALE's currency and minor units, all three positive:
  --  the sign lives in the column's name, as everywhere else in this schema.
  refund_minor INTEGER NOT NULL DEFAULT 0 CHECK (refund_minor >= 0),
  kept_minor   INTEGER NOT NULL DEFAULT 0 CHECK (kept_minor >= 0),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),

  --  An exchange points at the order that replaced this one.
  new_sale_id TEXT    REFERENCES sales(id),
  user_id     INTEGER REFERENCES users(id),
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_returns_sale ON order_returns (sale_id);
CREATE INDEX IF NOT EXISTS idx_order_returns_at   ON order_returns (at);

-- ------------------------------------------------------- money the shop owes
--  A ledger, not a balance. A grant when a return is kept as credit, a spend
--  when a later order uses it; what is left is the difference, derived. A
--  stored balance is a second source of truth about money, and the first
--  part-spend makes it wrong — the same argument as debt_payments in 017.
CREATE TABLE IF NOT EXISTS customer_credit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  at          TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('grant','spend')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  currency    TEXT    NOT NULL REFERENCES currencies(code),
  --  The order it came from, or the order it was spent on.
  sale_id     TEXT    REFERENCES sales(id),
  note        TEXT,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_credit_who ON customer_credit (customer_id, currency);
CREATE INDEX IF NOT EXISTS idx_customer_credit_at  ON customer_credit (at);
