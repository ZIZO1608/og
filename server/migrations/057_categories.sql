-- =============================================================================
--  057 — product categories, in English and Arabic
-- -----------------------------------------------------------------------------
--  The eight categories were a hardcoded list in the browser (TYPE_LABELS,
--  SIZE_SETS) with English names only, so the Arabic till showed "Sneakers".
--  They are rows now, each with both names and the sizes it comes in.
--
--  THE ID IS THE SLUG products.type ALREADY HOLDS ('sneakers', 'tshirts').
--  No product changes and nothing is renumbered: every distinct type already
--  in use becomes a category below, so no product loses its category. A type
--  this list does not know is carried over with its slug as both names, for
--  the owner to rename in Settings.
--
--  A category is never deleted, only switched off (active = 0): products and
--  old reports name it. There is no foreign key from products.type — adding
--  one means rebuilding products — so lib/categories.js checks every write.
--
--  Mirror shape: pushed whole (lib/mirror.js WHOLE_KEYS), file 025.
-- =============================================================================

CREATE TABLE categories (
  id          TEXT    PRIMARY KEY,
  name_en     TEXT    NOT NULL,
  name_ar     TEXT    NOT NULL,
  --  The size run the Add-product form offers, as a JSON array of labels.
  sizes       TEXT    NOT NULL DEFAULT '[]',
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

INSERT INTO categories (id, name_en, name_ar, sizes, sort, created_at, updated_at) VALUES
  ('sneakers', 'Sneakers', 'أحذية رياضية', '["39","40","41","42","43","44","45"]', 10, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('boots',    'Boots',    'بوط',          '["40","41","42","43","44","45"]',      20, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('tshirts',  'T-Shirts', 'تيشيرتات',     '["S","M","L","XL","XXL"]',             30, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('jeans',    'Jeans',    'جينز',          '["28","30","32","34","36","38"]',      40, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('jerseys',  'Jerseys',  'قمصان فرق',    '["S","M","L","XL","XXL"]',             50, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('crocs',    'Crocs',    'كروكس',         '["39","40","41","42","43","44","45"]', 60, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('shirts',   'Shirts',   'قمصان',         '["S","M","L","XL","XXL"]',             70, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('jackets',  'Jackets',  'جاكيتات',       '["S","M","L","XL","XXL"]',             80, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');

-- Every other type already on a product becomes a category too, under its
-- own spelling, so nothing is left pointing at nothing.
INSERT INTO categories (id, name_en, name_ar, sizes, sort, created_at, updated_at)
SELECT DISTINCT p.type, p.type, p.type, '[]', 900, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'
  FROM products p
 WHERE p.type NOT IN (SELECT id FROM categories);
