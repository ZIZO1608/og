-- =============================================================================
--  058 — a product has colours, and a size is a colour × size
-- -----------------------------------------------------------------------------
--  The owner's decisions (night shift 01, E1):
--    - A product has colours; each colour has its own sizes; each size its own
--      quantity. Red → 42: 3, 43: 2 · Black → 42: 1.
--    - THE PRINTED CODE DOES NOT CHANGE PER COLOUR. Every colour of the same
--      product and size shares its barcode and its label code, exactly as the
--      code makes them today. So `variants.barcode` and `variants.label_code`
--      lose their UNIQUE — a shared code is now normal — and the rule that a
--      code may only be shared by the same product AND size lives in
--      lib/catalogue.js, which is the only place that issues one.
--    - All colours share the product's price. A colour has no price.
--
--  EXISTING PRODUCTS: each gets ONE colour — its `colorway` if it had one,
--  "Standard / أساسي" if not — and every existing size is put on it. No SKU
--  changes, no stock row is touched, no movement is written. lib/
--  migration-checks.js compares quantity, value and sizes per product before
--  and after, INSIDE this transaction, and refuses to commit on any
--  difference, naming the product. A product with a single colour draws
--  exactly as it did: the colour is only named where there is a choice.
--
--  THE REBUILD. `variants` carries UNIQUE (product_id, size) inline, which
--  SQLite can only drop by rebuilding the table, and five tables reference
--  it. The runner turns foreign keys off around this one migration (SQLite's
--  documented procedure — DROP TABLE on a parent otherwise deletes the stock
--  rows through their ON DELETE CASCADE) and checks for new broken references
--  before COMMIT.
--
--  Mirror twin: server/supabase/026_colours.sql. product_colours is
--  cursor-shape (a colour is renamed and re-pictured); variants.colour_id is
--  declared in mirror-lag.js.
-- =============================================================================

CREATE TABLE product_colours (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name_en     TEXT    NOT NULL,
  name_ar     TEXT    NOT NULL,
  --  '#RRGGBB', or NULL for a colour nobody picked a swatch for.
  hex         TEXT,
  --  The colour's own photograph (Storage, like products.image_url). Optional.
  image_url   TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX product_colours_product ON product_colours (product_id, sort);

-- One colour for every product that exists.
INSERT INTO product_colours (product_id, name_en, name_ar, hex, sort, created_at, updated_at)
SELECT p.id,
       COALESCE(NULLIF(TRIM(p.colorway), ''), 'Standard'),
       COALESCE(NULLIF(TRIM(p.colorway), ''), 'أساسي'),
       NULL, 0, p.created_at, p.created_at
  FROM products p;

CREATE TABLE variants_new (
  sku        TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  colour_id  INTEGER NOT NULL REFERENCES product_colours(id),
  size       TEXT NOT NULL,
  color      TEXT,
  --  Shared by every colour of one product and size (see the header).
  barcode    TEXT,
  shelf      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  label_code TEXT,
  UNIQUE (product_id, colour_id, size)
);

INSERT INTO variants_new (sku, product_id, colour_id, size, color, barcode, shelf,
                          created_at, updated_at, label_code)
SELECT v.sku, v.product_id,
       (SELECT c.id FROM product_colours c WHERE c.product_id = v.product_id ORDER BY c.id LIMIT 1),
       v.size, v.color, v.barcode, v.shelf, v.created_at, v.updated_at, v.label_code
  FROM variants v;

DROP TABLE variants;
ALTER TABLE variants_new RENAME TO variants;

CREATE INDEX variants_product    ON variants (product_id);
CREATE INDEX variants_colour     ON variants (colour_id);
CREATE INDEX variants_barcode    ON variants (barcode);
CREATE INDEX variants_label_code ON variants (label_code);

-- What was sold, and in which colour — frozen on the line like its name.
-- NULL on every line sold before this, and on any product with one colour.
ALTER TABLE sale_items ADD COLUMN colour    TEXT;
ALTER TABLE sale_items ADD COLUMN colour_ar TEXT;
ALTER TABLE order_return_lines ADD COLUMN colour    TEXT;
ALTER TABLE order_return_lines ADD COLUMN colour_ar TEXT;
