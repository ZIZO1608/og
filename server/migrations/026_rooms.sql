-- =============================================================================
--  Rooms, and which wall of one a rack hangs on.
-- -----------------------------------------------------------------------------
--  023 gave the warehouse "sections": a letter, a name, a grid of shelves. On
--  the map that letter was drawn as a room. It is not one. It is a RACK — a
--  unit of shelving with levels (the row letters, A at the top) and bays (the
--  columns), fixed to a wall — and a room is the thing with four walls that
--  several racks hang inside. The letter rides in every printed barcode; a
--  room's name rides in nothing, which is exactly why they are two tables and
--  not a parent_id: a room must never consume one of the 26 letters.
--
--  NOTHING HERE IS FILLED IN. Every existing section keeps room_id NULL and
--  is "not placed in a room yet" — listed by the designer, drawn on its own,
--  and placed when a person says which wall it is on. Placing racks on a
--  default wall would be inventing a location, and 023 already says why that
--  is worse than an admitted gap: somebody would walk to it.
-- =============================================================================

CREATE TABLE rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wh_id       TEXT NOT NULL REFERENCES warehouses(id),
  name        TEXT NOT NULL,
  sort_index  INTEGER NOT NULL DEFAULT 0,

  --  The room, measured — optional, and NULL is a permanent, honest answer.
  --  Unmeasured, the room is sized to the racks in it and drawn with a
  --  "not to scale" badge; measured, the walls are where the tape says. A
  --  width without a depth is refused in server/lib/shelves.js rather than
  --  here, because SQLite cannot add a table-level CHECK by ALTER and a
  --  rebuild for a pairing rule is not worth it (023 makes the same call for
  --  size_from / size_to).
  width_cm    INTEGER CHECK (width_cm  IS NULL OR width_cm  > 0),
  depth_cm    INTEGER CHECK (depth_cm  IS NULL OR depth_cm  > 0),
  height_cm   INTEGER CHECK (height_cm IS NULL OR height_cm > 0),

  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX rooms_wh ON rooms (wh_id, sort_index);

--  Which room a rack is in, which of its walls, and how far along it — in
--  bays from the wall's left end as you stand facing that wall. All three
--  nullable: a rack with no room has no wall, and the pairing (a wall needs a
--  position, a position needs a wall, both need a room) is enforced in
--  server/lib/shelves.js for the reason given above.
--
--  No ON DELETE clause: a room with racks in it refuses to go (room_not_empty)
--  before the database ever sees the delete, so the constraint is the net,
--  not the message.
ALTER TABLE sections ADD COLUMN room_id  INTEGER REFERENCES rooms(id);
ALTER TABLE sections ADD COLUMN wall     TEXT    CHECK (wall IS NULL OR wall IN ('n','e','s','w'));
ALTER TABLE sections ADD COLUMN wall_pos INTEGER CHECK (wall_pos IS NULL OR wall_pos >= 0);
CREATE INDEX sections_room ON sections (room_id);
