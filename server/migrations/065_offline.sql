-- 065 — selling while the internet is down (online first, phase 3, wave 1).
--
-- The main server (the VPS, once the shop has switched) LENDS the shop laptop
-- blocks of invoice numbers in advance. While the line is down the laptop
-- sells on those numbers, so the receipt printed at the counter carries the
-- number the sale will have for ever; when the line is back the sales are
-- replayed onto the main server with the same numbers. The main server's own
-- numbering skips every lent block (lib/sales.js nextInvoiceId), so two
-- servers can never hand out one number — the thing that happened on 30 Aug
-- and 3 Sep, and the reason INV-2106 was once two different sales.
--
-- The loan is written by the main server when the laptop fetches its copy
-- (GET /api/copy/db), inside the snapshot the laptop receives: the laptop
-- learns its numbers from its own copy, and nothing is ever lent that the
-- laptop has not been handed.
--
-- LOCAL ONLY, both tables (supabase-check.js LOCAL_ONLY): they describe which
-- machine holds which numbers today, not the shop's history.
CREATE TABLE IF NOT EXISTS id_loans (
  prefix   TEXT    NOT NULL,              -- 'INV'
  lo       INTEGER NOT NULL,
  hi       INTEGER NOT NULL,
  holder   TEXT    NOT NULL,              -- the standby's name (OG_STANDBY_ID)
  lent_at  TEXT    NOT NULL,
  PRIMARY KEY (prefix, lo),
  CHECK (hi >= lo)
);
CREATE INDEX IF NOT EXISTS id_loans_holder ON id_loans (holder, prefix, lo);

-- Which standby laptops have fetched a copy, and the addresses they said they
-- answer on (their own https Wi-Fi addresses). The domain's page offers these
-- when the main server stops answering: "continue on the shop's own server".
-- Written only through the copy door, which only the copy key opens.
CREATE TABLE IF NOT EXISTS standby_seen (
  holder   TEXT PRIMARY KEY,
  urls     TEXT,                          -- JSON array of https URLs
  seen_at  TEXT NOT NULL
);
