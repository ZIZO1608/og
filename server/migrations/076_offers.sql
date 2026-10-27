-- =============================================================================
--  076 — offers: sales on one product, a few, a category, a brand, or the
--  whole shop (27 Oct 2026)
-- -----------------------------------------------------------------------------
--  The owner asked for a page of its own where a sale is made once and is
--  then true everywhere: the website shows it (badge, struck price,
--  countdown), and the till and the order desk charge it by themselves.
--
--  ONE TABLE. `targets` is JSON on the row — [{kind, ref, exclude}] — rather
--  than a child table, so an offer and what it covers travel to the mirror as
--  one row (the reason 070 gave pairs_with a column). Cursor shape: every
--  write goes through change_log. Never deleted once it has been sold under:
--  its sales name it.
--
--  kind
--    pct    `pct` per cent off each piece                       (1..90)
--    off    `amount` USD cents off each piece
--    price  each piece at `amount` USD cents (never above its own price)
--    bxgy   buy `buy_qty`, get `get_qty` at `pct` off (100 = free); the
--           cheapest pieces in the group are the ones that come off
--
--  max_units: a flash sale — only that many pieces at the offer price; the
--    rest at the normal price. Counted from sale_items, never stored.
--  stack_coupons: 1 = a coupon code may come off the sale price too; 0 = the
--    pieces under this offer are left out of what a coupon works on.
--
--  THE PRICE IS ON THE LINE, NOT IN THE DISCOUNT. sale_items.unit_price is
--  what was charged; `list_price` beside it is what it would have been and
--  `offer_id` says which offer. Folded into sales.discount instead, every
--  offer sale would read as a cashier going over the 10% ceiling (reports,
--  the dashboard) and a return would refund the full price.
--
--  Money: USD cents, like every price since 067. The lira follows the rate.
-- =============================================================================

CREATE TABLE offers (
  id             INTEGER PRIMARY KEY,
  name_en        TEXT    NOT NULL,
  name_ar        TEXT    NOT NULL,
  note           TEXT,
  kind           TEXT    NOT NULL CHECK (kind IN ('pct', 'off', 'price', 'bxgy')),
  pct            INTEGER CHECK (pct IS NULL OR pct BETWEEN 1 AND 100),
  amount         INTEGER CHECK (amount IS NULL OR amount > 0),
  buy_qty        INTEGER CHECK (buy_qty IS NULL OR buy_qty BETWEEN 1 AND 20),
  get_qty        INTEGER CHECK (get_qty IS NULL OR get_qty BETWEEN 1 AND 20),
  scope          TEXT    NOT NULL DEFAULT 'pick' CHECK (scope IN ('all', 'pick')),
  targets        TEXT    NOT NULL DEFAULT '[]',
  starts_at      TEXT    NOT NULL,
  ends_at        TEXT,
  max_units      INTEGER CHECK (max_units IS NULL OR max_units > 0),
  stack_coupons  INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  cover_url      TEXT,
  created_at     TEXT    NOT NULL,
  created_by     INTEGER,
  updated_at     TEXT    NOT NULL,
  CHECK (kind <> 'pct'   OR (pct IS NOT NULL AND pct <= 90)),
  CHECK (kind NOT IN ('off', 'price') OR amount IS NOT NULL),
  CHECK (kind <> 'bxgy'  OR (buy_qty IS NOT NULL AND get_qty IS NOT NULL AND pct IS NOT NULL)),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX offers_when ON offers(active, starts_at, ends_at);

ALTER TABLE sale_items ADD COLUMN list_price INTEGER;
ALTER TABLE sale_items ADD COLUMN offer_id   INTEGER;
CREATE INDEX sale_items_offer ON sale_items(offer_id) WHERE offer_id IS NOT NULL;

--  The page and every offer write: the owner and the developers, like the
--  coupons. A manager can be given it in Settings → Access by a person.
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('owner',     'offer.write', 1, '1970-01-01T00:00:00.000Z'),
  ('developer', 'offer.write', 1, '1970-01-01T00:00:00.000Z'),
  ('manager',   'offer.write', 0, '1970-01-01T00:00:00.000Z'),
  ('cashier',   'offer.write', 0, '1970-01-01T00:00:00.000Z'),
  ('warehouse', 'offer.write', 0, '1970-01-01T00:00:00.000Z'),
  ('delivery',  'offer.write', 0, '1970-01-01T00:00:00.000Z'),
  ('partner',   'offer.write', 0, '1970-01-01T00:00:00.000Z')
ON CONFLICT DO NOTHING;
