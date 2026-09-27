-- =============================================================================
--  068 — coupon codes (28 Sep 2026)
-- -----------------------------------------------------------------------------
--  The owner asked for a page, his and the developers' only, where coupon
--  codes are made and where each code says how many people have used it. A
--  code works at the till, in the order desk and on the website (whose order
--  is accepted through the desk, so the desk's Save is where it is counted).
--
--  Before this there was a FAKE coupon: OG20 at 20%, hardcoded in the browser
--  (CONFIG.COUPON), which the server knew nothing about — and a 20% cut is
--  over the 10% discount ceiling, so the server refused every sale it was
--  used on. The browser's copy is gone with this migration's code.
--
--  TWO TABLES, two shapes, and both are mirrored (cloud file 038):
--
--  coupons — the codes. Edited (switched off, limits changed), so it is a
--    cursor-shape table: every write goes through change_log. Never deleted:
--    a code that has been used is named by its uses, and "switch it off" is
--    the answer to "delete it".
--
--  coupon_uses — one row per sale a code went on, written in the SAME
--    transaction as the sale, so a use exists exactly when the sale does.
--    APPEND-ONLY: a void does NOT touch it. What counts as a use is a row
--    whose sale is not voided — joined, never stored — so voiding a sale
--    gives the code its use back without anybody remembering to. One coupon
--    per sale (the unique index), which is also what makes a retried sale
--    (the same opId) unable to count twice.
--
--  Money: `amount` is in minor units of `currency`, which is USD — every
--  price in the shop is dollars since 067 and the lira follows the rate, so
--  a fixed-amount coupon is written in dollars too and converted at the
--  sale's own frozen rate. `min_basket` is USD cents for the same reason.
--  `discount` on a use is in the SALE's currency and minor units, like
--  sales.discount, of which it is a part.
--
--  No foreign key to users on created_by / user_id, for the reason 042 gave
--  to_user none: removing an account must not be blocked by a coupon it made.
-- =============================================================================

CREATE TABLE coupons (
  id                 INTEGER PRIMARY KEY,
  code               TEXT    NOT NULL,
  note               TEXT,
  kind               TEXT    NOT NULL CHECK (kind IN ('percent', 'amount')),
  percent            INTEGER CHECK (percent IS NULL OR (percent BETWEEN 1 AND 100)),
  amount             INTEGER CHECK (amount IS NULL OR amount > 0),
  currency           TEXT    NOT NULL DEFAULT 'USD',
  min_basket         INTEGER CHECK (min_basket IS NULL OR min_basket > 0),
  max_uses           INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  once_per_customer  INTEGER NOT NULL DEFAULT 0,
  starts_at          TEXT,
  expires_at         TEXT,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT    NOT NULL,
  created_by         INTEGER,
  updated_at         TEXT    NOT NULL,
  CHECK ((kind = 'percent' AND percent IS NOT NULL) OR (kind = 'amount' AND amount IS NOT NULL))
);

CREATE UNIQUE INDEX coupons_code ON coupons(code);

CREATE TABLE coupon_uses (
  id           INTEGER PRIMARY KEY,
  coupon_id    INTEGER NOT NULL REFERENCES coupons(id),
  code         TEXT    NOT NULL,
  sale_id      TEXT    NOT NULL REFERENCES sales(id),
  customer_id  INTEGER,
  currency     TEXT    NOT NULL,
  discount     INTEGER NOT NULL CHECK (discount >= 0),
  channel      TEXT    NOT NULL DEFAULT 'till',
  at           TEXT    NOT NULL,
  user_id      INTEGER
);

CREATE UNIQUE INDEX coupon_uses_sale ON coupon_uses(sale_id);
CREATE INDEX coupon_uses_coupon ON coupon_uses(coupon_id);
CREATE INDEX coupon_uses_customer ON coupon_uses(coupon_id, customer_id);

--  The page and every coupon write. The owner and the developers only — the
--  owner's words were "only for the admin". A manager can be given it in
--  Settings → Access by a person; the partner never (FORBIDDEN in auth.js).
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('owner',     'coupon.write', 1, '1970-01-01T00:00:00.000Z'),
  ('developer', 'coupon.write', 1, '1970-01-01T00:00:00.000Z'),
  ('manager',   'coupon.write', 0, '1970-01-01T00:00:00.000Z'),
  ('cashier',   'coupon.write', 0, '1970-01-01T00:00:00.000Z'),
  ('warehouse', 'coupon.write', 0, '1970-01-01T00:00:00.000Z'),
  ('delivery',  'coupon.write', 0, '1970-01-01T00:00:00.000Z'),
  ('partner',   'coupon.write', 0, '1970-01-01T00:00:00.000Z')
ON CONFLICT DO NOTHING;
