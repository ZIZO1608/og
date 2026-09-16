-- =============================================================================
--  055 — paying suppliers and staff
-- -----------------------------------------------------------------------------
--  Nothing in the system could lower what the shop owes a supplier: receiving
--  a purchase order added to suppliers.outstanding, and the only way down was
--  typing a new number into a route no screen called. Nothing could record a
--  salary or an advance either, and the payroll bell, keyed on a date nothing
--  ever moved, could never clear.
--
--  THE SUPPLIER: THE STOCK PATTERN. `supplier_ledger` is the movement log;
--  `suppliers.outstanding` is its running total, written in the SAME
--  transaction as every row — exactly as stock.qty sits beside
--  stock_movements. The four places that read `outstanding` (the bell, the
--  dashboard, two Reports blocks) stay right without learning a new query, and
--  lib/payables.js audit() proves the total still equals the log.
--
--  ONE DEBT CURRENCY PER SUPPLIER — suppliers.currency. A purchase order in
--  the other currency, or a payment made in it, is converted INTO the
--  supplier's currency at the moment it happens and the rate frozen on the
--  row. `Purchasing.receive` used to add a dollar order's cents to a lira
--  balance as lira. What actually left the shop is kept beside it
--  (paid_amount, paid_currency), because that is what the cash book moved.
--
--  A PAYMENT IS NOT AN EXPENSE. The goods are already in cost price; booking
--  the payment as a cost too would take it off profit twice (017's rule).
--
--  STAFF: MONTHLY, WITH ADVANCES — the owner's answer. A month is owed
--  salary + bonuses − deductions; advances and the salary payment are what
--  was paid against it; what is left is the difference. Bonus and deduction
--  move no money. Advance and salary do, out of the place they were paid
--  from, through the cash book.
--
--  BOTH TABLES ARE APPEND-ONLY. A mistaken payment is undone by a `reversal`
--  row naming it, and its money comes back through the cash book, so the
--  mirror's highest-id bookmark sees every change.
-- =============================================================================

CREATE TABLE IF NOT EXISTS supplier_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
  at            TEXT    NOT NULL,
  --  opening   what was owed on paper before the system knew
  --  purchase  goods that arrived on a purchase order
  --  payment   money the shop paid
  --  return    goods sent back, credited by the supplier
  --  adjust    a correction either way, with a reason
  --  reversal  a payment undone (reverses_id names it)
  kind          TEXT    NOT NULL
                CHECK (kind IN ('opening', 'purchase', 'payment', 'return', 'adjust', 'reversal')),
  --  Signed, in the SUPPLIER's currency: + the shop owes more, − it owes less.
  amount        INTEGER NOT NULL CHECK (amount <> 0),
  currency      TEXT    NOT NULL REFERENCES currencies(code),
  --  What physically left (or came back), when that was a different currency.
  paid_amount   INTEGER,
  paid_currency TEXT REFERENCES currencies(code),
  --  USD -> paid_currency (or currency) at that moment, frozen.
  fx_rate       REAL    NOT NULL,
  --  The cash-book place the money left from, for a payment.
  place         TEXT,
  reverses_id   INTEGER REFERENCES supplier_ledger(id),
  ref_type      TEXT,
  ref_id        TEXT,
  note          TEXT,
  user_id       INTEGER REFERENCES users(id),
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_who ON supplier_ledger (supplier_id, at);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_ref ON supplier_ledger (ref_type, ref_id);

CREATE TABLE IF NOT EXISTS salary_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id),
  --  The month this counts against, YYYY-MM — an advance on the 12th of
  --  September is September's money whenever it is paid.
  month        TEXT    NOT NULL CHECK (length(month) = 7),
  kind         TEXT    NOT NULL
               CHECK (kind IN ('advance', 'salary', 'bonus', 'deduction', 'reversal')),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  currency     TEXT    NOT NULL REFERENCES currencies(code),
  fx_rate      REAL    NOT NULL,
  --  The cash-book place it was paid from — advance and salary only.
  place        TEXT,
  reverses_id  INTEGER REFERENCES salary_payments(id),
  at           TEXT    NOT NULL,
  note         TEXT,
  user_id      INTEGER REFERENCES users(id),
  created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_salary_payments_who ON salary_payments (employee_id, month);

--  The day of the month salaries are due. 1–28, so February has one.
ALTER TABLE employees ADD COLUMN pay_day INTEGER CHECK (pay_day IS NULL OR pay_day BETWEEN 1 AND 28);

--  What was owed before the ledger existed becomes its opening row, so the
--  running total and the log agree from the first minute.
INSERT INTO supplier_ledger (supplier_id, at, kind, amount, currency, fx_rate, note, created_at)
SELECT s.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'opening', s.outstanding, s.currency,
       COALESCE((SELECT r.rate FROM fx_rates r WHERE r.base = 'USD' AND r.quote = s.currency
                  ORDER BY r.set_at DESC, r.id DESC LIMIT 1),
                CASE WHEN s.currency = 'USD' THEN 1 ELSE 0 END),
       'balance before the ledger (055)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM suppliers s
 WHERE s.outstanding <> 0;
