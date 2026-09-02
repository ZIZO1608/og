-- =============================================================================
--  010 — the stamp cards, and what people asked for
-- -----------------------------------------------------------------------------
--  RUN THIS BY HAND in the Supabase SQL editor, like 002–009 before it.
--
--  Until it is run, `npm run supabase:sync` names these two tables and pushes
--  everything else — a day's sales must not stop being mirrored over a table
--  nobody has created yet.
--
--  WHY THESE TWO MATTER MORE THAN THEY LOOK. Almost everything else in this
--  mirror is recoverable from something: a stock figure from the movement log,
--  an open debt from the sale and its payments, a stamp COUNT from the sales it
--  was derived from. These two are not.
--
--    * a redemption is the record that the shop GAVE somebody something. If
--      this row is lost, the stamps it consumed come back — the count is
--      derived as earned-minus-used (server/lib/loyalty.js) — and the customer
--      is holding a card the shop has already honoured.
--    * a want is somebody telling the shop what to order. Nothing else in the
--      database remembers that a person asked for a 44 and left without one.
--
--  Local migrations: 031_loyalty_stamps.sql and 032_job_customer_and_wants.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  loyalty_redemptions  —  APPEND-ONLY on the sync side
-- -----------------------------------------------------------------------------
--  Written once and never edited, so supabase-sync pushes it with the
--  highest-id cursor (syncAppendOnly) rather than by replaying change_log.
--
--  required_then is the load-bearing column and the reason this table exists
--  at all: it is the rule that was in force at that moment, frozen, exactly as
--  sales.fx_rate is. Change the rule from 10 to 8 next year and last year's
--  redemptions must keep meaning what they meant.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id            BIGINT PRIMARY KEY,
  customer_id   BIGINT,
  at            TEXT NOT NULL,
  user_id       BIGINT,
  stamps_used   INTEGER NOT NULL,
  required_then INTEGER NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS loyalty_redemptions_customer
  ON loyalty_redemptions (customer_id, at);


-- -----------------------------------------------------------------------------
--  wants  —  CURSOR shape, because a want is EDITED
-- -----------------------------------------------------------------------------
--  Deliberately not append-only. A want is written when somebody asks for a
--  size the shop has not got, and UPDATED when the shop comes back to them
--  (closed_at, closed_note). A highest-id cursor would push the row once, on
--  the day it was created, and never notice it being answered — so the mirror
--  would keep saying somebody is still waiting for a pair they collected in
--  March.
--
--  That is why it replays change_log instead, and why both write paths in
--  server/lib/wants.js call logChange — record() as 'insert', close() as
--  'update'. Verified before this file was written; a write that skips
--  logChange is not a missing audit line, it is a row that exists on the shop's
--  machine and nowhere else.
--
--  No foreign keys, matching the rest of this mirror (see 001's header): a
--  restore reads tables in dependency order, and a hard FK here would make an
--  out-of-order push fail rather than simply arrive early.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wants (
  id          BIGINT PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  product_id  BIGINT,
  variant_sku TEXT,
  size        TEXT,
  source      TEXT NOT NULL DEFAULT 'scan',
  user_id     BIGINT,
  at          TEXT NOT NULL,
  closed_at   TEXT,
  closed_note TEXT
);

CREATE INDEX IF NOT EXISTS wants_customer ON wants (customer_id, at);
CREATE INDEX IF NOT EXISTS wants_open     ON wants (product_id, size) WHERE closed_at IS NULL;


-- -----------------------------------------------------------------------------
--  print_jobs.customer_id  (local migration 032)
-- -----------------------------------------------------------------------------
--  Added here rather than in its own file because it arrives with the same
--  local migration as `wants`. print_jobs is pushed inside the partner guard,
--  which retries on every run — so until this column exists the print board
--  simply mirrors late, it does not lose anything.
-- -----------------------------------------------------------------------------

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS customer_id BIGINT;
