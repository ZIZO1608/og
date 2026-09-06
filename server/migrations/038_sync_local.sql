-- =============================================================================
--  What THIS machine has pushed to the mirror.
-- -----------------------------------------------------------------------------
--  Supabase `sync_state` holds every table's bookmark, and lib/mirror.js reads
--  it once at boot and writes it through on every advance. That answered
--  "how far has the mirror got" for as long as exactly one database ever
--  wrote those rows.
--
--  The shop can now move between laptops (lib/restore.js — the baton), which
--  breaks that assumption in one specific way: a bookmark the OTHER laptop
--  wrote is a position in the other laptop's change_log, and this laptop's
--  seq numbers mean nothing against it. Measured that way, rows written here
--  can read as "already pushed" when they never left this machine — which is
--  exactly the check that decides whether a boot pull may wipe them.
--
--  So every advance is also recorded here, in the database it describes.
--  Mirror.unpushed() counts against THIS table and nothing else. Local only:
--  never mirrored, never restored, and rebuilt from the mirror's cursors the
--  first time a machine syncs under its own lineage (adoptCursorsLocally).
-- =============================================================================

CREATE TABLE IF NOT EXISTS sync_local (
  id       TEXT PRIMARY KEY,               -- sync:<t>, sync:<t>:maxid, whole:<t> — the sync_state ids
  last_seq INTEGER NOT NULL DEFAULT 0,
  at       TEXT NOT NULL
);
