-- =============================================================================
--  The drawer, and the count sheet.
-- -----------------------------------------------------------------------------
--  The last four collections with no server side at all. They lived in the
--  browser: a shift opened, expenses were recorded against it, a customer
--  settled a debt across the counter — and a page refresh threw all of it
--  away. The debt repayment is the one that matters most. It is real money
--  taken from a real person, and there was nowhere it was written down.
--
--  MONEY IS INTEGER MINOR UNITS IN THE SHOP'S BASE CURRENCY.
--  The `currency` column records WHICH base currency applied, not permission
--  to mix. A shift summary adds sale totals to expense amounts to debt
--  payments; if one of those were dollars and the rest lira the drawer figure
--  would be nonsense and nothing in the arithmetic would say so. The server
--  refuses a write whose currency is not the configured base.
-- =============================================================================

-- ------------------------------------------------------------------- shifts
--  A shift is a physical cash box, not a login session. Sessions expire
--  overnight, tabs close and tablets sleep; none of those mean the drawer was
--  counted, but every one of them would have ended the shift and lost the
--  variance exactly when it mattered. It is also routinely a handover — Lubna
--  opens, Maher closes — which no session can span. So: an explicit record,
--  opened and closed by hand, shop-wide.
CREATE TABLE IF NOT EXISTS shifts (
  id            TEXT PRIMARY KEY,             -- 'SH-0007'
  user_id       INTEGER REFERENCES users(id),
  --  Frozen. Who was on the till is an accountability record, and renaming an
  --  account next year must not rewrite who counted the box last night.
  user_name     TEXT,
  wh_id         TEXT    REFERENCES warehouses(id),
  currency      TEXT    NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),

  --  float_amount, not `float`. FLOAT is a type name in Postgres and the
  --  mirror would reject the column outright — while SQLite accepted it
  --  happily, so it would have been found in the sync log, not here.
  float_amount  INTEGER NOT NULL DEFAULT 0,

  opened_at     TEXT    NOT NULL,
  --  NULL means open. No separate `closed` flag: two facts about one thing is
  --  one fact that eventually disagrees with itself.
  closed_at     TEXT,

  --  What a person physically counted in the box. An observation, so it is
  --  stored.
  counted       INTEGER,
  --  And what the system said to expect AT THE MOMENT IT WAS CLOSED. This is
  --  arithmetic, which this schema usually derives — but the variance was
  --  signed off by somebody, and voiding a sale a week later must not quietly
  --  rewrite last Tuesday's cash difference. Frozen for the same reason a
  --  sale freezes its exchange rate.
  expected      INTEGER,

  note          TEXT,
  created_by    INTEGER REFERENCES users(id)
);

--  Which drawer a sale belongs to. js/pos.js already stamps this on the way
--  in and says why it is a stamp rather than a time window: a sale rung up
--  before the shift opened must never drift into its count.
--
--  Deliberately NO foreign key, following stock_movements.ref_id. A real FK
--  makes the restore refuse the ENTIRE sales table whenever the mirror has no
--  shifts rows — which is the state of any shop that has not yet run the
--  Supabase half by hand. A year of sales must never be dropped because an
--  optional table is missing.
ALTER TABLE sales ADD COLUMN shift_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);

-- ----------------------------------------------------------------- expenses
--  Money out. An expense NEVER touches suppliers.outstanding: receiving a
--  purchase order already books what the shop owes, so moving it here too
--  would pay the same supplier twice in the ledger. Worse for profit — the
--  goods are already counted through cost price, so an expense for the same
--  purchase subtracts it a second time.
CREATE TABLE IF NOT EXISTS expenses (
  id          TEXT    PRIMARY KEY,            -- 'EX-0031'
  at          TEXT    NOT NULL,
  --  No CHECK. The list of categories will grow — internet, municipality —
  --  and a CHECK makes each of those a migration. It lives in config as
  --  `expense.categories`, the same idiom label.stations already uses, so
  --  Settings can add one without a deploy.
  category    TEXT    NOT NULL,
  --  Always positive. The sign is in the fact that it is an expense; a table
  --  that mixes conventions makes SUM(amount) meaningless.
  amount      INTEGER NOT NULL CHECK (amount > 0),
  currency    TEXT    NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  method      TEXT    NOT NULL DEFAULT 'cash',
  note        TEXT,
  --  Stamped with the open shift, never matched by time — rent paid on a
  --  Sunday with no shift open is a real state, and that is what NULL means.
  shift_id    TEXT,
  created_at  TEXT    NOT NULL,
  created_by  INTEGER REFERENCES users(id)
);

