-- =============================================================================
--  Mirror schema for the shelf layout.
--  Run this in the Supabase SQL editor, like 002, 003, 004 and 005.
-- -----------------------------------------------------------------------------
--  Matches server/migrations/023_shelves.sql column for column.
--
--  RUN IT IN THE SAME CHANGE AS THE CODE. `npm run supabase:check` enumerates
--  every local table out of sqlite_master, so the moment 023 applies it starts
--  reporting `sections` and `shelves` as missing and exits non-zero — which is
--  correct, the mirror genuinely is not a faithful copy until this file runs.
--
--  THE ALTER AT THE BOTTOM IS THE ONE THAT WILL BITE. `stock` is pushed in the
--  unguarded CORE loop with SELECT *, so the moment shelf_id exists locally,
--  PostgREST rejects the WHOLE stock batch on any project where this has not
--  been run. supabase-sync.js carries `fallbackDrop: ['shelf_id']` on stock so
--  a day's stock keeps mirroring meanwhile — that is a safety net, not a
--  reason to skip the ALTER, because until it runs no shelf location is
--  mirrored at all and a restore hands back a warehouse with no map.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sections (
  --  BIGINT, never BIGSERIAL and never GENERATED AS IDENTITY. A sequence of
  --  its own would invent different ids on the second sync and every
  --  shelves.section_id would point at the wrong room.
  id          BIGINT PRIMARY KEY,
  wh_id       TEXT NOT NULL REFERENCES warehouses(id),
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_index  INTEGER NOT NULL DEFAULT 0,
  grid_origin TEXT NOT NULL DEFAULT 'left' CHECK (grid_origin IN ('left','right')),
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL

  --  NO `UNIQUE (wh_id, key)` HERE, THOUGH SQLITE HAS ONE. See the note below
  --  the shelves table — a secondary unique index on a mirror is not a safety
  --  net, it is a way to stop the whole sync.
);

CREATE TABLE IF NOT EXISTS shelves (
  id         BIGINT PRIMARY KEY,
  section_id BIGINT NOT NULL REFERENCES sections(id),

  code       TEXT NOT NULL,
  row_label  TEXT NOT NULL,
  col_index  INTEGER NOT NULL,

  --  NO foreign key to products, deliberately, and this is not laziness.
  --  Locally the column is ON DELETE SET NULL, and that nulling happens inside
  --  SQLite with no application code running — so it writes no change_log
  --  entry and never reaches here. A real FK would then refuse to remove the
  --  product from the mirror, taking the whole products batch down with it.
  --  Same reasoning as sales.shift_id and stock_movements.ref_id.
  product_id BIGINT,

  size_from  TEXT,
  size_to    TEXT,
  capacity   INTEGER,

  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL

  --  NO `UNIQUE (section_id, code)`, DELIBERATELY, even though SQLite enforces
  --  exactly that. This one would have stopped the entire sync, for good.
  --
  --  supabase-sync.js pushes every table's UPSERTS first and its DELETES
  --  afterwards. Take a shelf out and put a rack back in the same spot — which
  --  is a normal week here, and which createShelf's own comment calls "how a
  --  rack goes back where a door used to be" — and the new row (a new id, the
  --  same A3) arrives while the old row still holds A3. SB.insert asks
  --  PostgREST to merge on the PRIMARY KEY, so a clash on a SECOND unique
  --  index is not merged: Postgres raises 23505, and "duplicate key ... already
  --  exists" matches none of the /does not exist|schema cache/ patterns the
  --  layout block catches. The run dies there, before fx_rates, before
  --  stock_movements, before the whole partner and money half — and the cursor
  --  never advances, so every later run dies in the same place. Even
  --  `npm run supabase:reconcile` cannot clear it: it upserts before it
  --  deletes too.
  --
  --  SQLite is the system of record and it enforces this constraint for real.
  --  The mirror is a copy kept for the day this machine dies, not a second
  --  constraint engine — the same argument already made for the missing
  --  foreign keys above.
);

CREATE INDEX IF NOT EXISTS idx_shelves_section ON shelves(section_id);
CREATE INDEX IF NOT EXISTS idx_shelves_product ON shelves(product_id);
CREATE INDEX IF NOT EXISTS idx_sections_wh     ON sections(wh_id, sort_index);

--  No foreign key, for the same reason as sales.shift_id: `stock` is pushed in
--  the unguarded CORE loop while sections/shelves are pushed inside a guard, so
--  on a project where only part of this has landed a real FK would reject every
--  stock row that has been put away. The mirror is a copy kept for the day this
--  machine dies, not a second constraint engine.
ALTER TABLE stock ADD COLUMN IF NOT EXISTS shelf_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_stock_shelf ON stock(shelf_id);

ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE shelves  ENABLE ROW LEVEL SECURITY;
