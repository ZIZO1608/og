-- =============================================================================
--  OG SYSTEM — initial schema
-- -----------------------------------------------------------------------------
--  Two conventions run through the whole file. Read these first; they explain
--  most of the shapes below.
--
--  MONEY is never a float. Every amount is an INTEGER in minor units, paired
--  with the currency it was denominated in:
--      USD -> cents        ($12.50 is 1250)
--      SYP -> whole lira   (no subunit is used in practice)
--  `currencies.minor_exp` records the exponent so code never has to guess.
--  Floats are wrong for money at any scale, and doubly wrong when two
--  currencies with a five-order-of-magnitude gap are added together.
--
--  STOCK is derived, not asserted. `stock_movements` is append-only and is the
--  truth; `stock` is a running total maintained in the SAME transaction as the
--  movement that changed it. Two reasons:
--    1. sync becomes merging append-only logs, which barely conflicts
--    2. `CHECK (qty >= 0)` then makes overselling impossible in the database,
--       not merely discouraged in the UI -- two tills racing for the last pair
--       cannot both win, whatever the browsers believe
-- =============================================================================


-- ---------------------------------------------------------------- currencies
-- Seeded, not hard-coded, because the shop prices some goods in USD and some
-- in lira, and because Syria has redenominated before and may again.
CREATE TABLE currencies (
  code       TEXT PRIMARY KEY,          -- 'USD', 'SYP'
  symbol     TEXT NOT NULL,
  symbol_ar  TEXT NOT NULL,
  minor_exp  INTEGER NOT NULL DEFAULT 0 -- 2 => amount is cents, 0 => whole units
);

-- The USD/SYP rate over time. Kept as history rather than a single setting:
-- a sale must be reportable at the rate that applied WHEN IT HAPPENED, or last
-- month's profit silently changes every time the rate moves.
CREATE TABLE fx_rates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  base       TEXT NOT NULL REFERENCES currencies(code),
  quote      TEXT NOT NULL REFERENCES currencies(code),
  rate       REAL NOT NULL,             -- 1 base = `rate` quote
  set_at     TEXT NOT NULL,             -- ISO 8601 UTC
  set_by     INTEGER REFERENCES users(id)
);
CREATE INDEX fx_rates_lookup ON fx_rates (base, quote, set_at DESC);


-- --------------------------------------------------------------------- users
-- Roles mirror the employee list the app already models: Manager, Cashier,
-- Warehouse, Delivery -- plus 'partner' for Yalla Wear, who log in remotely and
-- must never see a customer name, a phone number or what OG charged.
CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN
                ('manager','cashier','warehouse','delivery','partner')),
  -- scrypt. Node's crypto has it built in, so there is no native dependency to
  -- compile and nothing from npm in the trust path.
  pw_hash     BLOB NOT NULL,
  pw_salt     BLOB NOT NULL,
  -- Stored because it was asked for. It is a genuine weakness: a hint good
  -- enough to jog your memory is usually good enough for a colleague to guess,
  -- and these accounts reach the money screens. Manager-initiated reset is the
  -- safer pattern and is also implemented.
  pw_hint     TEXT,
  phone       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 0,  -- set after an admin reset
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,          -- 256-bit random, hex
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- Rate limiting for the login form. Without this a public login page is a
-- free password-guessing service.
CREATE TABLE login_attempts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip       TEXT,
  ok       INTEGER NOT NULL,
  at       TEXT NOT NULL
);
CREATE INDEX login_attempts_lookup ON login_attempts (username, at DESC);


-- ---------------------------------------------------------------- warehouses
CREATE TABLE warehouses (
  id      TEXT PRIMARY KEY,             -- 'floor', 'store'
  name    TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('shop','storage')),
  sort    INTEGER NOT NULL DEFAULT 0
);


-- ------------------------------------------------------------------ products
CREATE TABLE products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,         -- sneakers, tshirts, jeans, ...
  brand          TEXT,
  made_in        TEXT,
  colorway       TEXT,
  -- The app draws a CSS colour block rather than loading a photo, so the
  -- "image" is a background colour plus initials. Kept as-is; it works offline
  -- and costs nothing to store.
  image_bg       TEXT,
  image_initials TEXT,
  -- Prices in the currency the item is actually priced in. Per your answer
  -- that some goods are USD and some lira, this cannot be a global setting.
  currency       TEXT NOT NULL REFERENCES currencies(code),
  cost_price     INTEGER NOT NULL DEFAULT 0,   -- minor units of `currency`
  selling_price  INTEGER NOT NULL DEFAULT 0,   -- minor units of `currency`
  shelf_zone     TEXT,
  hidden         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX products_type ON products (type);
CREATE INDEX products_name ON products (name);

-- One row per size of a product. `sku` stays the human-readable business key
-- the app already uses everywhere (OG-001-42).
CREATE TABLE variants (
  sku        TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size       TEXT NOT NULL,
  color      TEXT,
  barcode    TEXT UNIQUE,               -- EAN-13 or Code 128 payload
  shelf      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, size)
);
CREATE INDEX variants_product ON variants (product_id);
CREATE INDEX variants_barcode ON variants (barcode);


