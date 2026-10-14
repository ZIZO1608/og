-- =============================================================================
--  042 — a colour's 3D angles  (local 073)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, once, on its own. It needs 026
--  (product_colours) to have been run. Then check it with
--  verify_042_product_angles.sql.
--
--  Until it is run:
--    - product_angles is skipped by name behind its own guard, and every
--      other table still goes up (lib/mirror.js, "3D angles");
--    - the angles wait on the shop's server and land on the first run after
--      it — the bookmark only moves after a push that landed.
--  The FILES are in the public `product-images` bucket already, whether this
--  is run or not. What this table holds is which file is which angle.
--
--  Every colour of every product may have four photos for its 3D model:
--  `front` and `back` (both needed before a model can be made), `left` and
--  `right` (optional). The website does not read this table.
--
--  Locally there is at most one photo per angle per colour; that rule is NOT
--  repeated here as a unique index, for the reason 036 gives: the mirror
--  receives rows one upsert at a time. colour_id is deliberately NOT a
--  foreign key, for the reason 026 gives for variants.colour_id.
--
--  Cursor shape. RLS on, no policies: only the shop's service key reaches it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_angles (
  id          BIGINT PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  colour_id   BIGINT NOT NULL,
  angle       TEXT   NOT NULL CHECK (angle IN ('front', 'back', 'left', 'right')),
  url         TEXT   NOT NULL,
  thumb_url   TEXT   NOT NULL,
  width       INTEGER,
  height      INTEGER,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS product_angles_product ON product_angles (product_id, colour_id);
CREATE INDEX IF NOT EXISTS product_angles_colour ON product_angles (colour_id);
ALTER TABLE product_angles ENABLE ROW LEVEL SECURITY;

-- ---- grants ----
--  A table made in the SQL editor has NO privileges for the service_role on
--  this project (found 17 Sep 2026). The shop's key reads and writes it; anon
--  and authenticated are kept out. Running this twice changes nothing.
DO $$
DECLARE
  t TEXT;
  s RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_angles'] LOOP
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
