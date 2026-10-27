-- =============================================================================
--  077 — the size guide, in centimetres (night shift 28 Oct 2026)
-- -----------------------------------------------------------------------------
--  The owner wants a size guide like the big brands: measured in centimetres,
--  entered when a product is added, shown in the drawer, at the till, on the
--  website and as a WhatsApp picture. Decided by the owner:
--
--    * reusable charts ("Nike tee", "Adidas shorts") AND per product: a
--      product follows a chart, or starts from one and has its own numbers
--      (that copy no longer follows the chart);
--    * the admin ticks which measurements apply (lib/sizeguide.js MEASURES);
--    * required for clothes (the types in config sizeguide.clothes_types),
--      optional for shoes. A NEW product of a clothes type is refused until
--      every size has every ticked measurement; existing products are not.
--    * a fit note (runs small / true to size / runs large) and a short note.
--
--  TWO TABLES, JSON ON THE ROW. A chart's and a guide's rows are JSON on the
--  row ([{size, values: {chest: 52.5, …}}]) rather than a child table, so a
--  guide travels to the mirror as one row — the reason 070 gave pairs_with a
--  column and 076 gave offers its targets.
--
--  A PRODUCT'S GUIDE STORES ITS ROWS RESOLVED, even when it follows a chart:
--  the product's own sizes, in the size order (js/sizeorder.js), with the
--  chart's numbers. Saving a chart rewrites every guide that follows it (in
--  the same transaction, each logged), and adding a size to a product adds
--  its row. So the cloud copy can hand the website a guide without knowing
--  anything about charts or how sizes sort.
--
--  Cursor shape, both: every write goes through change_log. A chart is never
--  deleted — switched off (`active`) — like a category.
--  Mirror file: server/supabase/044_size_guides.sql.
-- =============================================================================

CREATE TABLE size_charts (
  id          INTEGER PRIMARY KEY,
  name_en     TEXT    NOT NULL,
  name_ar     TEXT    NOT NULL,
  type        TEXT,                                -- the category its sizes come from
  measures    TEXT    NOT NULL DEFAULT '[]',       -- ["chest","length",…]
  rows        TEXT    NOT NULL DEFAULT '[]',       -- [{size, values:{…}}], size order
  fit         TEXT    CHECK (fit IS NULL OR fit IN ('small', 'true', 'large')),
  note_en     TEXT,
  note_ar     TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL,
  created_by  INTEGER,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE product_size_guides (
  product_id  INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  chart_id    INTEGER REFERENCES size_charts(id),
  follows     INTEGER NOT NULL DEFAULT 0,          -- 1 = the chart's numbers, kept in step
  measures    TEXT    NOT NULL DEFAULT '[]',
  rows        TEXT    NOT NULL DEFAULT '[]',
  fit         TEXT    CHECK (fit IS NULL OR fit IN ('small', 'true', 'large')),
  note_en     TEXT,
  note_ar     TEXT,
  updated_at  TEXT    NOT NULL,
  updated_by  INTEGER,
  CHECK (follows = 0 OR chart_id IS NOT NULL)
);
CREATE INDEX product_size_guides_chart ON product_size_guides(chart_id) WHERE chart_id IS NOT NULL;

-- Which product types count as clothes (a guide is required for a new one).
-- Config is mirrored whole, so no mirror file is needed for this key.
INSERT OR IGNORE INTO config (key, value, updated_at)
VALUES ('sizeguide.clothes_types', '["tshirts","jerseys","shirts","jackets","jeans","tracks"]',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
