-- =============================================================================
--  Where things physically are
-- -----------------------------------------------------------------------------
--  The shop has one warehouse and its shelves have no codes on them at all.
--  They exist in people's heads: "the Nikes are up on the left". This is the
--  schema the manager invents the layout with, and then walks the room
--  labelling it from what he printed.
--
--  TWO FACTS, NOT ONE. Keep them apart or the whole thing collapses:
--
--    ASSIGNMENT  — what a shelf is FOR. `shelves.product_id` + a size range.
--                  Decided by a person, changes rarely, and it is what goes on
--                  paper.
--    CONTENTS    — what is sitting there right now. `stock.shelf_id`, derived
--                  from stock and never stored as a count.
--
--  An empty shelf still has a purpose, which is how the map can say "these
--  belong here and we have run out" rather than "nothing here". And a printed
--  label stays true when the last pair sells, which it could not if the label
--  described contents.
--
--  THE RULE THE SHOP ACTUALLY WORKS BY. A shelf holds one product, but not
--  always the whole product. Sometimes a shelf is a whole model, sometimes it
--  is only the 42s, and a model that sells may span three shelves split by
--  size. One shape covers all three:
--
--    product_id NULL                    -> unassigned, accepts anything
--    product set, sizes NULL            -> the whole model lives here
--    product set, size_from = size_to   -> only that size
--    product set, size_from < size_to   -> part of the size run
--
--  `product_id` is deliberately NOT unique. Three shelves of the same shoe
--  split by size is the normal case, not the exception.
-- =============================================================================


-- ------------------------------------------------------------------ sections
--  A room or an area inside a warehouse. The shop does not yet know how many
--  rooms it has, so these are made by the manager rather than fixed in code.
CREATE TABLE sections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  --  TEXT, not INTEGER: `warehouses.id` is 'floor' / 'store'. Named `wh_id`
  --  like every other table that points at a warehouse (stock, sales, shifts,
  --  stock_counts) rather than `warehouse_id`, so a join reads the same here
  --  as it does everywhere else.
  --
  --  A shelf reaches its warehouse THROUGH here and does not carry its own
  --  copy. Two columns saying where something is are two columns that
  --  eventually disagree.
  wh_id       TEXT NOT NULL REFERENCES warehouses(id),

  --  ONE Latin capital, because it becomes part of every printed barcode and
  --  a long key eats a 60x40 label. Codes are unique per SECTION, so room M
  --  and room B can both have an A3 -- which is exactly why the section key
  --  has to ride in the barcode.
  key         TEXT NOT NULL CHECK (key GLOB '[A-Z]'),

  --  What the manager calls the room, in Arabic, in his words. It is shown on
  --  screen and printed on the shelf label, and it is NEVER an identifier --
  --  so he can rename a room without invalidating a single label already
  --  stuck to a shelf.
  name        TEXT NOT NULL,

  sort_index  INTEGER NOT NULL DEFAULT 0,

  --  Which end of the room you walk in from, PER SECTION. Two rooms can be
  --  entered from opposite ends and the map has to match what a person
  --  actually sees standing in the doorway. The default here is only so that
  --  a bare INSERT cannot fail; the editor must ask, not accept it silently.
  grid_origin TEXT NOT NULL DEFAULT 'left' CHECK (grid_origin IN ('left','right')),

  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,

  UNIQUE (wh_id, key)
);
CREATE INDEX sections_wh ON sections (wh_id, sort_index);


-- ------------------------------------------------------------------- shelves
CREATE TABLE shelves (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(id),

  --  Grid style: A1, A2, B7. Latin letters and Western digits, never أ٣ --
  --  the scanner gun emits them with no special handling and everyone in the
  --  shop reads them fine. The Arabic on a label is the room name and the
  --  product name, not the code.
  code       TEXT NOT NULL,

  --  Stored apart from `code` rather than parsed back out of it, so drawing
  --  the grid is arithmetic instead of string handling.
  row_label  TEXT NOT NULL,
  col_index  INTEGER NOT NULL CHECK (col_index > 0),

  --  The assignment. ON DELETE SET NULL rather than RESTRICT: a product is
  --  normally archived rather than deleted, but purge-demo.js does delete for
  --  good, and a shelf blocking that would turn a cleanup into a puzzle. The
  --  honest result of the product going is that the shelf is unassigned.
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,

  --  Both ends or neither. A half-open range is not a rule anybody could
  --  apply, and "from 39 to nothing" reads as a bug on the shelf label.
  --  That a range needs a product is enforced in server/lib/shelves.js, not
  --  here: a CHECK would abort the ON DELETE SET NULL above.
  size_from  TEXT,
  size_to    TEXT,

  --  How many boxes the shelf physically holds. NULL means nobody has
  --  measured it, which is a permanently valid state -- the map shows a plain
  --  count instead of a fill bar. Nothing may invent one.
  capacity   INTEGER CHECK (capacity IS NULL OR capacity > 0),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE (section_id, code),
  CHECK ((size_from IS NULL) = (size_to IS NULL))
);
CREATE INDEX shelves_section ON shelves (section_id, row_label, col_index);
CREATE INDEX shelves_product ON shelves (product_id);


-- ------------------------------------------------------------ stock.shelf_id
--  Where this size actually is. NULL means "no location yet" and is permanent
--  and valid: stock that arrived this morning has not been put away, and the
--  database must not claim it has. Nothing backfills this -- an invented
--  location is worse than an admitted gap, because somebody would walk to it.
--
--  `stock` is keyed (sku, wh_id), so one size in one warehouse points at
--  exactly one shelf. There is no shape in which it could point at two.
--
--  Selling does not clear it. Stock going to zero leaves the location and the
--  shelf's assignment alone; the pairs come back to the same place.
ALTER TABLE stock ADD COLUMN shelf_id INTEGER REFERENCES shelves(id);
CREATE INDEX stock_shelf ON stock (shelf_id);


-- =============================================================================
--  No shelves are seeded. A warehouse that has not been laid out yet returns
--  an empty list, and the screen says so rather than drawing a shop that does
--  not exist.
--
--  `variants.shelf` and `products.shelf_zone` (001_init.sql) are a different,
--  older thing: free text carried by the demo catalogue, never validated,
--  never printed, pointing at no shelf that exists. They are left exactly
--  where they are -- removing them is a separate decision -- and nothing in
--  this feature reads or writes them.
-- =============================================================================
