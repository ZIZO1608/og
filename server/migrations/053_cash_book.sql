-- =============================================================================
--  053 — the cash book: where every lira and dollar is, right now
-- -----------------------------------------------------------------------------
--  Money reaches this shop through the drawer, the owner's own pocket, and nine
--  transfer offices and wallets — Sham Cash, Fuad, Haram and the rest — and the
--  owner says money SITS in those as a balance until he takes it out. The system
--  recorded which method a sale used and nothing about how much was where.
--
--  THE STOCK MOVEMENT LOG, APPLIED TO MONEY. Stock is places, an append-only
--  log of movements, and totals derived from the log. Money gets the same
--  shape: a PLACE is where money physically is, a MOVE is one signed row
--  (place, currency, amount) with a kind and a reference, and a balance is
--  SUM(amount) per place and currency. Nothing stores a balance — the reason
--  Money.openDebts has none: a stored balance is a second source of truth, and
--  the first write that forgets it makes it wrong.
--
--  WHY NOT A DOUBLE-ENTRY LEDGER. Debits and credits are vocabulary nobody here
--  reads, and the owner is moving off paper, not onto accounting software.
--  Every move still names both sides — the place, and what the money was for
--  (kind + ref), or the other place for a transfer — which is enough for a
--  balance, a cash flow and a profit and loss.
--
--  APPEND-ONLY, AND CORRECTIONS ARE NEW ROWS. That is load-bearing twice: the
--  trail stays honest ("we were 4,000 short in March" survives), and the mirror
--  pushes this table above the highest id already sent, which never sees an
--  UPDATE. A voided expense is an `expense_void` row, not a flag.
--
--  PLACES ARE TEXT, NOT A TABLE, and deliberately carry no foreign key:
--    drawer            the till's cash box
--    owner             "with the owner" — the nightly cash, still used for shop costs
--    m:<method id>     a wallet or transfer office, one per pay.methods entry
--    driver:<user id>  door cash a driver collected and has not handed in
--    x:<id>            anything the owner adds (a safe, a bank): config money.places
--  Wallets are DERIVED from pay.methods so there is no second list to keep in
--  step; a method switched off keeps its balance, because ids are never deleted.
-- =============================================================================

CREATE TABLE IF NOT EXISTS money_moves (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT    NOT NULL,
  place      TEXT    NOT NULL,
  currency   TEXT    NOT NULL REFERENCES currencies(code),
  --  Signed, in the currency's minor units: + money arrived, - money left.
  --  Zero only for a check that matched, a first balance of nothing, or the
  --  marker that voids an expense written before this table existed — each a
  --  fact worth keeping ("Sham Cash checked on the 16th: exact") that moves
  --  nothing.
  amount     INTEGER NOT NULL
             CHECK (amount <> 0 OR kind IN ('opening', 'count_diff', 'expense_void')),
  --  sale sale_void debt_in order_in order_refund expense expense_void
  --  partner_pay owner_draw owner_in transfer exchange fee count_diff opening.
  --  No CHECK, for the reason deliveries.channel has none: the list grows with
  --  suppliers and salaries (phase 3), and each new kind would be a rebuild.
  --  lib/cashbook.js refuses anything it does not know.
  kind       TEXT    NOT NULL,
  --  USD -> this currency at that moment, frozen — sales.fx_rate's meaning.
  --  For an exchange it is the rate actually got at the office, which is the
  --  whole point: the difference from the shop's rate is a gain or a loss.
  fx_rate    REAL    NOT NULL,
  --  The other half of a transfer or an exchange, and the row a reversal
  --  undoes. Points BACKWARDS only (the second row names the first), because
  --  the first cannot be updated once written.
  pair_id    INTEGER,
  ref_type   TEXT,
  ref_id     TEXT,
  note       TEXT,
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_money_moves_place ON money_moves (place, currency, at);
CREATE INDEX IF NOT EXISTS idx_money_moves_ref   ON money_moves (ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_money_moves_at    ON money_moves (at);

--  The owner's own places — a safe, a bank account. [{ id, en, ar, active }]
--  Mirrored whole with the rest of config, so a restored shop keeps them.
INSERT INTO config (key, value, updated_at) VALUES
  ('money.places', '[]', '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;

--  Moving money between places, changing dollars, the owner taking money out
--  or putting it in, and checking a balance. Manager only: every one of these
--  says where the shop's money went, and none of them is a sale. The partner
--  can never be given it — FORBIDDEN refuses anything starting with 'money.'.
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('manager',   'money.move', 1, '1970-01-01T00:00:00.000Z'),
  ('cashier',   'money.move', 0, '1970-01-01T00:00:00.000Z'),
  ('warehouse', 'money.move', 0, '1970-01-01T00:00:00.000Z'),
  ('delivery',  'money.move', 0, '1970-01-01T00:00:00.000Z'),
  ('partner',   'money.move', 0, '1970-01-01T00:00:00.000Z')
ON CONFLICT DO NOTHING;