-- ------------------------------------------------------------ debt payments
--  A customer paying down a credit sale. The severest of the four gaps: cash
--  crossed the counter and nothing recorded it.
--
--  No `paid` and no `balance` column on sales. The balance is
--  total - SUM(payments), exactly the way partner invoices already work. A
--  stored balance is a second source of truth for money, and the first
--  partial payment makes it wrong.
CREATE TABLE IF NOT EXISTS debt_payments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  --  A real FK here, unlike sales.shift_id: a payment against a sale that
  --  does not exist is not a payment. Sales are restored before this table
  --  in every path, so the ordering holds.
  sale_id   TEXT    NOT NULL REFERENCES sales(id),
  at        TEXT    NOT NULL,
  amount    INTEGER NOT NULL CHECK (amount > 0),
  currency  TEXT    NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  method    TEXT    NOT NULL DEFAULT 'cash',
  shift_id  TEXT,
  note      TEXT,
  user_id   INTEGER REFERENCES users(id)
);

-- ------------------------------------------------------------ stock counts
--  The session, not the adjustment. Counting already moves stock through the
--  ordinary endpoint; what was missing is the record of who counted, when,
--  what the sheet said and what it disagreed with.
CREATE TABLE IF NOT EXISTS stock_counts (
  id         TEXT    PRIMARY KEY,             -- 'CNT-0007'
  wh_id      TEXT    NOT NULL REFERENCES warehouses(id),
  scope      TEXT    NOT NULL DEFAULT 'all',
  status     TEXT    NOT NULL DEFAULT 'open'
             CHECK (status IN ('open','posted','cancelled')),
  started_at TEXT    NOT NULL,
  posted_at  TEXT,
  note       TEXT,
  user_id    INTEGER REFERENCES users(id),
  user_name  TEXT
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id   TEXT    NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  sku        TEXT    NOT NULL REFERENCES variants(sku),
  counted    INTEGER NOT NULL,
  --  What the system said at the moment it was posted. The one place storing
  --  a derived number is right: the whole point of a count is the variance
  --  THEN, and by the time anyone reads the sheet in June the live figure has
  --  moved. Same reasoning as a sale freezing its rate. The variance itself
  --  stays derived.
  system_qty INTEGER,
  --  Walking the same shelf twice in one session overwrites; it does not
  --  append a second opinion.
  UNIQUE (count_id, sku)
);

-- ------------------------------------------------------------------ indexes
CREATE INDEX IF NOT EXISTS idx_expenses_at    ON expenses(at);
CREATE INDEX IF NOT EXISTS idx_expenses_shift ON expenses(shift_id);
CREATE INDEX IF NOT EXISTS idx_debt_sale      ON debt_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_debt_shift     ON debt_payments(shift_id);
CREATE INDEX IF NOT EXISTS idx_shifts_open    ON shifts(closed_at);
CREATE INDEX IF NOT EXISTS idx_count_lines    ON stock_count_lines(count_id);

-- ---------------------------------------------------------- seed: categories
--  Lifted from the list the frontend has been drawing all along, so the money
--  screen reads the same before and after. `supplier` is deliberately NOT
--  here: see the expenses comment above — paying a supplier is already
--  recorded when the delivery is received.
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES
  ('expense.categories', 'rent,generator,salaries,transport,packaging,other', datetime('now'));
