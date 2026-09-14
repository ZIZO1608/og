-- =============================================================================
--  050 — what this laptop has already done with og-track's inbox
-- -----------------------------------------------------------------------------
--  og-track (the public tracking page on Railway, a separate project) puts a
--  customer's review and "Notify me" into inbox.items in Supabase, and
--  server/lib/inbox.js collects them while the mirror is live. See that file.
--
--  One row per inbox item AND revision this machine has applied or refused,
--  written right after the POS's own code decided and before the answer is
--  reported back (track.inbox_done). A report lost to a dropped line is sent
--  again on the next pass from this row: the review is not submitted twice and
--  the office is not alerted twice. A newer revision of the same item (the
--  customer edited their review) is a new row, and is applied.
--
--  NOT MIRRORED, for sync_local's reason: bookkeeping about the inbox, not a
--  fact about the shop. LOCAL_ONLY in scripts/supabase-check.js; no
--  server/supabase file; lib/drift.js checks only its PUSHED list. Rows go
--  after 30 days (lib/inbox.js), as the inbox's own finished items do.
-- =============================================================================

CREATE TABLE IF NOT EXISTS inbox_applied (
  item_id     INTEGER NOT NULL,
  revision    INTEGER NOT NULL,
  kind        TEXT    NOT NULL,
  sale_id     TEXT,
  outcome     TEXT    NOT NULL CHECK (outcome IN ('applied', 'rejected')),
  code        TEXT,
  applied_at  TEXT    NOT NULL,
  reported_at TEXT,
  PRIMARY KEY (item_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_inbox_applied_at ON inbox_applied (applied_at);
