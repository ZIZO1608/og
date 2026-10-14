-- =============================================================================
--  073 — a colour's 3D angles: front, back, left, right           (14 Oct 2026)
-- -----------------------------------------------------------------------------
--  The owner's plan: every product on the website gets a 3D model somebody can
--  turn round. An image-to-3D service builds that model from photographs of
--  the same thing from several sides, so each colour now has a second set of
--  photos beside its gallery — the ANGLES. Front and back are needed before a
--  model can be made; left and right are optional and make a better one.
--
--  WHY NOT MORE KINDS IN product_photos. Those are the website's gallery: the
--  website's own SQL (web.product_row, the same text in cloud files 037, 040
--  and 041) sends every row of a ready colour to the product page. An angle is
--  an input for the model — a shoe on a plain background, square to the
--  camera — not a picture to sell with. A table of its own keeps the gallery,
--  the till's thumbnails and the "ready for the website" rule exactly as they
--  are, and nothing the website reads changes.
--
--  ONE PHOTO PER ANGLE PER COLOUR, as a unique index — a new photo into a
--  taken angle REPLACES the one there. The files are in the public
--  `product-images` bucket like the gallery's, two sizes each (lib/angles.js).
--
--  Cursor shape in the mirror, like product_photos. Nothing is inserted here,
--  so nothing needs logging before the first push.
--  Mirror side: server/supabase/042_product_angles.sql.
-- =============================================================================

CREATE TABLE product_angles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  colour_id   INTEGER NOT NULL REFERENCES product_colours(id) ON DELETE CASCADE,
  angle       TEXT    NOT NULL CHECK (angle IN ('front', 'back', 'left', 'right')),
  url         TEXT    NOT NULL,
  thumb_url   TEXT    NOT NULL,
  width       INTEGER,
  height      INTEGER,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE UNIQUE INDEX product_angles_slot ON product_angles (colour_id, angle);
CREATE INDEX product_angles_product ON product_angles (product_id, colour_id);
