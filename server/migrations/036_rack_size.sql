-- =============================================================================
--  How big a rack is, and where along its wall it stands — in centimetres.
-- -----------------------------------------------------------------------------
--  026 put a rack on a wall at `wall_pos`, counted in BAYS from the wall's
--  left end, and the only thing that knew how wide a bay was was a constant in
--  the browser (1.14 m). The server tested two racks for overlap by counting
--  bays, on one wall at a time, never against the length of the wall and
--  never at a corner. So a big room could not have big shelves, a room could
--  be shrunk under the racks in it with no refusal at all, and the map drew
--  the result through the wall.
--
--  Now a rack carries its own size and the server owns the arithmetic:
--
--    bay_cm    width of one bay (one column of shelves)
--    level_cm  height of one level (one row letter)
--    depth_cm  how far the rack stands out from the wall
--
--  NULL MEANS THE SHOP'S STANDARD RACK, never a measured zero. The defaults
--  live in server/lib/shelves.js (GEOMETRY) and are sent to the browser with
--  the layout, so there is one set of numbers and it is on the server.
--
--    wall_cm   centimetres from the wall's left end, as you face the wall.
--
--  `wall_pos` STAYS, and is now DERIVED: the server rewrites it as
--  round(wall_cm / bay) on every placement, so the mirror column, an older
--  restore and the 2D plan's ordering keep meaning what they always meant.
--  Existing rows are converted with the one number that was ever drawn —
--  114 cm — so nothing on any screen moves as a result of this migration.
--
--  CHECKs are on this side only; the mirror file (server/supabase/013) has
--  none, for the reason 006 gives.
-- =============================================================================

ALTER TABLE sections ADD COLUMN bay_cm   INTEGER CHECK (bay_cm   IS NULL OR bay_cm   > 0);
ALTER TABLE sections ADD COLUMN level_cm INTEGER CHECK (level_cm IS NULL OR level_cm > 0);
ALTER TABLE sections ADD COLUMN depth_cm INTEGER CHECK (depth_cm IS NULL OR depth_cm > 0);
ALTER TABLE sections ADD COLUMN wall_cm  INTEGER CHECK (wall_cm  IS NULL OR wall_cm  >= 0);

UPDATE sections SET wall_cm = wall_pos * 114 WHERE wall_pos IS NOT NULL;
