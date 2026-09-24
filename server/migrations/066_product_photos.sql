-- =============================================================================
--  066 — a colour's photographs: the model wearing it, the product, and more
-- -----------------------------------------------------------------------------
--  The owner's rule (24 Sep 2026): every colour of every product has AT LEAST
--  TWO photographs before it may appear on the website — first somebody
--  wearing it (`model`), second the product on its own (`product`) — and may
--  carry more (`extra`). A colour missing either stays off the website; the
--  shop still sells it, labels it and counts it. Nothing here stops a sale.
--
--  WHY A TABLE, NOT MORE COLUMNS. products.image_url (040) and
--  product_colours.image_url (058) each hold ONE address. A gallery is a list,
--  and a list in one column is a JSON string the mirror cannot compare row by
--  row. Each photo is a row, cursor shape in the mirror, like the colours.
--
--  WHAT A ROW HOLDS. The address of TWO files in the public `product-images`
--  bucket: `url`, large enough for a product page (the browser sends at most
--  1600 px on the long side), and `thumb_url`, small enough for a till
--  (at most 480 px). The bytes never touch og.db.
--
--  ONE `model` AND ONE `product` PER COLOUR, as a partial unique index —
--  putting a new photo into a slot that is taken REPLACES the one there.
--  `extra` is ordered by `sort`.
--
--  THE OLD TWO COLUMNS STAY, AND ARE NOW DERIVED. Every screen in the shop —
--  the thumbnails, the till's tiles, the colour sheet, the shelf map's boxes —
--  draws products.image_url / product_colours.image_url, so lib/photos.js
--  writes them from this table (the small file of the product photo, else the
--  model photo) in the same transaction as every change here. Nothing else
--  writes them any more.
--
--  THE PICTURES THE SHOP ALREADY HAS become PRODUCT photos below — a colour's
--  own picture on that colour, the product's picture on its first colour. It
--  cannot be known whether an old picture was of somebody wearing the thing,
--  so it takes the slot that fits a till thumbnail; the owner can swap it into
--  the model slot in one press. The old pictures were shrunk to 420 px, so
--  `url` and `thumb_url` are the same file for them: they are fine on a till
--  and small on a website, and a new photo replaces them.
--
--  These rows are made here without change_log entries, so lib/mirror.js
--  lists product_photos in MIGRATION_MADE and logs them before its next run.
--  Mirror side: server/supabase/036_product_photos.sql.
-- =============================================================================

CREATE TABLE product_photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  colour_id   INTEGER NOT NULL REFERENCES product_colours(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('model', 'product', 'extra')),
  url         TEXT    NOT NULL,
  thumb_url   TEXT    NOT NULL,
  --  Of the large file, in pixels, so a website can reserve the space before
  --  the picture arrives. NULL for the pictures carried over below.
  width       INTEGER,
  height      INTEGER,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE UNIQUE INDEX product_photos_slot ON product_photos (colour_id, kind) WHERE kind <> 'extra';
CREATE INDEX product_photos_product ON product_photos (product_id, colour_id, sort);

--  A colour's own picture first: it is that colour's product photo.
INSERT INTO product_photos (product_id, colour_id, kind, url, thumb_url, sort, created_at, updated_at)
SELECT c.product_id, c.id, 'product', c.image_url, c.image_url, 0,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM product_colours c
 WHERE c.image_url IS NOT NULL AND c.image_url <> '';

--  Then the product's picture, on its first colour — as the product photo when
--  that slot is free, as an extra when the colour already brought one, and not
--  at all when it is the same file.
INSERT INTO product_photos (product_id, colour_id, kind, url, thumb_url, sort, created_at, updated_at)
SELECT p.id, fc.id,
       CASE WHEN EXISTS (SELECT 1 FROM product_photos x WHERE x.colour_id = fc.id AND x.kind = 'product')
            THEN 'extra' ELSE 'product' END,
       p.image_url, p.image_url, 1,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM products p
  JOIN product_colours fc
    ON fc.id = (SELECT id FROM product_colours WHERE product_id = p.id ORDER BY sort, id LIMIT 1)
 WHERE p.image_url IS NOT NULL AND p.image_url <> ''
   AND NOT EXISTS (SELECT 1 FROM product_photos x WHERE x.colour_id = fc.id AND x.url = p.image_url);
