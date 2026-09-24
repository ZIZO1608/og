-- =============================================================================
--  036 — a colour's photographs  (local 066)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, once, on its own (like 030 and 031;
--  it is not in CATCH-UP.sql). It needs 026 (product_colours) to have been run.
--  Then check it with verify_036_product_photos.sql.
--
--  Numbered 036, not 032: 030–035 are already taken on other branches of this
--  repo (erp_access, till_status, extra_accounts, og_vps_off_web,
--  night_requests), and two files with one number is how one of them never
--  gets run.
--
--  Until it is run:
--    - product_photos is skipped by name behind its own guard, and every
--      other table still goes up (lib/mirror.js, "Photos");
--    - the photos wait on the laptop and land on the first run after it —
--      the bookmark only moves after a push that landed, so nothing needs
--      reconciling afterwards;
--    - the boot pull refuses with `drift` (lib/drift.js), so the shop will
--      not move to another laptop until this is run.
--  The FILES are in the public `product-images` bucket already, whether this
--  is run or not. What this table holds is which file is which.
--
--  Every colour of every product has its own photos: `model` (somebody
--  wearing it — shown first), `product` (the product on its own — second) and
--  any number of `extra`. `url` is the large file for a website, `thumb_url`
--  the small one for a till. Locally there is at most one `model` and one
--  `product` per colour; that rule is NOT repeated here as a unique index,
--  because swapping the two is two rows changing at once, and the mirror
--  receives them one upsert at a time — a unique index would refuse the swap
--  halfway and stop every photo landing after it. The shop enforces it.
--
--  colour_id is deliberately NOT a foreign key, for the reason 026 gives for
--  variants.colour_id: the order the guarded blocks land in must not matter.
--
--  Cursor shape. RLS on, no policies: only the shop's service key reaches it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_photos (
  id          BIGINT PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  colour_id   BIGINT NOT NULL,
  kind        TEXT   NOT NULL CHECK (kind IN ('model', 'product', 'extra')),
  url         TEXT   NOT NULL,
  thumb_url   TEXT   NOT NULL,
  width       INTEGER,
  height      INTEGER,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS product_photos_product ON product_photos (product_id, colour_id, sort);
CREATE INDEX IF NOT EXISTS product_photos_colour ON product_photos (colour_id);
ALTER TABLE product_photos ENABLE ROW LEVEL SECURITY;

-- ---- grants ----
--  A table made in the SQL editor has NO privileges for the service_role on
--  this project (found 17 Sep 2026: every push died on "permission denied").
--  The shop's key reads and writes it; anon and authenticated are kept out.
--  Every statement is a GRANT or a REVOKE: running this twice changes nothing.
DO $$
DECLARE
  t TEXT;
  s RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_photos'] LOOP
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
