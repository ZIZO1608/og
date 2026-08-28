-- =============================================================================
--  OG SYSTEM — Supabase mirror schema
-- -----------------------------------------------------------------------------
--  Paste this into the Supabase SQL Editor and press Run. It is safe to run
--  more than once: every statement is IF NOT EXISTS or CREATE OR REPLACE.
--
--  WHAT THIS IS
--  ------------
--  The shop's till runs on the local SQLite database and keeps running when
--  the internet does not — which in Aleppo is the whole point. This schema is
--  the CLOUD COPY of that data: the same rows, pushed up as they change, so
--  reports, remote access, the Yalla Wear portal and off-site backup have
--  something to read that is not sitting on a PC behind the counter.
--
--  SQLite stays the source of truth. Nothing writes to this database except
--  the sync worker. If the two ever disagree, the shop's copy is right.
--
--  TWO DELIBERATE OMISSIONS — both security, not oversight
--  -------------------------------------------------------
--  1. NO PASSWORD MATERIAL. `users` here carries id, name, role and little
--     else. pw_hash, pw_salt and pw_hint stay on the shop's machine. A cloud
--     database is a much broader target than a PC in a back office, and
--     mirroring scrypt hashes would put every staff password in it for no
--     benefit — reporting needs to know WHO sold something, not how they log
--     in. `sessions` and `login_attempts` are omitted entirely for the same
--     reason: live session tokens in a second place is pure liability.
--
--  2. ROW LEVEL SECURITY IS ON EVERYWHERE, WITH NO POLICIES.
--     This is the important one. A Supabase table in the `public` schema with
--     RLS off is readable by anyone holding the anon key — and the anon key
--     is, by design, public. RLS enabled with zero policies means: the anon
--     and authenticated roles can read nothing at all, while the service_role
--     key (which bypasses RLS, and which only the server holds) works
--     normally. If a screen is ever built to read this directly, add a
--     policy then, deliberately, rather than leaving the door open now.
--
--  IDs ARE COPIED, NEVER GENERATED
--  --------------------------------
--  Every primary key below is a plain BIGINT, not BIGSERIAL and not GENERATED
--  AS IDENTITY. This is a mirror: row 412 here must be row 412 in the shop. A
--  sequence of its own would invent different ids on the second sync and
--  every foreign key would point at the wrong thing.
--
--  FOREIGN KEYS: STRUCTURAL ONES KEPT, ATTRIBUTION ONES DROPPED
--  ------------------------------------------------------------
--  sale_items -> sales is structural: an orphan line item is corrupt data and
--  should be refused. `user_id` / `created_by` / `set_by` columns are only
--  attribution, so they are plain BIGINTs with no constraint — a deleted
--  staff account should never be able to block a month of sales from syncing.
-- =============================================================================


-- ---------------------------------------------------------------- currencies
CREATE TABLE IF NOT EXISTS currencies (
  code       TEXT PRIMARY KEY,
  symbol     TEXT NOT NULL,
  symbol_ar  TEXT NOT NULL,
  minor_exp  INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE currencies IS
  'USD (minor_exp 2, cents) and SYP (minor_exp 0, whole lira). Money everywhere in this database is an integer in minor units — never a float.';


-- --------------------------------------------------------------------- users
-- Safe projection only. See the header: no password material reaches here.
CREATE TABLE IF NOT EXISTS users (
  id          BIGINT PRIMARY KEY,
  username    TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN
                ('manager','cashier','warehouse','delivery','partner')),
  phone       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);

-- SQLite used COLLATE NOCASE on username; Postgres does the same job with a
-- functional unique index, which also stops 'Hussam' and 'hussam' coexisting.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));

COMMENT ON TABLE users IS
  'Staff, for attribution only. Password hashes and salts deliberately stay on the shop machine and are never mirrored.';


-- ------------------------------------------------------------------ fx_rates
CREATE TABLE IF NOT EXISTS fx_rates (
  id      BIGINT PRIMARY KEY,
  base    TEXT NOT NULL REFERENCES currencies(code),
  quote   TEXT NOT NULL REFERENCES currencies(code),
  rate    DOUBLE PRECISION NOT NULL,
  set_at  TIMESTAMPTZ NOT NULL,
  set_by  BIGINT
);
CREATE INDEX IF NOT EXISTS fx_rates_lookup ON fx_rates (base, quote, set_at DESC);

COMMENT ON TABLE fx_rates IS
  'History, not a setting. A sale must stay reportable at the rate that applied when it happened.';


