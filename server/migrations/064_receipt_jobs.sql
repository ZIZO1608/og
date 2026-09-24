-- =============================================================================
--  064 — receipts that wait for the shop's printer (online first, phase 2)
-- -----------------------------------------------------------------------------
--  The receipt printer is a USB box on the shop's laptop, reached with a raw
--  `copy /b` to a Windows share (lib/printer.js). A server that is NOT that
--  laptop — the VPS, once it is the main server — cannot reach it at all.
--  With receipt.transport = 'agent' the till's bytes wait here instead, and
--  the print agent on the laptop (agent/print-agent.js, which already pulls
--  the label printer's jobs this way) takes them and prints them.
--
--  Same claim / lease / complete shape as label_print_jobs (010), for the
--  same reasons. One difference: a receipt is for a customer standing at the
--  counter, so one nobody printed within receipt.agent_expire_minutes (10)
--  is EXPIRED rather than printed — an hour of old receipts coming out the
--  moment a dropped line comes back is worse than none.
--
--  LOCAL-ONLY, like label_print_jobs: delivery state, never mirrored (it is
--  on supabase-check.js's LOCAL_ONLY list). No foreign keys: a print job must
--  never be the reason a sale or a user row cannot change.
-- =============================================================================

CREATE TABLE receipt_jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  station          TEXT    NOT NULL,              -- which agent takes it (receipt.station)
  sale_id          TEXT,
  kind             TEXT    NOT NULL DEFAULT 'sale',
  copies           INTEGER NOT NULL DEFAULT 1,    -- for the log: the bytes already hold every copy
  bytes_b64        TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'claimed', 'done', 'failed', 'expired')),
  claim_token      TEXT,
  claimed_at       TEXT,
  lease_expires_at TEXT,
  error            TEXT,
  created_at       TEXT    NOT NULL,
  created_by       INTEGER,
  done_at          TEXT
);

CREATE INDEX receipt_jobs_station_status ON receipt_jobs (station, status, id);
