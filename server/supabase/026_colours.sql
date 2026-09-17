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

-- ---- grants (night shift 01 fix) ----
--  Supabase gives a table made in the SQL editor NO privileges for the
--  service_role on this project, so the shop's key was refused with
--  "permission denied for table …" and the whole mirror run stopped. The
--  shop's key needs to read and write each new table; anon and authenticated
--  are kept out, as 001 does for its own tables. A sequence owned by one of
--  these tables (none today — the ids come from the shop) gets USAGE and
--  SELECT. Every statement is a GRANT or a REVOKE: running this twice
--  changes nothing. A table that does not exist yet is skipped.
DO $$
DECLARE
  t TEXT;
  s RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_colours'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
      FOR s IN
        SELECT seq.relname
          FROM pg_class seq
          JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
          JOIN pg_class tab ON tab.oid = dep.refobjid
         WHERE seq.relkind = 'S' AND tab.oid = ('public.' || t)::regclass
      LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', s.relname);
      END LOOP;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