-- --------------------------------------------------------------------- stock
-- Running total per size per place. Never written on its own -- always in the
-- same transaction as the stock_movement that justifies it. The CHECK is the
-- real oversell guard.
CREATE TABLE stock (
  sku   TEXT NOT NULL REFERENCES variants(sku) ON DELETE CASCADE,
  wh_id TEXT NOT NULL REFERENCES warehouses(id),
  qty   INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (sku, wh_id)
);

-- Append-only. Nothing in the application may UPDATE or DELETE here; a
-- correction is another row with the opposite delta, so the trail stays honest.
CREATE TABLE stock_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  sku        TEXT NOT NULL REFERENCES variants(sku),
  wh_id      TEXT NOT NULL REFERENCES warehouses(id),
  type       TEXT NOT NULL CHECK (type IN
               ('received','sold','damaged','returned','transfer','count')),
  delta      INTEGER NOT NULL,          -- signed: -2 sold, +10 received
  balance    INTEGER NOT NULL,          -- qty at this place AFTER the move
  note       TEXT,
  user_id    INTEGER REFERENCES users(id),
  ref_type   TEXT,                      -- 'sale', 'po', 'transfer', 'count'
  ref_id     TEXT
);
CREATE INDEX movements_sku ON stock_movements (sku, at DESC);
CREATE INDEX movements_at  ON stock_movements (at DESC);
CREATE INDEX movements_ref ON stock_movements (ref_type, ref_id);


-- ----------------------------------------------------------------- customers
CREATE TABLE customers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  phone          TEXT,
  note           TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX customers_phone ON customers (phone);
CREATE INDEX customers_name  ON customers (name);


-- --------------------------------------------------------------------- sales
CREATE TABLE sales (
  id            TEXT PRIMARY KEY,       -- 'INV-2101'
  at            TEXT NOT NULL,
  customer_id   INTEGER REFERENCES customers(id),
  customer_name TEXT,                   -- denormalised: a receipt is a record
                                        -- of that moment, not a live join
  cashier_id    INTEGER REFERENCES users(id),
  wh_id         TEXT NOT NULL REFERENCES warehouses(id),
  payment       TEXT NOT NULL,
  -- Totals are settled into ONE currency at the till so a receipt has a single
  -- number on it, even when the basket mixes USD and lira goods.
  currency      TEXT NOT NULL REFERENCES currencies(code),
  subtotal      INTEGER NOT NULL,
  discount      INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL,
  -- The rate used, frozen. Without this, re-running last month's profit after
  -- the rate moves gives a different answer, and nobody can tell which is real.
  fx_rate       REAL NOT NULL,
  fx_base       TEXT NOT NULL,
  voided        INTEGER NOT NULL DEFAULT 0,
  void_reason   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX sales_at       ON sales (at DESC);
CREATE INDEX sales_customer ON sales (customer_id);

CREATE TABLE sale_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id        TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  sku            TEXT NOT NULL,
  product_id     INTEGER,
  name           TEXT NOT NULL,         -- as it read on the day
  size           TEXT,
  qty            INTEGER NOT NULL,
  -- Both the price as charged and what it cost, in the SALE's currency, so
  -- margin is arithmetic on one currency rather than a re-conversion later.
  unit_price     INTEGER NOT NULL,
  unit_cost      INTEGER NOT NULL,
  src_currency   TEXT NOT NULL REFERENCES currencies(code),
  src_unit_price INTEGER NOT NULL       -- price as listed on the product
);
CREATE INDEX sale_items_sale ON sale_items (sale_id);
CREATE INDEX sale_items_sku  ON sale_items (sku);


-- ------------------------------------------------------------------ sync log
-- One monotonic sequence for the whole database. A client asks "what changed
-- since seq N" and gets a replayable list. Simple, ordered, and it survives a
-- client being offline for a week -- which polling per-table timestamps does
-- not, because clock skew between devices reorders them.
CREATE TABLE change_log (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  tbl       TEXT NOT NULL,
  row_id    TEXT NOT NULL,
  op        TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  user_id   INTEGER REFERENCES users(id),
  -- Which device produced it, so a client can skip echoes of its own writes
  -- instead of applying them twice.
  origin    TEXT
);
CREATE INDEX change_log_seq ON change_log (seq);

-- Idempotency for the offline write queue. A client generates a uuid per
-- operation; a replay after a dropped connection finds the uuid already here
-- and returns the original result instead of selling the same shoe twice.
CREATE TABLE applied_ops (
  op_id      TEXT PRIMARY KEY,
  at         TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id),
  kind       TEXT NOT NULL,
  result     TEXT                       -- JSON, replayed verbatim on retry
);


-- -------------------------------------------------------------------- config
-- Runtime settings that used to be constants in js/data.js (shop name, low
-- stock thresholds, loyalty rates). Editable from Settings without a deploy.
CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
