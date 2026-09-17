-- =============================================================================
--  026 — a product has colours  (local 058)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, after 025. Until it is run:
--    - variants go up without colour_id, and sold lines without their colour
--      (lib/mirror-lag.js), naming this file every run;
--    - product_colours is skipped by name behind its own guard;
--    - the boot pull refuses with `drift`.
--  Afterwards: npm run supabase:drift, then npm run supabase:reconcile.
--
--  THE PRINTED CODE IS SHARED BY EVERY COLOUR OF ONE PRODUCT AND SIZE, so the
--  mirror must stop insisting that a barcode is unique, and a product may
--  now hold the same size once PER COLOUR. The constraint names below are
--  Postgres's defaults for 001's inline UNIQUEs. variants.colour_id is
--  deliberately NOT a foreign key here: colours are pushed after the core
--  loop, behind a guard of their own.
--
--  product_colours: cursor shape. RLS on, no policies.
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_colours (
  id          BIGINT PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name_en     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  hex         TEXT,
  image_url   TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS product_colours_product ON product_colours (product_id, sort);
ALTER TABLE product_colours ENABLE ROW LEVEL SECURITY;

ALTER TABLE variants ADD COLUMN IF NOT EXISTS colour_id BIGINT;
ALTER TABLE variants DROP CONSTRAINT IF EXISTS variants_barcode_key;
ALTER TABLE variants DROP CONSTRAINT IF EXISTS variants_product_id_size_key;
CREATE UNIQUE INDEX IF NOT EXISTS variants_product_colour_size ON variants (product_id, colour_id, size);
CREATE INDEX IF NOT EXISTS variants_colour ON variants (colour_id);

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS colour TEXT;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS colour_ar TEXT;
ALTER TABLE order_return_lines ADD COLUMN IF NOT EXISTS colour TEXT;
ALTER TABLE order_return_lines ADD COLUMN IF NOT EXISTS colour_ar TEXT;
