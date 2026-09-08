-- =============================================================================
--  040 — a product's own photograph
-- -----------------------------------------------------------------------------
--  The address of the picture, not the picture. The bytes live in a public
--  Supabase Storage bucket (`product-images`, made by lib/storage.js the first
--  time it is needed); this column is the URL every screen puts in an <img>.
--
--  A URL rather than a BLOB because the row is mirrored (products is in the
--  UNGUARDED core loop) and a restore has to hand the shop its pictures back:
--  the bucket survives the laptop, and a row pointing at it is a few dozen
--  bytes in change_log rather than a photo per edit.
--
--  NULL is "no photograph", and every renderer already falls back to the
--  colour block with the initials — a product is never left without a visual.
--  The mirror side is server/supabase/015_product_image.sql; until it is run
--  lib/mirror-lag.js pushes products without this column and names the file.
-- =============================================================================

ALTER TABLE products ADD COLUMN image_url TEXT;
