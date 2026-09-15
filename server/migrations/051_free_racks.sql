-- =============================================================================
--  051 — a rack that stands on the floor, not against a wall
-- -----------------------------------------------------------------------------
--  Every rack until now hung on a wall of its room (026, 036). The shop's back
--  room has one down the middle of the floor that you can walk all the way
--  round, and the schema could not say where it was.
--
--    placement  'wall' — on a wall (`wall`, `wall_cm`), or not placed yet
--               'free' — on the floor (`x_cm`, `y_cm`, `rot_deg`)
--    x_cm       across the room: the room's LEFT edge to the rack's centre
--    y_cm       down the room: the room's FRONT edge (the door's wall) to the
--               rack's centre
--    rot_deg    0, 90, 180 or 270 — quarter turns only, so every footprint
--               stays an axis-aligned rectangle (server/lib/shelves.js)
--
--  THE DEFAULT IS THE MIGRATION. `placement` arrives as 'wall' for every row
--  already here, and the three floor columns as NULL, without an UPDATE — no
--  existing rack is rewritten, logged or re-mirrored by this file.
--
--  A free rack is single depth, exactly like a wall rack: one bay is one
--  location. It is not double-sided storage, and nothing here makes it one.
--
--  The rule that a row is wholly one kind or wholly the other — no 'free'
--  rack with a wall, no wall rack with a floor position — is enforced in
--  checkPlacement() in server/lib/shelves.js, where the refusal can say which
--  field is wrong. The CHECKs below only keep each column's own values sane.
--
--  Mirror side: server/supabase/020_free_racks.sql, and lib/mirror-lag.js.
-- =============================================================================

ALTER TABLE sections ADD COLUMN placement TEXT NOT NULL DEFAULT 'wall'
  CHECK (placement IN ('wall', 'free'));
ALTER TABLE sections ADD COLUMN x_cm    INTEGER CHECK (x_cm    IS NULL OR x_cm >= 0);
ALTER TABLE sections ADD COLUMN y_cm    INTEGER CHECK (y_cm    IS NULL OR y_cm >= 0);
ALTER TABLE sections ADD COLUMN rot_deg INTEGER CHECK (rot_deg IS NULL OR rot_deg IN (0, 90, 180, 270));