-- ---------------------------------------------------------------- warehouses
CREATE TABLE IF NOT EXISTS warehouses (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('shop','storage')),
  sort    INTEGER NOT NULL DEFAULT 0
);


-- ------------------------------------------------------------------ products
CREATE TABLE IF NOT EXISTS products (
  id             BIGINT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  brand          TEXT,
  made_in        TEXT,
  colorway       TEXT,
  image_bg       TEXT,
  image_initials TEXT,
  currency       TEXT NOT NULL REFERENCES currencies(code),
  cost_price     BIGINT NOT NULL DEFAULT 0,
  selling_price  BIGINT NOT NULL DEFAULT 0,
  shelf_zone     TEXT,
  hidden         BOOLEAN NOT NULL DEFAULT FALSE,
  demo           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS products_type ON products (type);
CREATE INDEX IF NOT EXISTS products_name ON products (name);

COMMENT ON COLUMN products.cost_price IS
  'Minor units of products.currency. Cost is sensitive — only roles with cost.read see it in the app.';


-- ------------------------------------------------------------------ variants
CREATE TABLE IF NOT EXISTS variants (
  sku        TEXT PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size       TEXT NOT NULL,
  color      TEXT,
  barcode    TEXT UNIQUE,
  shelf      TEXT,
  label_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (product_id, size)
);
CREATE INDEX IF NOT EXISTS variants_product ON variants (product_id);
CREATE INDEX IF NOT EXISTS variants_barcode ON variants (barcode);


-- --------------------------------------------------------------------- stock
CREATE TABLE IF NOT EXISTS stock (
  sku   TEXT NOT NULL REFERENCES variants(sku) ON DELETE CASCADE,
  wh_id TEXT NOT NULL REFERENCES warehouses(id),
  qty   INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (sku, wh_id)
);

COMMENT ON TABLE stock IS
  'Running total per size per place. Derived from stock_movements, which is the truth.';


-- ----------------------------------------------------------- stock_movements
CREATE TABLE IF NOT EXISTS stock_movements (
  id       BIGINT PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL,
  sku      TEXT NOT NULL REFERENCES variants(sku),
  wh_id    TEXT NOT NULL REFERENCES warehouses(id),
  type     TEXT NOT NULL CHECK (type IN
             ('received','sold','damaged','returned','transfer','count')),
  delta    INTEGER NOT NULL,
  balance  INTEGER NOT NULL,
  note     TEXT,
  user_id  BIGINT,
  ref_type TEXT,
  ref_id   TEXT
);
CREATE INDEX IF NOT EXISTS movements_sku ON stock_movements (sku, at DESC);
CREATE INDEX IF NOT EXISTS movements_at  ON stock_movements (at DESC);
CREATE INDEX IF NOT EXISTS movements_ref ON stock_movements (ref_type, ref_id);

COMMENT ON TABLE stock_movements IS
  'Append-only. A correction is another row with the opposite delta, never an UPDATE, so the trail stays honest.';


-- ----------------------------------------------------------------- customers
CREATE TABLE IF NOT EXISTS customers (
  id             BIGINT PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT,
  note           TEXT,
  address        TEXT,
  city           TEXT,
  source         TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  archived       BOOLEAN NOT NULL DEFAULT FALSE,
  demo           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS customers_phone ON customers (phone);
CREATE INDEX IF NOT EXISTS customers_name  ON customers (name);

COMMENT ON TABLE customers IS
  'Real names and phone numbers. Yalla Wear (role: partner) must never reach this — customer.* is forbidden for that role in code, not merely unticked.';


-- --------------------------------------------------------------------- sales
CREATE TABLE IF NOT EXISTS sales (
  id            TEXT PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL,
  customer_id   BIGINT REFERENCES customers(id),
  customer_name TEXT,
  cashier_id    BIGINT,
  wh_id         TEXT NOT NULL REFERENCES warehouses(id),
  payment       TEXT NOT NULL,
  currency      TEXT NOT NULL REFERENCES currencies(code),
  subtotal      BIGINT NOT NULL,
  discount      BIGINT NOT NULL DEFAULT 0,
  total         BIGINT NOT NULL,
  fx_rate       DOUBLE PRECISION NOT NULL,
  fx_base       TEXT NOT NULL,
  voided        BOOLEAN NOT NULL DEFAULT FALSE,
  void_reason   TEXT,
  public_token  TEXT,
  points_used   INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_at       ON sales (at DESC);
CREATE INDEX IF NOT EXISTS sales_customer ON sales (customer_id);

COMMENT ON COLUMN sales.fx_rate IS
  'The rate frozen at the moment of sale. Without it, re-running last month''s profit after the rate moves gives a different answer every time.';


-- ---------------------------------------------------------------- sale_items
CREATE TABLE IF NOT EXISTS sale_items (
  id             BIGINT PRIMARY KEY,
  sale_id        TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  sku            TEXT NOT NULL,
  product_id     BIGINT,
  name           TEXT NOT NULL,
  size           TEXT,
  qty            INTEGER NOT NULL,
  unit_price     BIGINT NOT NULL,
  unit_cost      BIGINT NOT NULL,
  src_currency   TEXT NOT NULL REFERENCES currencies(code),
  src_unit_price BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS sale_items_sku  ON sale_items (sku);


-- ---------------------------------------------------------------- deliveries
CREATE TABLE IF NOT EXISTS deliveries (
  id          BIGINT PRIMARY KEY,
  sale_id     TEXT NOT NULL REFERENCES sales(id),
  driver_id   BIGINT,
  status      TEXT NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting','out','delivered','failed')),
  address     TEXT NOT NULL,
  phone       TEXT,
  note        TEXT,
  to_collect  BIGINT NOT NULL DEFAULT 0,
  collected   BIGINT NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL REFERENCES currencies(code),
  assigned_at TIMESTAMPTZ NOT NULL,
  assigned_by BIGINT,
  out_at      TIMESTAMPTZ,
  closed_at   TIMESTAMPTZ,
  fail_reason TEXT,
  UNIQUE (sale_id)
);
CREATE INDEX IF NOT EXISTS deliveries_driver ON deliveries (driver_id, status);
CREATE INDEX IF NOT EXISTS deliveries_status ON deliveries (status, assigned_at);

COMMENT ON COLUMN deliveries.to_collect IS
  'Read from the sale (cod ? total : 0) and frozen at assignment — never taken from a request.';


-- ----------------------------------------------------------------- print_log
CREATE TABLE IF NOT EXISTS print_log (
  id      BIGINT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  user_id BIGINT,
  copies  INTEGER NOT NULL,
  status  TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error   TEXT,
  at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS print_log_sale ON print_log (sale_id, at DESC);


-- ----------------------------------------------------------- label printing
-- label_print_jobs and label_code_seq are NOT mirrored: one is a live local
-- queue with claim tokens and leases that mean nothing off the shop network,
-- the other is a counter. What is worth keeping is the history of what was
-- actually printed, and the templates themselves.
CREATE TABLE IF NOT EXISTS label_print_log (
  id       BIGINT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  job_id   BIGINT,
  sku      TEXT NOT NULL,
  qty      INTEGER NOT NULL,
  preset   TEXT NOT NULL,
  station  TEXT NOT NULL,
  user_id  BIGINT,
  status   TEXT NOT NULL CHECK (status IN ('queued','done','failed','cancelled')),
  error    TEXT,
  at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS label_print_log_sku   ON label_print_log (sku, at DESC);
CREATE INDEX IF NOT EXISTS label_print_log_batch ON label_print_log (batch_id, at DESC);

CREATE TABLE IF NOT EXISTS label_templates (
  id         BIGINT PRIMARY KEY,
  key        TEXT NOT NULL,
  name       TEXT NOT NULL,
  name_ar    TEXT,
  width_mm   DOUBLE PRECISION NOT NULL,
  height_mm  DOUBLE PRECISION NOT NULL,
  gap_mm     DOUBLE PRECISION NOT NULL DEFAULT 2,
  slots      JSONB NOT NULL,
  archived   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_by BIGINT
);

COMMENT ON COLUMN label_templates.slots IS
  'JSON in SQLite, JSONB here — the cloud copy is what reports query, and JSONB is indexable.';


-- ---------------------------------------------------------- role_permissions
CREATE TABLE IF NOT EXISTS role_permissions (
  role       TEXT NOT NULL CHECK (role IN
               ('manager','cashier','warehouse','delivery','partner')),
  perm       TEXT NOT NULL,
  allowed    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by BIGINT,
  PRIMARY KEY (role, perm)
);

COMMENT ON TABLE role_permissions IS
  'Mirrored for visibility only. The shop server enforces permissions; changing a row here changes nothing at the till.';


-- -------------------------------------------------------------------- config
CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);


-- ---------------------------------------------------------------- change_log
-- The feed the sync itself replays, kept as an audit trail of what moved and
-- when. `seq` is the shop's monotonic counter, copied verbatim.
CREATE TABLE IF NOT EXISTS change_log (
  seq     BIGINT PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL,
  tbl     TEXT NOT NULL,
  row_id  TEXT NOT NULL,
  op      TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  user_id BIGINT,
  origin  TEXT
);
CREATE INDEX IF NOT EXISTS change_log_at ON change_log (at DESC);


-- ---------------------------------------------------------------- sync_state
-- How far the shop has pushed. One row, id 'shop'. Kept here rather than only
-- on the till so that a machine restored from backup resumes at the right
-- place, and so "when did the shop last reach us?" is answerable remotely —
-- which is the question that actually matters when a report looks stale.
CREATE TABLE IF NOT EXISTS sync_state (
  id           TEXT PRIMARY KEY,
  last_seq     BIGINT NOT NULL DEFAULT 0,
  last_push_at TIMESTAMPTZ,
  rows_pushed  BIGINT NOT NULL DEFAULT 0,
  note         TEXT
);

INSERT INTO sync_state (id, last_seq, note)
VALUES ('shop', 0, 'Aleppo shop till')
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
--  ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
--  On for every table, with no policies defined. The effect:
--
--    anon key / authenticated  ->  can read and write NOTHING
--    service_role key          ->  bypasses RLS, works normally
--
--  Only the shop server holds the service_role key, so only the shop server
--  can touch this data. Without these lines, anyone with the anon key — which
--  is public by design — could read every customer phone number and every
--  cost price in the shop.
-- =============================================================================

--  ENABLE, deliberately not FORCE. FORCE would apply RLS to the table owner
--  as well — and in Supabase the SQL Editor and Table Editor run as that
--  owner, so every table would read as empty in your own dashboard. That
--  looks exactly like "my data did not arrive", which is a bad way to spend
--  an evening. ENABLE already stops the role that matters: `anon`, whose key
--  is public.
--
--  Supabase also GRANTs table privileges to anon and authenticated by
--  default, so the REVOKE below is a second lock on the same door — if a
--  permissive policy is ever added by accident, the missing grant still
--  refuses. Guarded, because these roles exist only on Supabase and this file
--  should still run on a plain Postgres.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'currencies','users','fx_rates','warehouses','products','variants',
    'stock','stock_movements','customers','sales','sale_items','deliveries',
    'print_log','label_print_log','label_templates','role_permissions',
    'config','change_log','sync_state'
  ];
  has_anon BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF has_anon THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF has_auth THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;

  RAISE NOTICE 'RLS enabled on % tables. anon revoked: %. authenticated revoked: %.',
    array_length(tables, 1), has_anon, has_auth;
END $$;


-- =============================================================================
--  NOTES FOR THE SYNC WORKER  (verified against PostgreSQL 18.3, not guessed)
-- -----------------------------------------------------------------------------
--  1. BOOLEANS MUST BE CONVERTED. SQLite stores these as INTEGER 0/1;
--     Postgres refuses an integer in a boolean column outright:
--       ERROR: column "hidden" is of type boolean but expression is of type integer
--     The eight columns to convert 0/1 -> false/true:
--       customers.archived        customers.demo
--       products.hidden           products.demo
--       sales.voided              users.active
--       role_permissions.allowed  label_templates.archived
--
--  2. TIMESTAMPS PASS THROUGH AS-IS. The ISO 8601 UTC strings SQLite already
--     stores ('2026-08-28T11:00:00.000Z') cast to timestamptz cleanly. No
--     conversion needed — which is why nowIso() writing UTC everywhere was
--     worth doing in the first place.
--
--  3. label_templates.slots is JSON text in SQLite and JSONB here. Send the
--     parsed object, not the string, or it lands as a JSON string literal.
--
--  4. PUSH IN DEPENDENCY ORDER. Foreign keys are real; a sale arriving before
--     its customer is rejected. Verified working order:
--       currencies -> users -> warehouses -> fx_rates -> products -> variants
--       -> stock -> stock_movements -> customers -> sales -> sale_items
--       -> deliveries -> print_log -> label_templates -> label_print_log
--       -> role_permissions -> config -> change_log -> sync_state
--
--  5. RE-PUSHING IS SAFE. Every table is keyed on the shop's own id, so an
--     upsert (PostgREST: Prefer: resolution=merge-duplicates) is idempotent.
--     A sync that dies halfway can simply run again from the last committed
--     change_log.seq — which is the whole reason the cursor is a sequence
--     number and not a timestamp.
-- =============================================================================
